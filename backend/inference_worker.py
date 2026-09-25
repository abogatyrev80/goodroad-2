"""
Background Inference Worker
Периодически обрабатывает сырые данные из MongoDB через ML-классификатор
и логирует каждое предсказание для визуального мониторинга.
"""

import asyncio
import logging
import math
import os
import time
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

import warning_service
from ingestion_validation import MAX_SENSOR_AXIS, MAX_SAMPLES_PER_EVENT

logger = logging.getLogger(__name__)

INFERENCE_INTERVAL = int(os.getenv('NN_INFERENCE_INTERVAL', '30'))
BATCH_SIZE = int(os.getenv('NN_INFERENCE_BATCH_SIZE', '50'))
MAX_ATTEMPTS = int(os.getenv('NN_INFERENCE_MAX_ATTEMPTS', '3'))
RETRY_SECONDS = int(os.getenv('NN_INFERENCE_RETRY_SECONDS', '60'))
USE_NN_BACKEND = os.getenv('NN_USE_NN_BACKEND', 'false').lower() == 'true'


class ClassificationError(ValueError):
    """Deterministic malformed input/output or classifier arithmetic failure."""


class InferenceWorker:
    """
    Фоновый поток: берёт необработанные данные из raw_sensor_data,
    прогоняет через EventClassifier, сохраняет результат в processed_events
    и пишет логи предсказаний в inference_logs.
    """

    def __init__(self, db, event_classifier, obstacle_clusterer=None):
        if min(INFERENCE_INTERVAL, BATCH_SIZE, MAX_ATTEMPTS, RETRY_SECONDS) <= 0:
            raise ValueError("Inference interval, batch size, max attempts and retry delay must be positive")
        self.db = db
        self.event_classifier = event_classifier
        self.obstacle_clusterer = obstacle_clusterer
        self._task: Optional[asyncio.Task] = None
        self._running = False
        self._nn_backend = None
        self._retry_after = {}
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
        await self.db.inference_logs.create_index([("timestamp", -1)])
        await self.db.inference_logs.create_index([("device_id", 1)])
        await self.db.raw_sensor_data.create_index([("processed_by_inference", 1), ("timestamp", 1)])
        await self.db.processed_events.create_index([("id", 1)])

        if USE_NN_BACKEND:
            self._init_nn_backend()

        self._running = True
        self._stats['started_at'] = datetime.utcnow()
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
        self._retry_after = {key: deadline for key, deadline in self._retry_after.items() if deadline > now}

        raw_docs = await self.db.raw_sensor_data.find(
            {
                "_id": {"$nin": list(self._retry_after)},
                "processed_by_inference": {"$ne": True},
                "inference_quarantined": {"$ne": True},
                "$and": [
                    {"$or": [
                        {"inference_attempts": {"$exists": False}},
                        {"inference_attempts": {"$lt": MAX_ATTEMPTS}},
                    ]},
                    {"$or": [
                        {"inference_retry_after": {"$exists": False}},
                        {"inference_retry_after": {"$lte": now}},
                    ]},
                ],
            }
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
                    {"$set": {"processed_by_inference": True}, "$unset": {"inference_retry_after": ""}}
                )
                self._retry_after.pop(doc['_id'], None)
                if event:
                    events_in_batch += 1
                    if method == 'neural_network':
                        neural_in_batch += 1
            except Exception as e:
                logger.error(f"Error processing doc {doc.get('_id')}: {e}")
                self._stats['errors'] += 1
                retry_after = datetime.utcnow() + timedelta(seconds=RETRY_SECONDS)
                self._retry_after[doc['_id']] = retry_after
                classification_failed = isinstance(e, ClassificationError)
                update = {"$set": {
                    "inference_last_error": str(e)[:1000],
                    "inference_failed_at": datetime.utcnow(),
                    "inference_retry_after": retry_after,
                    "inference_failure_kind": "classification" if classification_failed else "transient",
                }}
                if classification_failed:
                    update['$inc'] = {'inference_attempts': 1}
                try:
                    failed = await self.db.raw_sensor_data.find_one_and_update(
                        {"_id": doc["_id"], "processed_by_inference": {"$ne": True}},
                        update, return_document=ReturnDocument.AFTER,
                    )
                    if classification_failed and failed and failed.get("inference_attempts", 0) >= MAX_ATTEMPTS:
                        await self.db.raw_sensor_data.update_one(
                            {"_id": doc["_id"], "processed_by_inference": {"$ne": True}},
                            {"$set": {"inference_quarantined": True}},
                        )
                except Exception:
                    # Keep local backoff if Mongo cannot persist it; continue later records.
                    logger.exception("Could not save inference retry state for %s", doc['_id'])

        batch_elapsed = (time.monotonic() - batch_start) * 1000
        self._stats['last_batch_at'] = now
        self._stats['last_batch_count'] = len(raw_docs)
        self._stats['last_batch_ms'] = round(batch_elapsed, 1)
        logger.info(
            f"✅ Batch done: {len(raw_docs)} processed, "
            f"{events_in_batch} events, {neural_in_batch} neural — {batch_elapsed:.1f}ms"
        )

    async def _process_single(self, doc: Dict) -> tuple:
        # Resume the saved result after a warning/log/ack failure, without reclassifying.
        existing = await self.db.processed_events.find_one({"_id": doc['_id']})
        if existing is None:
            existing = await self.db.processed_events.find_one({"id": str(doc['_id'])})
        if existing:
            method = existing.get('detection_method', 'heuristic')
            await self._finish_result(doc, existing, method, existing.get('sample_count', 1), 0)
            return existing, method

        device_id = doc.get('deviceId', 'unknown')
        timestamp = doc.get('timestamp', datetime.utcnow())
        kind = doc.get('kind', 'legacy')

        gps = doc.get('gps', {}) or {}
        if isinstance(gps, dict):
            latitude = gps.get('latitude', doc.get('latitude'))
            longitude = gps.get('longitude', doc.get('longitude'))
            speed = gps.get('speed', doc.get('speed', 0)) or 0
        else:
            latitude = doc.get('latitude')
            longitude = doc.get('longitude')
            speed = doc.get('speed', 0)

        accel_array = doc.get('accelerometer', [])
        if isinstance(accel_array, dict):
            accel_array = [accel_array]
        if accel_array is None or accel_array == []:
            accel_array = [{
                'x': doc.get('accelerometer_x', 0),
                'y': doc.get('accelerometer_y', 0),
                'z': doc.get('accelerometer_z', 0),
            }]

        self._stats['total_processed'] += 1

        # Фоновые сэмплы (kind=background) — только статистика, без классификации
        if kind == 'background':
            log_doc = {
                "timestamp": datetime.utcnow(),
                "device_id": device_id,
                "kind": kind,
                "input_samples": len(accel_array),
                "processing_time_ms": 0.0,
                "detection_method": "background",
                "result_event_type": None,
                "result_confidence": 0.0,
                "result_severity": 5,
                "latitude": latitude,
                "longitude": longitude,
                "speed": speed,
            }
            await self.db.inference_logs.update_one(
                {"_id": doc["_id"]}, {"$setOnInsert": log_doc}, upsert=True
            )
            return (None, 'background')

        inference_start = time.monotonic()
        detected_event = self._classify(device_id, accel_array, speed)

        inference_ms = (time.monotonic() - inference_start) * 1000

        detection_method = 'heuristic'
        event_type = None
        confidence = 0.0
        severity = 5

        if detected_event and detected_event.get('eventType'):
            event_type = detected_event['eventType']
            confidence = detected_event.get('confidence', 0)
            severity = detected_event.get('severity', 5)
            detection_method = detected_event.get('detection_method', 'heuristic')

            self._stats['events_detected'] += 1
            if detection_method == 'neural_network':
                self._stats['neural_predictions'] += 1
            else:
                self._stats['heuristic_predictions'] += 1

            processed_event = {
                "_id": doc['_id'],
                "id": str(doc.get('_id')),
                "raw_id": str(doc['_id']),
                "deviceId": device_id,
                "timestamp": timestamp,
                "eventType": event_type,
                "severity": severity,
                "confidence": confidence,
                "latitude": latitude,
                "longitude": longitude,
                "speed": speed,
                "accelerometer_x": 0,
                "accelerometer_y": 0,
                "accelerometer_z": 0,
                "accelerometer_magnitude": detected_event.get('accelerometer', {}).get('magnitude', 0),
                "accelerometer_deltaY": detected_event.get('accelerometer', {}).get('deltaY', 0),
                "accelerometer_deltaZ": detected_event.get('accelerometer', {}).get('deltaZ', 0),
                "accelerometer_variance": detected_event.get('accelerometer', {}).get('variance', 0),
                "roadType": detected_event.get('roadType', 'unknown'),
                "clusterId": None,
                "clustering_completed": False,
                "detection_method": detection_method,
                "kind": kind,
                "sample_count": detected_event.get('sample_count', len(accel_array)),
                "duration_ms": detected_event.get('duration_ms'),
                "zone_id": doc.get('zone_id'),
                "max_magnitude": doc.get('max_magnitude'),
                "created_at": datetime.utcnow()
            }
            # MongoDB's built-in unique _id index enforces one result per raw record.
            try:
                result = await self.db.processed_events.update_one(
                    {"_id": doc['_id']}, {"$setOnInsert": processed_event}, upsert=True
                )
                inserted = result.upserted_id is not None
            except DuplicateKeyError:
                inserted = False
            if not inserted:
                processed_event = await self.db.processed_events.find_one({"_id": doc['_id']})
                if processed_event is None:
                    raise RuntimeError("Processed event disappeared after concurrent upsert")
            detected_event = processed_event
            detection_method = processed_event.get('detection_method', 'heuristic')

        await self._finish_result(doc, detected_event, detection_method, len(accel_array), inference_ms)
        return (detected_event, detection_method)

    def _classify(self, device_id, samples, speed):
        try:
            if not isinstance(samples, list) or not 1 <= len(samples) <= MAX_SAMPLES_PER_EVENT:
                raise ValueError("Invalid accelerometer sample array")
            for sample in samples:
                for axis in ('x', 'y', 'z'):
                    value = sample[axis]
                    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or abs(value) > MAX_SENSOR_AXIS:
                        raise ValueError("Accelerometer axis outside supported range")
            if not math.isfinite(speed) or abs(speed) > 1000:
                raise ValueError("Speed outside supported range")

            detected = None
            if len(samples) >= 3:
                detected = self.event_classifier.analyze_accelerometer_array(
                    device_id=device_id, accelerometer_data=samples, speed=speed
                )
            else:
                for sample in samples:
                    event = self.event_classifier.analyze_data_point(
                        device_id=device_id, accel_x=sample['x'], accel_y=sample['y'],
                        accel_z=sample['z'], speed=speed
                    )
                    if event is not None and not isinstance(event, dict):
                        raise ValueError("Invalid classifier result")
                    if event and event.get('eventType'):
                        detected = event
            if detected is not None and not isinstance(detected, dict):
                raise ValueError("Invalid classifier result")
            if detected and detected.get('eventType'):
                if not isinstance(detected['eventType'], str):
                    raise ValueError("Invalid classifier event type")
                severity = detected.get('severity', 5)
                if isinstance(severity, bool) or severity not in (1, 2, 3, 4, 5):
                    raise ValueError("Invalid classifier severity")
                confidence = detected.get('confidence', 0)
                if isinstance(confidence, bool) or not math.isfinite(confidence) or not 0 <= confidence <= 1:
                    raise ValueError("Invalid classifier confidence")
                for value in detected.get('accelerometer', {}).values():
                    if not math.isfinite(value):
                        raise ValueError("Invalid classifier accelerometer metrics")
                return detected
            return None
        except (ValueError, TypeError, KeyError, AttributeError, ArithmeticError) as exc:
            raise ClassificationError(str(exc)) from exc

    async def _finish_result(self, doc, event, method, sample_count, inference_ms):
        if event and not event.get('clustering_completed'):
            cluster_id = event.get('clusterId')
            if cluster_id is None and event.get('latitude') is not None and event.get('longitude') is not None:
                if self.obstacle_clusterer is None:
                    raise RuntimeError("Obstacle clusterer unavailable")
                cluster_id = await self.obstacle_clusterer.process_event(
                    event=event, device_id=event.get('deviceId', doc.get('deviceId', 'unknown'))
                )
                if cluster_id is None:
                    raise RuntimeError("Clustering returned no result")
            completion = {'clusterId': cluster_id, 'clustering_completed': True}
            await self.db.processed_events.update_one(
                {'_id': event.get('_id', doc['_id'])}, {'$set': completion}
            )
            event.update(completion)
        if event and warning_service.should_warn(event.get('severity', 5)):
            await warning_service.create_warning_from_event(self.db, event, source="inference")

        gps = doc.get('gps') or {}
        if not isinstance(gps, dict):
            gps = {}
        log_doc = {
            "timestamp": datetime.utcnow(),
            "device_id": doc.get('deviceId', 'unknown'),
            "kind": doc.get('kind', 'legacy'),
            "input_samples": sample_count,
            "processing_time_ms": round(inference_ms, 2),
            "detection_method": method,
            "result_event_type": event.get('eventType') if event else None,
            "result_confidence": round(event.get('confidence', 0), 4) if event else 0,
            "result_severity": event.get('severity', 5) if event else 5,
            "latitude": gps.get('latitude', doc.get('latitude')),
            "longitude": gps.get('longitude', doc.get('longitude')),
            "speed": gps.get('speed', doc.get('speed', 0)),
        }
        await self.db.inference_logs.update_one(
            {"_id": doc['_id']}, {"$setOnInsert": log_doc}, upsert=True
        )
