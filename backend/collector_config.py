"""
Collector Config — настройки адаптивного сбора данных и ML порогов.
Хранится в MongoDB (коллекция collector_config), доступна админке и агентам.
"""

import logging
from copy import deepcopy

logger = logging.getLogger(__name__)

COLLECTION = "collector_config"

DEFAULT_COLLECTOR_CONFIG = {
    "version": 1,
    "enabled": True,
    "trigger": {
        "magnitude_threshold_g": 1.15,
        "window_before_ms": 2000,
        "window_after_ms": 0,
        "capture_frequency_hz": 50,
        "baseline_frequency_hz": 50,
        "min_speed_kmh": 5,
    },
    "prearm": {
        "zone_radius_m": 300,
        "buffer_window_ms": 5000,
        "fetch_radius_m": 5000,
        "fetch_interval_ms": 30000,
        "min_confirmations": 1,
        "max_zones": 200,
    },
    "background": {
        "interval_ms": 60000,
        "min_speed_kmh": 0,
    },
}


def _merge(defaults: dict, override: dict) -> dict:
    result = deepcopy(defaults)
    for k, v in (override or {}).items():
        if isinstance(v, dict) and isinstance(result.get(k), dict):
            result[k] = _merge(result[k], v)
        else:
            result[k] = v
    return result


async def get_collector_config(db) -> dict:
    if db is None:
        return deepcopy(DEFAULT_COLLECTOR_CONFIG)
    try:
        doc = await db[COLLECTION].find_one({"_id": "collector"})
        if doc and doc.get("config"):
            return _merge(DEFAULT_COLLECTOR_CONFIG, doc["config"])
    except Exception as e:
        logger.error("Failed to load collector config: %s", e)
    return deepcopy(DEFAULT_COLLECTOR_CONFIG)


async def save_collector_config(db, config: dict) -> dict:
    merged = _merge(DEFAULT_COLLECTOR_CONFIG, config)
    merged["version"] = int(merged.get("version", 0)) + 1
    if db is not None:
        try:
            await db[COLLECTION].update_one(
                {"_id": "collector"},
                {"$set": {"config": merged, "updated_at": __import__("datetime").datetime.utcnow()}},
                upsert=True,
            )
        except Exception as e:
            logger.error("Failed to save collector config: %s", e)
    return merged


async def load_ml_thresholds(db) -> dict:
    if db is None:
        return {}
    try:
        doc = await db[COLLECTION].find_one({"_id": "ml_thresholds"})
        if doc and doc.get("thresholds"):
            return doc["thresholds"]
    except Exception as e:
        logger.error("Failed to load ml thresholds: %s", e)
    return {}


async def save_ml_thresholds(db, thresholds: dict) -> dict:
    if db is not None:
        try:
            await db[COLLECTION].update_one(
                {"_id": "ml_thresholds"},
                {"$set": {"thresholds": thresholds, "updated_at": __import__("datetime").datetime.utcnow()}},
                upsert=True,
            )
        except Exception as e:
            logger.error("Failed to save ml thresholds: %s", e)
    return thresholds
