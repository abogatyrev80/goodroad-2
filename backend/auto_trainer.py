"""
Auto-RetRAIN Pipeline
Проверяет количество размеченных данных и запускает переобучение модели
при достижении порога.
"""

import asyncio
import json
import logging
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List

logger = logging.getLogger(__name__)

RETRAIN_THRESHOLD = int(os.getenv('NN_RETRAIN_THRESHOLD', '1000'))
MIN_SAMPLES_PER_CLASS = int(os.getenv('NN_MIN_SAMPLES_PER_CLASS', '100'))
CHECK_INTERVAL = int(os.getenv('NN_RETRAIN_CHECK_INTERVAL', '300'))
MODEL_VERSIONING = os.getenv('NN_MODEL_VERSIONING', 'true').lower() == 'true'
EXTERNAL_TRAINING_ENABLED = os.getenv('EXTERNAL_TRAINING_ENABLED', 'false').lower() == 'true'
EXTERNAL_TRAINING_GPU_SERVER_URL = os.getenv('EXTERNAL_TRAINING_GPU_SERVER_URL', '')

BASE_DIR = Path(__file__).resolve().parent
TRAIN_SCRIPT = BASE_DIR / 'train_neural_model.py'
MODELS_DIR = BASE_DIR / 'models'


class AutoTrainer:
    """
    Фоновый процесс: проверяет достаточно ли данных для retrain,
    запускает обучение, логирует результаты.
    """

    def __init__(self, db, nn_classifier_ref=None, dataset_exporter=None):
        self.db = db
        self.nn_classifier_ref = nn_classifier_ref
        self.dataset_exporter = dataset_exporter
        self._task: Optional[asyncio.Task] = None
        self._running = False
        self._training = False
        self._stats: Dict[str, Any] = {
            'total_checks': 0,
            'retrains_triggered': 0,
            'retrains_completed': 0,
            'retrains_failed': 0,
            'current_threshold': RETRAIN_THRESHOLD,
            'last_check_at': None,
            'last_retrain_at': None,
            'last_training_run_id': None,
            'external_training_enabled': EXTERNAL_TRAINING_ENABLED,
        }

    @property
    def stats(self) -> Dict[str, Any]:
        return {**self._stats}

    async def start(self):
        if self._running:
            logger.warning("AutoTrainer already running")
            return
        self._running = True

        await self.db.training_runs.create_index([("started_at", -1)])
        await self.db.training_runs.create_index([("status", 1)])

        MODELS_DIR.mkdir(parents=True, exist_ok=True)

        logger.info(
            f"🚀 AutoTrainer started "
            f"(threshold={RETRAIN_THRESHOLD}, min_per_class={MIN_SAMPLES_PER_CLASS}, "
            f"check_interval={CHECK_INTERVAL}s)"
        )
        self._task = asyncio.create_task(self._run_loop())

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("🛑 AutoTrainer stopped")

    async def _run_loop(self):
        while self._running:
            try:
                await self._check_and_train()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"AutoTrainer check error: {e}", exc_info=True)
            await asyncio.sleep(CHECK_INTERVAL)

    async def _check_and_train(self):
        self._stats['total_checks'] += 1
        self._stats['last_check_at'] = datetime.utcnow()

        if self._training:
            return

        new_events_count = await self.db.processed_events.count_documents({
            "detection_method": {"$exists": True},
            "used_for_training": {"$ne": True}
        })

        if new_events_count < RETRAIN_THRESHOLD:
            logger.debug(
                f"AutoTrainer: {new_events_count}/{RETRAIN_THRESHOLD} new events"
            )
            return

        class_counts = await self._get_class_distribution()
        min_count = min(class_counts.values()) if class_counts else 0
        if min_count < MIN_SAMPLES_PER_CLASS:
            logger.info(
                f"AutoTrainer: enough total ({new_events_count}) but "
                f"min class has {min_count} < {MIN_SAMPLES_PER_CLASS}"
            )
            return

        logger.info(
            f"🔄 AutoTrainer: triggering retrain with {new_events_count} events, "
            f"class distribution: {class_counts}"
        )
        await self._run_training(new_events_count, class_counts)

    async def _get_class_distribution(self) -> Dict[str, int]:
        pipeline = [
            {"$match": {"eventType": {"$exists": True, "$ne": None}}},
            {"$group": {"_id": "$eventType", "count": {"$sum": 1}}}
        ]
        results = await self.db.processed_events.aggregate(pipeline).to_list(20)
        return {r['_id']: r['count'] for r in results}

    async def _run_training(self, total_events: int, class_distribution: Dict):
        self._training = True
        self._stats['retrains_triggered'] += 1

        run_id = f"run_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"
        run_doc = {
            "run_id": run_id,
            "started_at": datetime.utcnow(),
            "finished_at": None,
            "trigger": "data_threshold",
            "samples_used": total_events,
            "class_distribution": class_distribution,
            "epochs": 35,
            "final_accuracy": None,
            "final_val_accuracy": None,
            "model_path": None,
            "status": "running",
            "logs": [],
        }
        result = await self.db.training_runs.insert_one(run_doc)
        run_oid = result.inserted_id
        self._stats['last_training_run_id'] = run_id

        # Внешний сервер обучения
        if EXTERNAL_TRAINING_ENABLED and self.dataset_exporter:
            logger.info(f"🌐 Using external training server: {EXTERNAL_TRAINING_GPU_SERVER_URL}")
            await self._run_external_training(
                run_oid, run_id, total_events, class_distribution
            )
            return

        # Локальное обучение
        dataset_path = BASE_DIR / 'data' / 'training_export.json'
        model_version = self._get_next_model_version()
        model_path = MODELS_DIR / f'road_event_model_v{model_version}.keras'

        try:
            await self._export_training_data(dataset_path)

            training_result = await self._execute_training(
                dataset_path, model_path, run_id
            )

            if training_result['success']:
                await self.db.training_runs.update_one(
                    {"_id": run_oid},
                    {"$set": {
                        "finished_at": datetime.utcnow(),
                        "status": "completed",
                        "final_accuracy": training_result.get('accuracy'),
                        "final_val_accuracy": training_result.get('val_accuracy'),
                        "model_path": str(model_path),
                        "logs": training_result.get('logs', []),
                    }}
                )

                if self.nn_classifier_ref and model_path.exists():
                    try:
                        self.nn_classifier_ref.load_model(str(model_path))
                        logger.info(f"✅ Loaded new model: {model_path}")
                    except Exception as e:
                        logger.warning(f"Failed to hot-load model: {e}")

                await self._mark_data_as_used(total_events)

                self._stats['retrains_completed'] += 1
                self._stats['last_retrain_at'] = datetime.utcnow()
                logger.info(
                    f"✅ Training completed: accuracy={training_result.get('accuracy')}, "
                    f"val_accuracy={training_result.get('val_accuracy')}, "
                    f"model={model_path}"
                )
            else:
                await self.db.training_runs.update_one(
                    {"_id": run_oid},
                    {"$set": {
                        "finished_at": datetime.utcnow(),
                        "status": "failed",
                        "logs": training_result.get('logs', []),
                    }}
                )
                self._stats['retrains_failed'] += 1
                logger.error(f"❌ Training failed: {training_result.get('error')}")

        except Exception as e:
            await self.db.training_runs.update_one(
                {"_id": run_oid},
                {"$set": {
                    "finished_at": datetime.utcnow(),
                    "status": "failed",
                    "logs": [str(e)],
                }}
            )
            self._stats['retrains_failed'] += 1
            logger.error(f"❌ Training exception: {e}", exc_info=True)

        finally:
            self._training = False

    async def _run_external_training(
        self, run_oid, run_id: str, total_events: int, class_distribution: Dict
    ):
        """Запуск обучения на внешнем GPU-сервере"""
        try:
            # Создаем датасет
            dataset_result = await self.dataset_exporter.create_dataset(
                min_samples=100,
                min_per_class=10,
            )

            dataset_id = dataset_result.get('dataset_id')
            if not dataset_id or dataset_result.get('status') == 'empty':
                await self.db.training_runs.update_one(
                    {"_id": run_oid},
                    {"$set": {
                        "finished_at": datetime.utcnow(),
                        "status": "failed",
                        "logs": [f"Dataset creation failed: {dataset_result.get('error', 'empty')}"],
                    }}
                )
                self._stats['retrains_failed'] += 1
                self._training = False
                return

            await self.db.training_runs.update_one(
                {"_id": run_oid},
                {"$set": {
                    "dataset_id": dataset_id,
                    "logs": [f"Dataset created: {dataset_id} ({dataset_result.get('total_samples')} samples)"],
                }}
            )

            # Логируем триггер на внешний сервер
            logger.info(
                f"🚀 External training triggered: dataset={dataset_id}, "
                f"server={EXTERNAL_TRAINING_GPU_SERVER_URL}"
            )

            # Помечаем данные как использованные
            await self._mark_data_as_used(total_events)

            self._stats['retrains_completed'] += 1
            self._stats['last_retrain_at'] = datetime.utcnow()

            await self.db.training_runs.update_one(
                {"_id": run_oid},
                {"$set": {
                    "finished_at": datetime.utcnow(),
                    "status": "pending_webhook",
                    "logs": [
                        f"Dataset {dataset_id} ready",
                        f"External server: {EXTERNAL_TRAINING_GPU_SERVER_URL}",
                        "Waiting for webhook callback..."
                    ],
                }}
            )

        except Exception as e:
            await self.db.training_runs.update_one(
                {"_id": run_oid},
                {"$set": {
                    "finished_at": datetime.utcnow(),
                    "status": "failed",
                    "logs": [f"External training error: {str(e)}"],
                }}
            )
            self._stats['retrains_failed'] += 1
            logger.error(f"❌ External training exception: {e}", exc_info=True)
        finally:
            self._training = False

    def _get_next_model_version(self) -> int:
        if not MODEL_VERSIONING:
            return 0
        existing = list(MODELS_DIR.glob('road_event_model_v*.keras'))
        versions = []
        for f in existing:
            try:
                v = int(f.stem.split('_v')[-1])
                versions.append(v)
            except (ValueError, IndexError):
                pass
        return max(versions, default=0) + 1

    async def _export_training_data(self, output_path: Path):
        pipeline = [
            {"$match": {
                "eventType": {"$exists": True, "$ne": None},
                "accelerometer_x": {"$exists": True},
            }},
            {"$project": {
                "_id": 0,
                "label": "$eventType",
                "accelerometer_data": {
                    "$map": {
                        "input": [1],
                        "as": "one",
                        "in": {
                            "x": "$accelerometer_x",
                            "y": "$accelerometer_y",
                            "z": "$accelerometer_z"
                        }
                    }
                }
            }},
            {"$limit": 10000}
        ]
        events = await self.db.processed_events.aggregate(pipeline).to_list(10000)

        dataset = []
        for event in events:
            if event.get('label') and event.get('accelerometer_data'):
                dataset.append({
                    "label": event['label'],
                    "accelerometer_data": event['accelerometer_data']
                })

        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(dataset, indent=2), encoding='utf-8')
        logger.info(f"📤 Exported {len(dataset)} samples to {output_path}")

    async def _execute_training(
        self, dataset_path: Path, model_path: Path, run_id: str
    ) -> Dict:
        env = os.environ.copy()
        env['PYTHONIOENCODING'] = 'utf-8'

        cmd = [
            sys.executable, str(TRAIN_SCRIPT),
            '--dataset', str(dataset_path),
            '--output', str(model_path),
            '--seq-len', '64'
        ]

        training_logs = []

        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
                cwd=str(BASE_DIR)
            )

            stdout, stderr = await process.communicate()

            stdout_text = stdout.decode('utf-8', errors='replace') if stdout else ''
            stderr_text = stderr.decode('utf-8', errors='replace') if stderr else ''

            training_logs.extend(stdout_text.strip().split('\n') if stdout_text.strip() else [])
            if stderr_text.strip():
                training_logs.extend(
                    [f"[stderr] {l}" for l in stderr_text.strip().split('\n')]
                )

            if process.returncode != 0:
                return {
                    'success': False,
                    'error': f"Process exited with code {process.returncode}",
                    'logs': training_logs
                }

            accuracy = self._parse_accuracy(stdout_text)
            val_accuracy = self._parse_val_accuracy(stdout_text)

            return {
                'success': True,
                'accuracy': accuracy,
                'val_accuracy': val_accuracy,
                'logs': training_logs
            }

        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'logs': training_logs
            }

    def _parse_accuracy(self, output: str) -> Optional[float]:
        for line in reversed(output.split('\n')):
            if 'accuracy' in line.lower() and ':' in line:
                try:
                    parts = line.split(':')
                    for part in reversed(parts):
                        val = float(part.strip().split()[-1])
                        if 0 <= val <= 1:
                            return round(val, 4)
                except (ValueError, IndexError):
                    continue
        return None

    def _parse_val_accuracy(self, output: str) -> Optional[float]:
        for line in reversed(output.split('\n')):
            if 'val_accuracy' in line.lower() and ':' in line:
                try:
                    parts = line.split('val_accuracy:')
                    if len(parts) > 1:
                        val = float(parts[-1].strip().split()[0])
                        if 0 <= val <= 1:
                            return round(val, 4)
                except (ValueError, IndexError):
                    continue
        return None

    async def _mark_data_as_used(self, count: int):
        await self.db.processed_events.update_many(
            {"used_for_training": {"$ne": True}},
            {"$set": {"used_for_training": True}},
            upsert=False
        )

    async def trigger_manual_retrain(self) -> str:
        """Ручной запуск retrain из admin API"""
        if self._training:
            return "Training already in progress"

        total = await self.db.processed_events.count_documents({})
        class_dist = await self._get_class_distribution()

        if total < 10:
            return f"Not enough data: {total} events (need at least 10)"

        asyncio.create_task(self._run_training(total, class_dist))
        return f"Training started with {total} events"
