"""
Background Inference Worker
Периодически обрабатывает сырые данные из MongoDB через ML-классификатор
и логирует каждое предсказание для визуального мониторинга.
"""

import asyncio
import logging
import os
import time
from datetime import datetime
from typing import Optional, Dict, Any, List

logger = logging.getLogger(__name__)

INFERENCE_INTERVAL = int(os.getenv('NN_INFERENCE_INTERVAL', '30'))
BATCH_SIZE = int(os.getenv('NN_INFERENCE_BATCH_SIZE', '50'))
USE_NN_BACKEND = os.getenv('NN_USE_NN_BACKEND', 'false').lower() == 'true'


class InferenceWorker:
    """
    Фоновый поток: берёт необработанные данные из raw_sensor_data,
    прогоняет через EventClassifier, сохраняет результат в processed_events
    и пишет логи предсказаний в inference_logs.
    """

    def __init__(self, db, event_classifier, obstacle_clusterer=None):
        self.db = db
        self.event_classifier = event_classifier
        self.obstacle_clusterer = obstacle_clusterer
        self._task: Optional[asyncio.Task] = None
        self._running = False
        self._nn_backend = None
        self._stats: Dict[str, Any] = {
            'total_processed': 0,
            'events_detected': 0,
            'neural_predictions': 0,
            'heuristic_predictions': 0,
            'errors': 0,
            'started_at': None,
            'last_batch_at': None,
            'last_batch_count': 0,
            'last_batch_ms': 0,
            'backend_name': None,
        }

    @property
    def stats(self) -> Dict[str, Any]:
        s = {**self._stats}
        if s['total_processed'] > 0:
            s['neural_ratio'] = round(
                s['neural_predictions'] / max(s['events_detected'], 1) * 100, 1
            )
        else:
            s['neural_ratio'] = 0
        return s

    async def start(self):
        if self._running:
            logger.warning("InferenceWorker already running")
            return
        self._running = True
        self._stats['started_at'] = datetime.utcnow()

        await self.db.inference_logs.create_index([("timestamp", -1)])
        await self.db.inference_logs.create_index([("device_id", 1)])
        await self.db.raw_sensor_data.create_index([("processed_by_inference", 1), ("timestamp", 1)])

        if USE_NN_BACKEND:
            self._init_nn_backend()

        logger.info(
            f"InferenceWorker started (interval={INFERENCE_INTERVAL}s, batch={BATCH_SIZE}, backend={self._stats.get('backend_name', 'event_classifier')})"
        )
        self._task = asyncio.create_task(self._run_loop())

    def _init_nn_backend(self):
        """Initialize nn_backend for direct neural network inference."""
        try:
            from nn_backend import create_backend
            model_path = os.getenv('NEURAL_MODEL_PATH', 'models/accel_lstm.pt')
            if not os.path.exists(model_path):
                logger.warning(f"NN model not found: {model_path}, using EventClassifier")
                return

            self._nn_backend = create_backend()
            self._nn_backend.load(model_path)
            self._stats['backend_name'] = self._nn_backend.name
            logger.info(f"NN backend initialized: {self._nn_backend.name}")
        except Exception as e:
            logger.warning(f"Failed to init nn_backend: {e}, using EventClassifier")
            self._nn_backend = None

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("🛑 InferenceWorker stopped")

    async def _run_loop(self):
        while self._running:
            try:
                await self._process_batch()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"InferenceWorker error: {e}", exc_info=True)
                self._stats['errors'] += 1
            await asyncio.sleep(INFERENCE_INTERVAL)

    async def _process_batch(self):
        now = datetime.utcnow()

        raw_docs = await self.db.raw_sensor_data.find(
            {"processed_by_inference": {"$ne": True}}
        ).sort("timestamp", 1).limit(BATCH_SIZE).to_list(BATCH_SIZE)

        if not raw_docs:
            return

        logger.info(f"📥 Inference batch: {len(raw_docs)} records")
        batch_start = time.monotonic()
        events_in_batch = 0
        neural_in_batch = 0

        for doc in raw_docs:
            try:
                event, method = await self._process_single(doc)
                await self.db.raw_sensor_data.update_one(
                    {"_id": doc["_id"]},
                    {"$set": {"processed_by_inference": True}}
                )
                if event:
                    events_in_batch += 1
                    if method == 'neural_network':
                        neural_in_batch += 1
            except Exception as e:
                logger.error(f"Error processing doc {doc.get('_id')}: {e}")
                self._stats['errors'] += 1

        batch_elapsed = (time.monotonic() - batch_start) * 1000
        self._stats['last_batch_at'] = now
        self._stats['last_batch_count'] = len(raw_docs)
        self._stats['last_batch_ms'] = round(batch_elapsed, 1)
        logger.info(
            f"✅ Batch done: {len(raw_docs)} processed, "
            f"{events_in_batch} events, {neural_in_batch} neural — {batch_elapsed:.1f}ms"
        )

    async def _process_single(self, doc: Dict) -> tuple:
        accel_x = doc.get('accelerometer_x', 0)
        accel_y = doc.get('accelerometer_y', 0)
        accel_z = doc.get('accelerometer_z', 0)
        speed = doc.get('speed', 0)
        device_id = doc.get('deviceId', 'unknown')
        timestamp = doc.get('timestamp', datetime.utcnow())
        latitude = doc.get('latitude')
        longitude = doc.get('longitude')

        inference_start = time.monotonic()

        event = self.event_classifier.analyze_data_point(
            device_id=device_id,
            accel_x=accel_x,
            accel_y=accel_y,
            accel_z=accel_z,
            speed=speed
        )

        inference_ms = (time.monotonic() - inference_start) * 1000

        self._stats['total_processed'] += 1

        detection_method = 'heuristic'
        event_type = None
        confidence = 0.0
        severity = 5

        if event and event.get('eventType'):
            event_type = event['eventType']
            confidence = event.get('confidence', 0)
            severity = event.get('severity', 5)
            detection_method = event.get('detection_method', 'heuristic')

            self._stats['events_detected'] += 1
            if detection_method == 'neural_network':
                self._stats['neural_predictions'] += 1
            else:
                self._stats['heuristic_predictions'] += 1

            cluster_id = None
            if self.obstacle_clusterer and latitude and longitude:
                try:
                    cluster_id = await self.obstacle_clusterer.process_event(
                        event={
                            'eventType': event_type,
                            'severity': severity,
                            'latitude': latitude,
                            'longitude': longitude,
                            'speed': speed
                        },
                        device_id=device_id
                    )
                except Exception as e:
                    logger.warning(f"Clustering error: {e}")

            processed_event = {
                "id": str(doc.get('_id')),
                "deviceId": device_id,
                "timestamp": timestamp,
                "eventType": event_type,
                "severity": severity,
                "confidence": confidence,
                "latitude": latitude,
                "longitude": longitude,
                "speed": speed,
                "accelerometer_x": accel_x,
                "accelerometer_y": accel_y,
                "accelerometer_z": accel_z,
                "accelerometer_magnitude": event.get('accelerometer', {}).get('magnitude', 0),
                "accelerometer_deltaY": event.get('accelerometer', {}).get('deltaY', 0),
                "accelerometer_deltaZ": event.get('accelerometer', {}).get('deltaZ', 0),
                "accelerometer_variance": event.get('accelerometer', {}).get('variance', 0),
                "roadType": event.get('roadType', 'unknown'),
                "clusterId": cluster_id,
                "detection_method": detection_method,
                "created_at": datetime.utcnow()
            }
            await self.db.processed_events.insert_one(processed_event)

        log_doc = {
            "timestamp": datetime.utcnow(),
            "device_id": device_id,
            "input_samples": 1,
            "processing_time_ms": round(inference_ms, 2),
            "detection_method": detection_method,
            "result_event_type": event_type,
            "result_confidence": round(confidence, 4),
            "result_severity": severity,
            "latitude": latitude,
            "longitude": longitude,
            "speed": speed,
        }
        await self.db.inference_logs.insert_one(log_doc)

        return (event, detection_method) if event else (None, detection_method)
