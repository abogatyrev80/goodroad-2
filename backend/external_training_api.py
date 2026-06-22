"""
External Training API
Endpoints для интеграции с внешним GPU-сервером для обучения моделей.
"""

import logging
import os
import uuid
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Query, HTTPException, UploadFile, File, Form, Header, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

external_training_router = APIRouter(prefix="/api/external")

_dataset_exporter = None
_model_registry = None
_db = None
_api_key = None


def init_external_training(db, dataset_exporter, model_registry):
    global _db, _dataset_exporter, _model_registry, _api_key
    _db = db
    _dataset_exporter = dataset_exporter
    _model_registry = model_registry
    _api_key = os.getenv('EXTERNAL_TRAINING_API_KEY')


def _verify_api_key(x_api_key: Optional[str] = Header(None)):
    if _api_key and x_api_key != _api_key:
        raise HTTPException(status_code=401, detail="Invalid API key")


class DatasetCreateRequest(BaseModel):
    min_samples: int = Field(default=1000, ge=10)
    min_per_class: int = Field(default=100, ge=5)
    event_types: Optional[List[str]] = None
    seq_len: int = Field(default=64, ge=1, le=512)
    webhook_url: Optional[str] = None


class TrainingTriggerRequest(BaseModel):
    dataset_id: str
    epochs: int = Field(default=35, ge=1, le=200)
    batch_size: int = Field(default=32, ge=8, le=256)
    seq_len: int = Field(default=64, ge=1, le=512)
    webhook_url: Optional[str] = None


class WebhookTrainingComplete(BaseModel):
    dataset_id: str
    model_id: Optional[str] = None
    status: str
    accuracy: Optional[float] = None
    val_accuracy: Optional[float] = None
    model_download_url: Optional[str] = None
    training_time_seconds: Optional[float] = None
    notes: Optional[str] = None


def _serialize(obj):
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {k: _serialize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_serialize(i) for i in obj]
    return obj


# ─── Dataset Endpoints ────────────────────────────────────────────────────────

@external_training_router.post("/dataset/create")
async def create_dataset(req: DatasetCreateRequest, x_api_key: Optional[str] = Header(None)):
    _verify_api_key(x_api_key)
    if _dataset_exporter is None:
        raise HTTPException(status_code=503, detail="DatasetExporter not available")

    result = await _dataset_exporter.create_dataset(
        min_samples=req.min_samples,
        min_per_class=req.min_per_class,
        event_types=req.event_types,
        seq_len=req.seq_len,
        webhook_url=req.webhook_url,
    )

    return _serialize(result)


