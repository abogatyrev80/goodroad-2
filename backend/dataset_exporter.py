"""
Dataset Exporter
Экспорт данных из MongoDB processed_events в JSON для внешнего обучения.
"""

import json
import logging
import os
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Any

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent
DATASETS_DIR = BASE_DIR / 'datasets'
DATASET_TTL_HOURS = int(os.getenv('EXTERNAL_TRAINING_DATASET_TTL', '24'))

LABEL_ALIASES = {
    "speedbump": "speed_bump",
    "speed-bump": "speed_bump",
}

VALID_LABELS = {"pothole", "speed_bump", "bump", "braking", "vibration"}


def normalize_label(label: str) -> str:
    normalized = label.strip().lower()
    return LABEL_ALIASES.get(normalized, normalized)


class DatasetExporter:
    """Экспорт обработанных событий из MongoDB в JSON для обучения"""

    def __init__(self, db):
        self.db = db
        DATASETS_DIR.mkdir(parents=True, exist_ok=True)

    async def create_dataset(
        self,
        min_samples: int = 1000,
        min_per_class: int = 100,
        event_types: Optional[List[str]] = None,
        seq_len: int = 64,
        webhook_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        dataset_id = f"ds_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"

        query: Dict[str, Any] = {
            "eventType": {"$exists": True, "$ne": None},
            "accelerometer_x": {"$exists": True},
        }
        if event_types:
            query["eventType"] = {"$in": event_types}

        pipeline = [
            {"$match": query},
            {"$group": {
                "_id": "$eventType",
                "count": {"$sum": 1},
                "samples": {
                    "$push": {
                        "label": "$eventType",
                        "accelerometer_data": [
                            {"x": "$accelerometer_x", "y": "$accelerometer_y", "z": "$accelerometer_z"}
                        ],
                        "latitude": "$latitude",
                        "longitude": "$longitude",
                        "speed": "$speed",
                        "severity": "$severity",
                        "confidence": "$confidence",
                        "detection_method": "$detection_method",
                        "timestamp": "$timestamp",
                    }
                }
            }},
        ]

        groups = await self.db.processed_events.aggregate(pipeline).to_list(100)

        class_distribution: Dict[str, int] = {}
        all_samples = []
        skipped = 0

        for group in groups:
            label = group["_id"]
            normalized = normalize_label(label)
            if normalized not in VALID_LABELS:
                skipped += len(group.get("samples", []))
                continue

            samples = group.get("samples", [])
            class_distribution[normalized] = len(samples)

            for sample in samples:
                sample["label"] = normalized
                all_samples.append(sample)

        if not all_samples:
            return {
                "dataset_id": dataset_id,
                "status": "empty",
                "total_samples": 0,
                "class_distribution": {},
                "error": "No valid samples found",
            }

        min_class_count = min(class_distribution.values()) if class_distribution else 0
        if min_class_count < min_per_class:
            return {
                "dataset_id": dataset_id,
                "status": "insufficient_data",
                "total_samples": len(all_samples),
                "class_distribution": class_distribution,
                "error": f"Min per class: {min_class_count} < {min_per_class}",
            }

        if len(all_samples) < min_samples:
            return {
                "dataset_id": dataset_id,
                "status": "insufficient_data",
                "total_samples": len(all_samples),
                "class_distribution": class_distribution,
                "error": f"Total samples: {len(all_samples)} < {min_samples}",
            }

        dataset_path = DATASETS_DIR / f"{dataset_id}.json"
        dataset_path.write_text(json.dumps(all_samples, indent=2, default=str), encoding='utf-8')

        expires_at = datetime.utcnow() + timedelta(hours=DATASET_TTL_HOURS)

        meta = {
            "dataset_id": dataset_id,
            "status": "ready",
            "total_samples": len(all_samples),
            "class_distribution": class_distribution,
            "seq_len": seq_len,
            "file_path": str(dataset_path),
            "file_size_bytes": dataset_path.stat().st_size,
            "webhook_url": webhook_url,
            "created_at": datetime.utcnow().isoformat(),
            "expires_at": expires_at.isoformat(),
            "skipped_samples": skipped,
        }

        await self.db.datasets.insert_one(meta)

        logger.info(f"📦 Dataset created: {dataset_id} ({len(all_samples)} samples)")
        return meta

    async def get_dataset(self, dataset_id: str) -> Optional[Dict]:
        return await self.db.datasets.find_one(
            {"dataset_id": dataset_id}, {"_id": 0}
        )

    async def get_dataset_file_path(self, dataset_id: str) -> Optional[Path]:
        meta = await self.get_dataset(dataset_id)
        if not meta:
            return None
        path = Path(meta.get("file_path", ""))
        return path if path.exists() else None

    async def list_datasets(self, limit: int = 20) -> List[Dict]:
        return await self.db.datasets.find(
            {}, {"_id": 0}
        ).sort("created_at", -1).limit(limit).to_list(limit)

    async def delete_dataset(self, dataset_id: str) -> bool:
        meta = await self.get_dataset(dataset_id)
        if not meta:
            return False
        file_path = Path(meta.get("file_path", ""))
        if file_path.exists():
            file_path.unlink()
        result = await self.db.datasets.delete_one({"dataset_id": dataset_id})
        return result.deleted_count > 0

    async def cleanup_expired(self) -> int:
        now = datetime.utcnow()
        expired = await self.db.datasets.find({
            "expires_at": {"$lt": now.isoformat()}
        }).to_list(100)
        deleted = 0
        for ds in expired:
            await self.delete_dataset(ds["dataset_id"])
            deleted += 1
        if deleted:
            logger.info(f"🗑️ Cleaned up {deleted} expired datasets")
        return deleted
