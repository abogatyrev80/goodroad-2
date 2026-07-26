"""
Скрипт импорта OSM дорог в MongoDB.

Режимы:
  python -m scripts.import_roads --bbox 55.5,37.3,56.0,38.0   # Overpass API (Москва)
  python -m scripts.import_roads --pbf data/russia-latest.osm.pbf  # локальный PBF

После импорта дороги доступны через road_service для привязки кластеров.
"""

import argparse
import asyncio
import json
import logging
import math
import os
import sys
import time
from typing import Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("import_roads")

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "good_road_db")
COLLECTION = "road_segments"
BATCH_SIZE = 1000


async def get_db():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    await client.admin.command("ping")
    logger.info("Connected to MongoDB: %s / %s", MONGO_URL, DB_NAME)
    return db, client


def haversine(lat1, lon1, lat2, lon2):
    R = 6371000
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def segment_length(coords: List[Tuple[float, float]]) -> float:
    total = 0.0
    for i in range(1, len(coords)):
        total += haversine(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1])
    return total


async def import_from_overpass(db, south: float, west: float, north: float, east: float):
    """Импорт дорог через Overpass API (для небольших областей)"""
    import httpx

    # Overpass QL — извлекаем дороги с геометрией
    bbox = f"{south},{west},{north},{east}"
    query = f"""
    [out:json][timeout:120];
    (
      way({bbox})[highway~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|service)$"];
      way({bbox})[highway~"^(motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"];
    );
    out geom;
    """

    url = "https://overpass-api.de/api/interpreter"
    logger.info("Запрос к Overpass API для bbox=%s...", bbox)

    async with httpx.AsyncClient(timeout=130.0) as client:
        resp = await client.post(url, data={"data": query})
        if resp.status_code != 200:
            logger.error("Overpass API error %d: %s", resp.status_code, resp.text[:500])
            return 0
        data = resp.json()

    elements = data.get("elements", [])
    logger.info("Получено элементов: %d", len(elements))

    total = 0
    batch = []

    for el in elements:
        if el.get("type") != "way":
            continue
        tags = el.get("tags", {})
        geometry = el.get("geometry")
        if not geometry or len(geometry) < 2:
            continue

        coords = [(g["lat"], g["lon"]) for g in geometry]
        length = segment_length(coords)
        if length < 10:
            continue

        way_id = el.get("id")
        name = tags.get("name", "")
        highway = tags.get("highway", "unknown")

        doc = {
            "road_id": f"osm-{way_id}",
            "name": name,
            "highway": highway,
            "length": round(length, 1),
            "geometry": {"type": "LineString", "coordinates": [[c[1], c[0]] for c in coords]},
            "imported_at": time.time(),
        }
        batch.append(doc)
        total += 1

        if len(batch) >= BATCH_SIZE:
            await db[COLLECTION].insert_many(batch)
            logger.info("Вставлено %d сегментов...", total)
            batch = []

    if batch:
        await db[COLLECTION].insert_many(batch)
        logger.info("Вставлено %d сегментов (финал)", total)

    return total


async def import_from_pbf(db, pbf_path: str):
    """Импорт дорог из локального OSM PBF файла (использует osmium)"""
    try:
        import osmium
    except ImportError:
        logger.error("Установите osmium: pip install osmium")
        return 0

    class RoadHandler(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.ways = []

        def way(self, w):
            tags = dict(w.tags)
            if "highway" not in tags:
                return
            highway = tags["highway"]
            if highway not in (
                "motorway", "trunk", "primary", "secondary",
                "tertiary", "residential", "unclassified", "service",
                "motorway_link", "trunk_link", "primary_link",
                "secondary_link", "tertiary_link",
            ):
                return
            if len(w.nodes) < 2:
                return
            coords = [(n.lat, n.lon) for n in w.nodes if n.location.valid()]
            if len(coords) < 2:
                return
            length = segment_length(coords)
            if length < 10:
                return
            name = tags.get("name", "")
            self.ways.append({
                "road_id": f"osm-{w.id}",
                "name": name,
                "highway": highway,
                "length": round(length, 1),
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[c[1], c[0]] for c in coords],
                },
                "imported_at": time.time(),
            })

    logger.info("Чтение PBF: %s...", pbf_path)
    handler = RoadHandler()
    handler.apply_file(pbf_path)
    logger.info("Извлечено дорог: %d", len(handler.ways))

    total = 0
    batch = []
    for doc in handler.ways:
        batch.append(doc)
        total += 1
        if len(batch) >= BATCH_SIZE:
            await db[COLLECTION].insert_many(batch)
            logger.info("Вставлено %d сегментов...", total)
            batch = []

    if batch:
        await db[COLLECTION].insert_many(batch)
        logger.info("Вставлено %d сегментов (финал)", total)

    return total


async def ensure_indexes(db):
    existing = await db[COLLECTION].index_information()
    if "geometry_2dsphere" not in existing:
        await db[COLLECTION].create_index([("geometry", "2dsphere")])
        logger.info("Создан 2dsphere индекс")
    if "road_id_1" not in existing:
        await db[COLLECTION].create_index("road_id", unique=True)
        logger.info("Создан unique индекс road_id")
    count = await db[COLLECTION].count_documents({})
    logger.info("Всего road_segments в БД: %d", count)


async def main():
    parser = argparse.ArgumentParser(description="Импорт OSM дорог в MongoDB")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--bbox", help="Bounding box: south,west,north,east")
    group.add_argument("--pbf", help="Путь к OSM PBF файлу")
    args = parser.parse_args()

    db, client = await get_db()
    try:
        if args.bbox:
            parts = [float(x.strip()) for x in args.bbox.split(",")]
            if len(parts) != 4:
                logger.error("bbox должен быть: south,west,north,east")
                return
            total = await import_from_overpass(db, *parts)
        elif args.pbf:
            if not os.path.exists(args.pbf):
                logger.error("Файл не найден: %s", args.pbf)
                return
            total = await import_from_pbf(db, args.pbf)

        await ensure_indexes(db)
        logger.info("Импорт завершён: %d сегментов", total)
    finally:
        client.close()


if __name__ == "__main__":
    asyncio.run(main())
