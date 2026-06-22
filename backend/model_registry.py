"""
Model Registry
Управление версиями моделей: загрузка, активация, хранение.
"""

import logging
import os
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any, Callable

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent
MODELS_DIR = BASE_DIR / 'models'
EXTERNAL_MODELS_DIR = BASE_DIR / 'models' / 'external'


class ModelRegistry:
    """Реестр моделей с поддержкой версионирования и hot-reload"""

    def __init__(self, db, nn_classifier_ref=None):
        self.db = db
        self.nn_classifier_ref = nn_classifier_ref
        self._on_activate_callback: Optional[Callable] = None
        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        EXTERNAL_MODELS_DIR.mkdir(parents=True, exist_ok=True)

    def set_on_activate_callback(self, callback: Callable):
        self._on_activate_callback = callback

    async def upload_model(
        self,
        model_file_bytes: bytes,
        filename: str,
        dataset_id: Optional[str] = None,
        accuracy: Optional[float] = None,
        val_accuracy: Optional[float] = None,
        notes: Optional[str] = None,
    ) -> Dict[str, Any]:
        model_id = f"model_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"

        version = await self._next_version()
        safe_name = f"road_event_model_v{version}.keras"
        model_path = EXTERNAL_MODELS_DIR / f"{model_id}_{safe_name}"

        model_path.write_bytes(model_file_bytes)

        meta = {
            "model_id": model_id,
            "version": version,
            "filename": safe_name,
            "original_filename": filename,
            "dataset_id": dataset_id,
            "accuracy": accuracy,
            "val_accuracy": val_accuracy,
            "notes": notes,
            "file_path": str(model_path),
            "file_size_bytes": len(model_file_bytes),
            "status": "uploaded",
            "activated": False,
            "activated_at": None,
            "created_at": datetime.utcnow().isoformat(),
        }

        await self.db.models.insert_one(meta)

        logger.info(f"📦 Model uploaded: {model_id} v{version} ({len(model_file_bytes)} bytes)")
        return meta

    async def list_models(self, limit: int = 20) -> List[Dict]:
        return await self.db.models.find(
            {}, {"_id": 0}
        ).sort("created_at", -1).limit(limit).to_list(limit)

    async def get_model(self, model_id: str) -> Optional[Dict]:
        return await self.db.models.find_one(
            {"model_id": model_id}, {"_id": 0}
        )

    async def activate_model(self, model_id: str) -> Dict[str, Any]:
        meta = await self.get_model(model_id)
        if not meta:
            return {"success": False, "error": "Model not found"}

        if meta.get("status") == "failed":
            return {"success": False, "error": "Cannot activate failed model"}

        model_path = Path(meta.get("file_path", ""))
        if not model_path.exists():
            return {"success": False, "error": f"Model file not found: {model_path}"}

        await self.db.models.update_many(
            {"activated": True},
            {"$set": {"activated": False}}
        )

        await self.db.models.update_one(
            {"model_id": model_id},
            {"$set": {
                "activated": True,
                "activated_at": datetime.utcnow().isoformat(),
                "status": "active",
            }}
        )

        if self.nn_classifier_ref:
            try:
                self.nn_classifier_ref.load_model(str(model_path))
                logger.info(f"✅ Hot-loaded model {model_id} v{meta.get('version')}")
            except Exception as e:
                logger.error(f"❌ Failed to hot-load model: {e}")
                return {"success": False, "error": f"Load failed: {str(e)}"}

        if self._on_activate_callback:
            try:
                await self._on_activate_callback(model_path)
            except Exception as e:
                logger.warning(f"Activate callback error: {e}")

        return {
            "success": True,
            "model_id": model_id,
            "version": meta.get("version"),
            "activated_at": datetime.utcnow().isoformat(),
        }

    async def delete_model(self, model_id: str) -> bool:
        meta = await self.get_model(model_id)
        if not meta:
            return False
        if meta.get("activated"):
            return False
        file_path = Path(meta.get("file_path", ""))
        if file_path.exists():
            file_path.unlink()
        result = await self.db.models.delete_one({"model_id": model_id})
        return result.deleted_count > 0

    async def get_active_model(self) -> Optional[Dict]:
        return await self.db.models.find_one(
            {"activated": True}, {"_id": 0}
        )

    async def _next_version(self) -> int:
        count = await self.db.models.count_documents({})
        return count + 1

    async def mark_model_failed(self, model_id: str, error: str):
        await self.db.models.update_one(
            {"model_id": model_id},
            {"$set": {"status": "failed", "error": error}}
        )
