import logging
import os
from datetime import datetime, timezone

from fastapi import APIRouter
from starlette.requests import Request

from config import db, mongodb_connected, event_classifier, templates

logger = logging.getLogger(__name__)

opencode_router = APIRouter(prefix="/api/admin/opencode", tags=["Opencode"])


@opencode_router.get("/health")
async def opencode_health():
    """
    Статус системы для opencode: подключения, версии, ML модель.
    """
    model_info = event_classifier.neural_classifier.get_model_info() if hasattr(event_classifier, 'neural_classifier') else {"available": False}

    collections = {}
    if mongodb_connected and db is not None:
        try:
            for name in ["raw_sensor_data", "processed_events", "user_warnings", "obstacle_clusters"]:
                try:
                    collections[name] = await db[name].count_documents({})
                except Exception:
                    collections[name] = -1
        except Exception as e:
            logger.warning("Failed to query collection counts: %s", e)

    return {
        "service": "Good Road API",
        "version": "2.0.0",
        "time": datetime.now(timezone.utc).isoformat(),
        "mongodb": {
            "connected": mongodb_connected,
            "collections": collections,
        },
        "ml": {
            "model_available": model_info.get("available", False),
            "model_type": model_info.get("type", "none"),
            "backend": model_info.get("backend", "none"),
            "classes": model_info.get("classes", []),
            "window_size": model_info.get("window_size", 0),
        },
        "process": {
            "pid": os.getpid(),
            "cwd": os.getcwd(),
        },
    }


@opencode_router.get("/stats")
async def opencode_stats():
    """
    Агрегированная статистика по данным.
    """
    if not mongodb_connected or db is None:
        return {
            "error": "MongoDB not connected",
            "collections": {},
            "by_type": [],
        }

    by_type = []
    try:
        pipeline = [
            {"$group": {"_id": "$eventType", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}},
        ]
        raw = await db.processed_events.aggregate(pipeline).to_list(None)
        by_type = [{"eventType": r["_id"], "count": r["count"]} for r in raw]
    except Exception as e:
        logger.warning("Failed to aggregate events by type: %s", e)

    clusters_active = 0
    try:
        clusters_active = await db.obstacle_clusters.count_documents({"status": "active"})
    except Exception:
        pass

    collections = {}
    for name in ["raw_sensor_data", "processed_events", "user_warnings", "obstacle_clusters"]:
        try:
            collections[name] = await db[name].count_documents({})
        except Exception:
            collections[name] = -1

    return {
        "collections": collections,
        "clusters_active": clusters_active,
        "events_by_type": by_type,
        "time": datetime.now(timezone.utc).isoformat(),
    }