@external_training_router.get("/dataset/{dataset_id}")
async def get_dataset(dataset_id: str, x_api_key: Optional[str] = Header(None)):
    _verify_api_key(x_api_key)
    if _dataset_exporter is None:
        raise HTTPException(status_code=503, detail="DatasetExporter not available")

    meta = await _dataset_exporter.get_dataset(dataset_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Dataset not found")

    return _serialize(meta)


@external_training_router.get("/dataset/{dataset_id}/download")
async def download_dataset(dataset_id: str, x_api_key: Optional[str] = Header(None)):
    _verify_api_key(x_api_key)
    if _dataset_exporter is None:
        raise HTTPException(status_code=503, detail="DatasetExporter not available")

    file_path = await _dataset_exporter.get_dataset_file_path(dataset_id)
    if not file_path:
        raise HTTPException(status_code=404, detail="Dataset file not found")

    return FileResponse(
        path=str(file_path),
        media_type="application/json",
        filename=f"{dataset_id}.json",
    )


@external_training_router.get("/datasets")
async def list_datasets(
    limit: int = Query(20, ge=1, le=100),
    x_api_key: Optional[str] = Header(None),
):
    _verify_api_key(x_api_key)
    if _dataset_exporter is None:
        raise HTTPException(status_code=503, detail="DatasetExporter not available")

    datasets = await _dataset_exporter.list_datasets(limit=limit)
    return _serialize({"datasets": datasets, "count": len(datasets)})


@external_training_router.delete("/dataset/{dataset_id}")
async def delete_dataset(dataset_id: str, x_api_key: Optional[str] = Header(None)):
    _verify_api_key(x_api_key)
    if _dataset_exporter is None:
        raise HTTPException(status_code=503, detail="DatasetExporter not available")

    deleted = await _dataset_exporter.delete_dataset(dataset_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Dataset not found")

    return {"message": f"Dataset {dataset_id} deleted"}


# ─── Model Endpoints ──────────────────────────────────────────────────────────

@external_training_router.post("/model/upload")
async def upload_model(
    file: UploadFile = File(...),
    dataset_id: Optional[str] = Form(None),
    accuracy: Optional[float] = Form(None),
    val_accuracy: Optional[float] = Form(None),
    notes: Optional[str] = Form(None),
    x_api_key: Optional[str] = Header(None),
):
    _verify_api_key(x_api_key)
    if _model_registry is None:
        raise HTTPException(status_code=503, detail="ModelRegistry not available")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    result = await _model_registry.upload_model(
        model_file_bytes=content,
        filename=file.filename or "model.keras",
        dataset_id=dataset_id,
        accuracy=accuracy,
        val_accuracy=val_accuracy,
        notes=notes,
    )

    return _serialize(result)


@external_training_router.get("/models")
async def list_models(
    limit: int = Query(20, ge=1, le=100),
    x_api_key: Optional[str] = Header(None),
):
    _verify_api_key(x_api_key)
    if _model_registry is None:
        raise HTTPException(status_code=503, detail="ModelRegistry not available")

    models = await _model_registry.list_models(limit=limit)
    return _serialize({"models": models, "count": len(models)})


@external_training_router.get("/model/{model_id}")
async def get_model(model_id: str, x_api_key: Optional[str] = Header(None)):
    _verify_api_key(x_api_key)
    if _model_registry is None:
        raise HTTPException(status_code=503, detail="ModelRegistry not available")

    meta = await _model_registry.get_model(model_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Model not found")

    return _serialize(meta)


@external_training_router.post("/model/{model_id}/activate")
async def activate_model(model_id: str, x_api_key: Optional[str] = Header(None)):
    _verify_api_key(x_api_key)
    if _model_registry is None:
        raise HTTPException(status_code=503, detail="ModelRegistry not available")

    result = await _model_registry.activate_model(model_id)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Activation failed"))

    return _serialize(result)


@external_training_router.delete("/model/{model_id}")
async def delete_model(model_id: str, x_api_key: Optional[str] = Header(None)):
    _verify_api_key(x_api_key)
    if _model_registry is None:
        raise HTTPException(status_code=503, detail="ModelRegistry not available")

    deleted = await _model_registry.delete_model(model_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Model not found or is active")

    return {"message": f"Model {model_id} deleted"}


# ─── Training Status & Trigger ────────────────────────────────────────────────

@external_training_router.get("/training/status")
async def get_training_status(x_api_key: Optional[str] = Header(None)):
    _verify_api_key(x_api_key)
    if _db is None:
        raise HTTPException(status_code=503, detail="Database not available")

    total_datasets = await _db.datasets.count_documents({})
    total_models = await _db.models.count_documents({})
    active_model = await _model_registry.get_active_model() if _model_registry else None

    latest_run = await _db.training_runs.find_one(
        sort=[("started_at", -1)]
    )

    return _serialize({
        "total_datasets": total_datasets,
        "total_models": total_models,
        "active_model": active_model,
        "latest_run": latest_run,
        "timestamp": datetime.utcnow(),
    })


@external_training_router.get("/training/runs")
async def get_training_runs(
    limit: int = Query(20, ge=1, le=100),
    x_api_key: Optional[str] = Header(None),
):
    _verify_api_key(x_api_key)
    if _db is None:
        raise HTTPException(status_code=503, detail="Database not available")

    runs = await _db.training_runs.find(
        {}, {"_id": 0}
    ).sort("started_at", -1).limit(limit).to_list(limit)

    return _serialize({"runs": runs, "count": len(runs)})


@external_training_router.post("/training/trigger")
async def trigger_training(req: TrainingTriggerRequest, x_api_key: Optional[str] = Header(None)):
    _verify_api_key(x_api_key)
    if _db is None:
        raise HTTPException(status_code=503, detail="Database not available")

    meta = await _db.datasets.find_one({"dataset_id": req.dataset_id})
    if not meta:
        raise HTTPException(status_code=404, detail="Dataset not found")

    run_id = f"ext_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"
    run_doc = {
        "run_id": run_id,
        "started_at": datetime.utcnow(),
        "finished_at": None,
        "trigger": "external_api",
        "dataset_id": req.dataset_id,
        "epochs": req.epochs,
        "batch_size": req.batch_size,
        "seq_len": req.seq_len,
        "webhook_url": req.webhook_url,
        "status": "pending",
        "accuracy": None,
        "val_accuracy": None,
        "model_path": None,
        "logs": [],
    }
    await _db.training_runs.insert_one(run_doc)

    logger.info(f"🚀 External training triggered: {run_id} (dataset={req.dataset_id})")

    return _serialize({
        "run_id": run_id,
        "status": "pending",
        "dataset_id": req.dataset_id,
        "message": "Training job created. GPU server should poll or receive webhook.",
    })


# ─── Webhook (callback from GPU server) ──────────────────────────────────────

@external_training_router.post("/webhook/training-complete")
async def webhook_training_complete(body: WebhookTrainingComplete, request: Request):
    webhook_secret = os.getenv('EXTERNAL_TRAINING_WEBHOOK_SECRET')
    if webhook_secret:
        provided = request.headers.get("X-Webhook-Secret")
        if provided != webhook_secret:
            raise HTTPException(status_code=401, detail="Invalid webhook secret")

    if _db is None:
        raise HTTPException(status_code=503, detail="Database not available")

    logger.info(f"📥 Webhook received: dataset={body.dataset_id}, status={body.status}")

    await _db.training_runs.update_one(
        {"dataset_id": body.dataset_id, "trigger": "external_api"},
        {"$set": {
            "finished_at": datetime.utcnow(),
            "status": body.status,
            "accuracy": body.accuracy,
            "val_accuracy": body.val_accuracy,
            "logs": [f"Webhook: {body.notes or body.status}"],
        }}
    )

    if body.status == "completed" and body.model_download_url:
        logger.info(f"✅ External training completed: {body.dataset_id}")

    return {"message": "Webhook processed", "dataset_id": body.dataset_id}
