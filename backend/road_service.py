import logging
import math
from typing import List, Dict, Optional, Tuple

from services.geo import calculate_distance

logger = logging.getLogger(__name__)


class RoadService:
    """Привязка препятствий и пользователей к дорогам через MongoDB road_segments."""

    def __init__(self, db=None):
        self.db = db
        self._available: Optional[bool] = None

    def _get_collection(self):
        if self.db is None:
            return None
        try:
            return self.db["road_segments"]
        except Exception:
            return None

    async def is_available(self) -> bool:
        if self._available is not None:
            return self._available
        col = self._get_collection()
        if col is None:
            self._available = False
            return False
        try:
            count = await col.count_documents({}, limit=1)
            self._available = count > 0
        except Exception:
            self._available = False
        return self._available

    async def find_nearest_road(self, lat: float, lon: float) -> Optional[Dict]:
        """Находит ближайший road_segment к точке."""
        col = self._get_collection()
        if col is None:
            return None
        try:
            from bson import json_util
            pipeline = [
                {
                    "$geoNear": {
                        "near": {"type": "Point", "coordinates": [lon, lat]},
                        "distanceField": "dist",
                        "spherical": True,
                        "key": "geometry",
                    }
                },
                {"$limit": 1},
            ]
            cursor = col.aggregate(pipeline)
            results = await cursor.to_list(1)
            if results:
                return results[0]
        except Exception as e:
            logger.error("find_nearest_road error: %s", e)
        return None

    async def find_road_id_for_point(self, lat: float, lon: float) -> Optional[str]:
        """Возвращает road_id ближайшей дороги к точке."""
        road = await self.find_nearest_road(lat, lon)
        if road and road.get("dist", 999999) < 50:
            return road.get("road_id")
        return None

    async def find_road_for_trail(self, trail: List[Dict]) -> Optional[Dict]:
        """Определяет дорогу по GPS-трейлу. Возвращает road_id + метаданные."""
        if not trail:
            return None
        # Усредняем первые точки трейла для поиска дороги
        mid_idx = len(trail) // 2
        mid = trail[mid_idx] if len(trail) > 0 else trail[0]
        road = await self.find_nearest_road(
            mid.get("latitude", mid.get("lat")),
            mid.get("longitude", mid.get("lon")),
        )
        if road and road.get("dist", 999999) < 50:
            return {
                "road_id": road.get("road_id"),
                "name": road.get("name", ""),
                "highway": road.get("highway", ""),
                "distance_to_road": road.get("dist", 0),
            }
        return None

    async def snap_obstacle_to_road(self, lat: float, lon: float) -> Optional[Dict]:
        """Привязывает препятствие к дороге. Возвращает road_id и позицию."""
        road = await self.find_nearest_road(lat, lon)
        if road is None or road.get("dist", 999999) > 50:
            return None

        road_id = road.get("road_id")
        geometry = road.get("geometry", {}).get("coordinates", [])
        if len(geometry) < 2:
            return {"road_id": road_id, "road_position": 0.0, "cross_track": road.get("dist", 0)}

        position = _position_on_linestring(lat, lon, geometry)
        return {
            "road_id": road_id,
            "road_position": position,
            "cross_track": road.get("dist", 0),
        }

    async def find_obstacles_on_road(
        self,
        trail: List[Dict],
        obstacles: List[Dict],
        user_lat: float,
        user_lon: float,
    ) -> List[Dict]:
        """Фильтрует препятствия: оставляет только на той же дороге, что и пользователь."""
        road_info = await self.find_road_for_trail(trail)
        if road_info is None:
            return obstacles

        road_id = road_info["road_id"]
        user_pos = _position_on_linestring(
            user_lat, user_lon,
            road_info.get("_geometry", []),
        )

        results = []
        for obs in obstacles:
            obs_road_id = obs.get("road_id")
            if obs_road_id != road_id:
                continue
            obs_pos = obs.get("road_position", 0)
            road_dist = abs(obs_pos - user_pos) if user_pos else obs.distance
            cross = obs.get("cross_track", 0)

            zone = _road_zone(road_dist)
            entry = dict(obs)
            entry["road_distance"] = round(road_dist, 1)
            entry["cross_track_distance"] = round(cross, 1)
            entry["road_zone"] = zone
            results.append(entry)

        results.sort(key=lambda x: x.get("road_distance", 999999))
        return results


road_service = RoadService()


def _road_zone(distance: float) -> str:
    if distance < 50:
        return "near"
    elif distance < 200:
        return "medium"
    elif distance < 500:
        return "far"
    return "beyond"


def _position_on_linestring(lat: float, lon: float, coords: List[List[float]]) -> float:
    """Находит позицию точки вдоль LineString [lon,lat]."""
    if not coords or len(coords) < 2:
        return 0.0

    best_dist = float("inf")
    best_pos = 0.0
    total = 0.0

    for i in range(len(coords) - 1):
        c1_lon, c1_lat = coords[i]
        c2_lon, c2_lat = coords[i + 1]
        seg_len = calculate_distance(c1_lat, c1_lon, c2_lat, c2_lon)
        if seg_len < 0.01:
            continue

        d, t = _point_to_segment_ratio(lat, lon, c1_lat, c1_lon, c2_lat, c2_lon)
        if d < best_dist:
            best_dist = d
            best_pos = total + t * seg_len
        total += seg_len
    return best_pos


def _point_to_segment_ratio(
    plat: float, plon: float,
    slat1: float, slon1: float,
    slat2: float, slon2: float,
) -> Tuple[float, float]:
    plat_r = math.radians(plat)
    plon_r = math.radians(plon)
    s1_lat_r = math.radians(slat1)
    s1_lon_r = math.radians(slon1)
    s2_lat_r = math.radians(slat2)
    s2_lon_r = math.radians(slon2)
    dx = (s2_lon_r - s1_lon_r) * math.cos((s1_lat_r + s2_lat_r) / 2)
    dy = s2_lat_r - s1_lat_r
    seg_len_sq = dx * dx + dy * dy
    if seg_len_sq < 1e-14:
        return calculate_distance(plat, plon, slat1, slon1), 0.0
    delta_lat = plat_r - s1_lat_r
    delta_lon = plon_r - s1_lon_r
    t = max(0.0, min(1.0,
        (delta_lat * dy + delta_lon * dx * math.cos((s1_lat_r + s2_lat_r) / 2)) /
        (math.radians(0.00001) * seg_len_sq)
    ))
    proj_lat = slat1 + t * (slat2 - slat1)
    proj_lon = slon1 + t * (slon2 - slon1)
    dist = calculate_distance(plat, plon, proj_lat, proj_lon)
    return dist, t
