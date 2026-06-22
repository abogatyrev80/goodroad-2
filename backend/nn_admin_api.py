"""
Neural Network Admin API
Endpoints для мониторинга inference, training и accuracy нейросети.
"""

import logging
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Query, HTTPException

logger = logging.getLogger(__name__)


def _serialize(obj):
    """Recursive serializer for MongoDB objects (datetime, ObjectId, etc.)"""
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {k: _serialize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_serialize(i) for i in obj]
    return obj

nn_admin_router = APIRouter(prefix="/api/admin/nn")

_inference_worker = None
_auto_trainer = None
_db = None


def init_nn_admin(db, inference_worker=None, auto_trainer=None):
    global _db, _inference_worker, _auto_trainer
    _db = db
    _inference_worker = inference_worker
    _auto_trainer = auto_trainer


@nn_admin_router.get("/inference-logs")
async def get_inference_logs(
    limit: int = Query(100, ge=1, le=5000),
    skip: int = Query(0, ge=0),
    device_id: Optional[str] = None,
    event_type: Optional[str] = None,
):
    if _db is None:
        raise HTTPException(status_code=503, detail="Database not available")

    query = {}
    if device_id:
        query["device_id"] = device_id
    if event_type:
        query["result_event_type"] = event_type

    total = await _db.inference_logs.count_documents(query)
    logs = await _db.inference_logs.find(
        query, {"_id": 0}
    ).sort("timestamp", -1).skip(skip).limit(limit).to_list(limit)

    return _serialize({
        "total": total,
        "limit": limit,
        "skip": skip,
        "returned": len(logs),
        "logs": logs,
    })


@nn_admin_router.get("/training-runs")
async def get_training_runs(
    limit: int = Query(20, ge=1, le=100),
):
    if _db is None:
        raise HTTPException(status_code=503, detail="Database not available")

    runs = await _db.training_runs.find(
        {}, {"_id": 0}
    ).sort("started_at", -1).limit(limit).to_list(limit)

    return _serialize({
        "total": await _db.training_runs.count_documents({}),
        "runs": runs,
    })


@nn_admin_router.get("/metrics")
async def get_nn_metrics():
    if _db is None:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        now = datetime.utcnow()
        last_24h = now - timedelta(hours=24)

        total_inference = await _db.inference_logs.count_documents({})
        last_24h_inference = await _db.inference_logs.count_documents(
            {"timestamp": {"$gte": last_24h}}
        )

        event_type_pipeline = [
            {"$match": {"result_event_type": {"$ne": None}}},
            {"$group": {
                "_id": "$result_event_type",
                "count": {"$sum": 1},
                "avg_confidence": {"$avg": "$result_confidence"},
                "avg_severity": {"$avg": "$result_severity"},
                "avg_processing_ms": {"$avg": "$processing_time_ms"},
            }},
            {"$sort": {"count": -1}}
        ]
        event_type_stats = await _db.inference_logs.aggregate(event_type_pipeline).to_list(20)

        method_pipeline = [
            {"$group": {
                "_id": "$detection_method",
                "count": {"$sum": 1},
            }}
        ]
        method_stats = await _db.inference_logs.aggregate(method_pipeline).to_list(10)

        severity_pipeline = [
            {"$match": {"result_severity": {"$ne": None}}},
            {"$group": {
                "_id": "$result_severity",
                "count": {"$sum": 1},
            }},
            {"$sort": {"_id": 1}}
        ]
        severity_stats = await _db.inference_logs.aggregate(severity_pipeline).to_list(10)

        last_run = await _db.training_runs.find_one(
            {"status": "completed"},
            sort=[("finished_at", -1)]
        )

        total_events = await _db.processed_events.count_documents({})

        return _serialize({
            "inference": {
                "total": total_inference,
                "last_24h": last_24h_inference,
            },
            "events": {
                "total": total_events,
            },
            "by_event_type": event_type_stats,
            "by_detection_method": method_stats,
            "by_severity": severity_stats,
            "last_training_run": {
                "run_id": last_run.get("run_id") if last_run else None,
                "finished_at": last_run.get("finished_at") if last_run else None,
                "accuracy": last_run.get("final_accuracy") if last_run else None,
                "val_accuracy": last_run.get("final_val_accuracy") if last_run else None,
                "model_path": last_run.get("model_path") if last_run else None,
            } if last_run else None,
            "worker_stats": _inference_worker.stats if _inference_worker else None,
            "trainer_stats": _auto_trainer.stats if _auto_trainer else None,
        })
    except Exception as e:
        logger.error(f"Metrics error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@nn_admin_router.post("/retrain")
async def trigger_retrain():
    if not _auto_trainer:
        raise HTTPException(status_code=503, detail="AutoTrainer not available")

    result = await _auto_trainer.trigger_manual_retrain()
    return {"message": result}


@nn_admin_router.get("/model-status")
async def get_model_status():
    worker_stats = _inference_worker.stats if _inference_worker else None
    trainer_stats = _auto_trainer.stats if _auto_trainer else None

    return {
        "worker": worker_stats,
        "trainer": trainer_stats,
        "timestamp": datetime.utcnow(),
    }


@nn_admin_router.get("/live-stats")
async def get_live_stats():
    if not _inference_worker:
        return {"error": "InferenceWorker not available"}

    return _inference_worker.stats
