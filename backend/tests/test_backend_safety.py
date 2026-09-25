"""Fake-backed regression tests; importing server dependencies never opens a DB."""

import ast
import asyncio
import copy
import json
import logging
import os
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Optional
import sys
import unittest
from unittest.mock import AsyncMock, Mock, patch

from fastapi import APIRouter, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
import inference_worker
import ingestion_validation
from ingestion_validation import read_raw_json, validate_raw_batch
from clustering import ObstacleClusterer
from pymongo.errors import AutoReconnect
from models import LimitsConfig


def matches(doc, query):
    for key, value in query.items():
        if key == "$or":
            if not any(matches(doc, branch) for branch in value):
                return False
        elif key == "$and":
            if not all(matches(doc, branch) for branch in value):
                return False
        elif isinstance(value, dict):
            for op, operand in value.items():
                if op not in ("$exists", "$ne", "$nin", "$lt", "$lte", "$gt", "$gte"):
                    raise AssertionError(f"Unsupported fake query operator: {op}")
                actual = doc.get(key)
                if op == "$exists" and (key in doc) != operand:
                    return False
                if op == "$ne" and actual == operand:
                    return False
                if op == "$nin" and actual in operand:
                    return False
                if op in ("$lt", "$lte", "$gt", "$gte"):
                    if actual is None:
                        return False
                    if op == "$lt" and not actual < operand:
                        return False
                    if op == "$lte" and not actual <= operand:
                        return False
                    if op == "$gt" and not actual > operand:
                        return False
                    if op == "$gte" and not actual >= operand:
                        return False
        elif isinstance(doc.get(key), list) and not isinstance(value, list):
            if value not in doc[key]:
                return False
        elif doc.get(key) != value:
            return False
    return True


class Cursor:
    def __init__(self, docs):
        self.docs = copy.deepcopy(docs)

    def sort(self, key, direction):
        self.docs.sort(key=lambda doc: doc.get(key, 0), reverse=direction < 0)
        return self

    def limit(self, count):
        if count <= 0:
            raise AssertionError("Unbounded/non-positive limit")
        self.docs = self.docs[:count]
        return self

    async def to_list(self, count=None, *, length=None):
        return self.docs[:length if length is not None else count]


class Collection:
    def __init__(self, docs=()):
        self.docs = {doc["_id"]: copy.deepcopy(doc) for doc in docs}
        self.deletes = []
        self.indexes = []

    async def create_index(self, fields, **options):
        self.indexes.append((fields, options))
        for key, doc in self.docs.items():
            self._check_unique(doc, key)

    def _check_unique(self, candidate, key):
        for fields, options in self.indexes:
            if not options.get('unique'):
                continue
            self_field = fields[0][0]
            if options.get('sparse') and self_field not in candidate:
                continue
            values = candidate.get(self_field)
            values = values if isinstance(values, list) else [values]
            for other_key, other in self.docs.items():
                if other_key == key or (options.get('sparse') and self_field not in other):
                    continue
                other_values = other.get(self_field)
                other_values = other_values if isinstance(other_values, list) else [other_values]
                if set(values).intersection(other_values):
                    raise inference_worker.DuplicateKeyError(f"duplicate {self_field}")

    def find(self, query):
        return Cursor([doc for doc in self.docs.values() if matches(doc, query)])

    async def find_one(self, query):
        await asyncio.sleep(0)
        return next((copy.deepcopy(doc) for doc in self.docs.values() if matches(doc, query)), None)

    async def insert_one(self, doc):
        key = doc.get("_id", f"generated-{len(self.docs)}")
        if key in self.docs:
            raise inference_worker.DuplicateKeyError("duplicate _id")
        self._check_unique(doc, key)
        self.docs[key] = {**copy.deepcopy(doc), "_id": key}
        return SimpleNamespace(inserted_id=key)

    async def update_one(self, query, update, upsert=False):
        await asyncio.sleep(0)
        doc = next((doc for doc in self.docs.values() if matches(doc, query)), None)
        matched = doc is not None
        inserted = None
        if doc is None and upsert:
            inserted = query["_id"]
            if inserted in self.docs:
                raise inference_worker.DuplicateKeyError("duplicate _id")
            doc = {"_id": inserted, **copy.deepcopy(update.get("$setOnInsert", {}))}
        if doc is not None:
            doc = copy.deepcopy(doc)
            doc.update(copy.deepcopy(update.get("$set", {})))
            for key, value in update.get("$inc", {}).items():
                doc[key] = doc.get(key, 0) + value
            for key in update.get('$unset', {}):
                doc.pop(key, None)
            for key, value in update.get('$addToSet', {}).items():
                if value not in doc.setdefault(key, []):
                    doc[key].append(value)
            self._check_unique(doc, doc['_id'])
            self.docs[doc['_id']] = doc
        return SimpleNamespace(upserted_id=inserted, matched_count=int(matched))

    async def find_one_and_update(self, query, update, return_document):
        await self.update_one(query, update)
        return await self.find_one(query)

    async def delete_many(self, query):
        self.deletes.append(copy.deepcopy(query))
        keys = [key for key, doc in self.docs.items() if matches(doc, query)]
        for key in keys:
            del self.docs[key]
        return SimpleNamespace(deleted_count=len(keys))

    async def count_documents(self, query):
        return sum(matches(doc, query) for doc in self.docs.values())


class Database:
    def __init__(self):
        self.collections = {}

    def __getitem__(self, name):
        return self.collections.setdefault(name, Collection())

    def __getattr__(self, name):
        return self[name]


def point(**changes):
    return {"timestamp": 1000, "gps": {"latitude": 55.7, "longitude": 37.6, "speed": 10},
            "accelerometer": [{"x": 0, "y": 0, "z": 1, "timestamp": 1000}], **changes}


def endpoints(*names):
    """Execute the actual endpoint AST with injected services, not server import side effects."""
    app = FastAPI()
    db = Database()
    config = SimpleNamespace(db=db, mongodb_connecting=False, mongodb_connected=True,
                             client=SimpleNamespace(admin=SimpleNamespace(command=AsyncMock())),
                             obstacle_clusterer=None)
    env = dict(globals(), app=app, api_router=APIRouter(prefix="/api"), _config=config,
               db_name="fake", ROOT_DIR=BACKEND, logger=logging.getLogger("test.server"),
               check_rate_limit=Mock(return_value=True), get_collector_config=AsyncMock(return_value={}),
               save_limits_to_db=AsyncMock(side_effect=lambda value: value))
    tree = ast.parse((BACKEND / "server.py").read_text(encoding="utf-8"))
    nodes = []
    seen = set()
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.name in names and node.name not in seen:
            nodes.append(node)
            seen.add(node.name)
    if seen != set(names):
        raise AssertionError(f"Missing endpoints: {set(names) - seen}")
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(BACKEND / "server.py"), "exec"), env)
    app.include_router(env["api_router"])
    return env, TestClient(app)


class IngestionTests(unittest.TestCase):
    def setUp(self):
        self.env, self.client = endpoints("ingest_raw_data", "ingest_raw_events")

    def test_shipped_formats(self):
        for route, key, sample in (
            ("raw-data", "data", point()),
            ("raw-data", "data", point(accelerometer={"x": 1, "y": 2, "z": 3})),
            ("raw-data", "data", point(accelerometer={"x": 1, "y": 2, "z": 3, "timestamp": None})),
            ("raw-events", "events", point(kind="trigger")),
            ("raw-events", "data", point(kind="prearm")),
            ("raw-events", "events", point(kind="background", accelerometer=None)),
            ("raw-events", "events", point(kind="user_report", accelerometer=[], userReported=True)),
            ("raw-data", "data", point(gps={"latitude": 0, "longitude": 0, "altitude": None})),
        ):
            with self.subTest(route=route, sample=sample):
                response = self.client.post(f"/api/{route}", json={"deviceId": "phone", key: [sample]})
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["inserted"], 1)

    def test_invalid_tail_never_inserts_prefix(self):
        invalid = [None, 1, [], point(gps=None), point(gps={"latitude": 91, "longitude": 0}),
                   point(gps={"latitude": True, "longitude": 0}),
                   point(gps={"latitude": 0, "longitude": float("inf")}),
                   point(accelerometer=[{"x": 1, "y": 2, "z": float("nan")}]),
                   point(accelerometer=[{"x": 1, "y": 2}]), point(accelerometer=[1]),
                   point(accelerometer="bad"), point(timestamp=float("inf")),
                   point(timestamp=2**64),
                   point(accelerometer=[{"x": 1, "y": 2, "z": 3, "extra": float("nan")}]),
                   point(accelerometer=[{"x": 1, "y": 2, "z": 3, "timestamp": "bad"}]),
                   point(userReported="false"), point(severity=8), point(deviceId="other")]
        for route, key in (("raw-data", "data"), ("raw-events", "events")):
            for sample in invalid:
                with self.subTest(route=route, sample=sample):
                    response = self.client.post(f"/api/{route}", content=json.dumps(
                        {"deviceId": "phone", key: [point(), sample]}))
                    self.assertEqual(response.status_code, 400, response.text)
                    self.assertFalse(self.env["_config"].db.raw_sensor_data.docs)
        self.env["check_rate_limit"].assert_not_called()

    def test_invalid_envelopes_and_json(self):
        bodies = ["{", "null", "[]", '"text"', '{"deviceId": {}}',
                  '{"deviceId":"phone","data":{}}',
                  '{"deviceId":"phone","events":[],"data":[{}]}']
        for route in ("raw-data", "raw-events"):
            for body in bodies:
                with self.subTest(route=route, body=body):
                    self.assertEqual(self.client.post(f"/api/{route}", content=body).status_code, 400)
        self.assertFalse(self.env["_config"].db.raw_sensor_data.docs)

    def test_extreme_finite_samples_reject_entire_batch(self):
        for route, key in (("raw-data", "data"), ("raw-events", "events")):
            for value in (1e308, -1e308, 1000.01, -1000.01):
                with self.subTest(route=route, value=value):
                    response = self.client.post(f"/api/{route}", json={"deviceId": "phone", key: [
                        point(), point(accelerometer=[{'x': value, 'y': 0, 'z': 1}])]})
                    self.assertEqual(response.status_code, 400, response.text)
        self.assertFalse(self.env['_config'].db.raw_sensor_data.docs)
        self.env['check_rate_limit'].assert_not_called()

    def test_count_and_device_limits_reject_before_inserting(self):
        samples = point()['accelerometer']
        oversized = [
            {'deviceId': 'a' * 257, 'data': [point()]},
            {'deviceId': 'phone', 'data': [point()] * 101},
            {'deviceId': 'phone', 'data': [point(), point(accelerometer=samples * 2001)]},
            {'deviceId': 'phone', 'data': [point(accelerometer=samples * 2000)] * 26},
        ]
        for route in ('raw-data', 'raw-events'):
            for body in oversized:
                response = self.client.post(f'/api/{route}', json=body)
                self.assertEqual(response.status_code, 400, response.text)
        self.assertFalse(self.env['_config'].db.raw_sensor_data.docs)
        self.env['check_rate_limit'].assert_not_called()

    def test_shipped_batch_sizes_and_sensor_units_fit(self):
        sample = {'x': -1000, 'y': 9.81, 'z': 1000, 'timestamp': 1000}
        for route, count, sample_count in (('raw-data', 50, 50), ('raw-events', 10, 250),
                                           ('raw-events', 50, 250)):
            response = self.client.post(f'/api/{route}', json={
                'deviceId': 'a' * 256, 'data': [point(accelerometer=[sample] * sample_count)] * count})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()['inserted'], count)

    def test_exact_sample_and_batch_limits_fit(self):
        sample = point()['accelerometer']
        validate_raw_batch({'deviceId': 'phone', 'data': [point()] * 100})
        validate_raw_batch({'deviceId': 'phone', 'data': [point(accelerometer=sample * 2000)] * 25})

    def test_declared_and_actual_body_limit_on_both_routes(self):
        for route in ('raw-data', 'raw-events'):
            response = self.client.post(f'/api/{route}', content=b'{}', headers={
                'content-length': str(ingestion_validation.MAX_BODY_BYTES + 1)})
            self.assertEqual(response.status_code, 413)
            with patch.object(ingestion_validation, 'MAX_BODY_BYTES', 64):
                response = self.client.post(f'/api/{route}', content=b' ' * 65,
                                            headers={'content-length': '1'})
                self.assertEqual(response.status_code, 413)
        self.assertFalse(self.env['_config'].db.raw_sensor_data.docs)


class BodyLimitTests(unittest.IsolatedAsyncioTestCase):
    async def test_oversized_content_length_does_not_read_stream(self):
        request = SimpleNamespace(headers={'content-length': str(ingestion_validation.MAX_BODY_BYTES + 1)},
                                  stream=Mock(side_effect=AssertionError('must not read')))
        with self.assertRaises(HTTPException) as raised:
            await read_raw_json(request)
        self.assertEqual(raised.exception.status_code, 413)
        request.stream.assert_not_called()

    async def test_chunked_body_is_bounded_before_json_decode(self):
        async def stream():
            yield b' ' * 40
            yield b' ' * 25
            raise AssertionError('must stop reading at the cap')

        request = SimpleNamespace(headers={}, stream=stream)
        with patch.object(ingestion_validation, 'MAX_BODY_BYTES', 64), \
                patch.object(ingestion_validation.json, 'loads') as decode:
            with self.assertRaises(HTTPException) as raised:
                await read_raw_json(request)
            self.assertEqual(raised.exception.status_code, 413)
            decode.assert_not_called()

    async def test_exact_body_limit_and_malformed_length(self):
        async def stream():
            yield b'{}' + b' ' * 62

        with patch.object(ingestion_validation, 'MAX_BODY_BYTES', 64):
            self.assertEqual(await read_raw_json(SimpleNamespace(headers={}, stream=stream)), {})
        for length in ('-1', 'invalid'):
            with self.assertRaises(HTTPException) as raised:
                await read_raw_json(SimpleNamespace(headers={'content-length': length}, stream=stream))
            self.assertEqual(raised.exception.status_code, 400)


class WorkerTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.db = Database()
        self.raw = {"_id": "raw-1", "deviceId": "phone", **point()}
        self.db.collections["raw_sensor_data"] = Collection([self.raw])
        self.classifier = Mock()
        self.classifier.analyze_data_point.return_value = {
            "eventType": "pothole", "severity": 2, "confidence": 0.9}
        self.clusterer = SimpleNamespace(process_event=AsyncMock(return_value="cluster"))
        self.worker = inference_worker.InferenceWorker(self.db, self.classifier, self.clusterer)

    def retry_due(self):
        self.worker._retry_after.clear()
        for doc in self.db.raw_sensor_data.docs.values():
            if 'inference_retry_after' in doc:
                doc['inference_retry_after'] = datetime.min

    async def test_warning_import_and_raw_id_propagation(self):
        await self.worker._process_batch()
        self.assertTrue(self.db.raw_sensor_data.docs["raw-1"]["processed_by_inference"])
        event = self.db.processed_events.docs["raw-1"]
        self.assertEqual(event["raw_id"], "raw-1")
        self.assertEqual(next(iter(self.db.user_warnings.docs.values()))["raw_id"], "raw-1")

    async def test_warning_failure_resumes_saved_event(self):
        with patch.object(inference_worker.warning_service, "create_warning_from_event",
                          new=AsyncMock(side_effect=[RuntimeError("warning unavailable"), "warning"])):
            await self.worker._process_batch()
            self.assertFalse(self.db.raw_sensor_data.docs["raw-1"].get("processed_by_inference", False))
            self.assertEqual(self.db.raw_sensor_data.docs["raw-1"].get("inference_attempts", 0), 0)
            self.assertIn('inference_retry_after', self.db.raw_sensor_data.docs['raw-1'])
            self.retry_due()
            await self.worker._process_batch()
        self.assertEqual(len(self.db.processed_events.docs), 1)
        self.assertEqual(len(self.db.inference_logs.docs), 1)
        self.classifier.analyze_data_point.assert_called_once()
        self.clusterer.process_event.assert_awaited_once()

    async def test_log_failure_and_ack_failure_are_idempotent(self):
        original = self.db.inference_logs.update_one
        self.db.inference_logs.update_one = AsyncMock(side_effect=RuntimeError("logs unavailable"))
        await self.worker._process_batch()
        self.db.inference_logs.update_one = original
        original_ack = self.db.raw_sensor_data.update_one

        async def fail_ack(query, update, **kwargs):
            if update.get("$set", {}).get("processed_by_inference"):
                raise RuntimeError("ack unavailable")
            return await original_ack(query, update, **kwargs)

        self.db.raw_sensor_data.update_one = fail_ack
        self.retry_due()
        await self.worker._process_batch()
        self.db.raw_sensor_data.update_one = original_ack
        self.retry_due()
        await self.worker._process_batch()
        self.assertEqual(len(self.db.processed_events.docs), 1)
        self.assertEqual(len(self.db.inference_logs.docs), 1)
        self.classifier.analyze_data_point.assert_called_once()
        self.assertTrue(self.db.raw_sensor_data.docs["raw-1"]["processed_by_inference"])

    async def test_concurrent_writes_use_unique_raw_primary_key(self):
        self.worker.obstacle_clusterer = ObstacleClusterer(self.db)
        with patch.object(inference_worker.warning_service, "create_warning_from_event", new=AsyncMock()):
            await asyncio.gather(self.worker._process_single(self.raw), self.worker._process_single(self.raw))
        self.assertEqual(list(self.db.processed_events.docs), ["raw-1"])
        self.assertEqual(list(self.db.inference_logs.docs), ["raw-1"])
        self.assertEqual(len(self.db.obstacle_clusters.docs), 1)
        self.assertEqual(next(iter(self.db.obstacle_clusters.docs.values()))['severity']['history'], [2])

    async def test_legacy_result_is_reused(self):
        await self.db.processed_events.insert_one({"_id": "old-generated-id", "id": "raw-1",
            "eventType": "bump", "severity": 4})
        await self.worker._process_batch()
        self.assertEqual(list(self.db.processed_events.docs), ["old-generated-id"])
        self.classifier.analyze_data_point.assert_not_called()

    async def test_duplicate_key_race_reuses_winning_result(self):
        original = self.db.processed_events.update_one

        async def concurrent_insert(query, update, **kwargs):
            result = await original(query, update, **kwargs)
            if kwargs.get('upsert'):
                raise inference_worker.DuplicateKeyError("concurrent insert won")
            return result

        self.db.processed_events.update_one = concurrent_insert
        await self.worker._process_batch()
        self.assertEqual(list(self.db.processed_events.docs), ["raw-1"])
        self.assertTrue(self.db.raw_sensor_data.docs["raw-1"]["processed_by_inference"])
        self.clusterer.process_event.assert_awaited_once()

    async def test_background_skips_classifier_and_deduplicates_logs(self):
        raw = {**self.raw, "kind": "background", "accelerometer": []}
        await self.worker._process_single(raw)
        await self.worker._process_single(raw)
        self.classifier.analyze_data_point.assert_not_called()
        self.assertEqual(list(self.db.inference_logs.docs), ["raw-1"])
        self.assertFalse(self.db.processed_events.docs)

    async def test_trigger_window_uses_array_classifier(self):
        self.classifier.analyze_accelerometer_array.return_value = None
        raw = {**self.raw, "accelerometer": self.raw["accelerometer"] * 3}
        await self.worker._process_single(raw)
        self.classifier.analyze_accelerometer_array.assert_called_once_with(
            device_id="phone", accelerometer_data=raw["accelerometer"], speed=10)
        self.classifier.analyze_data_point.assert_not_called()

    async def test_failed_records_are_quarantined_and_do_not_starve_new_work(self):
        self.classifier.analyze_data_point.side_effect = ValueError("bad sample")
        with patch.object(inference_worker, "BATCH_SIZE", 1):
            for _ in range(inference_worker.MAX_ATTEMPTS + 2):
                self.retry_due()
                await self.worker._process_batch()
            failed = self.db.raw_sensor_data.docs["raw-1"]
            self.assertEqual(failed["inference_attempts"], inference_worker.MAX_ATTEMPTS)
            self.assertTrue(failed["inference_quarantined"])
            self.assertEqual(self.classifier.analyze_data_point.call_count, inference_worker.MAX_ATTEMPTS)
            self.classifier.analyze_data_point.side_effect = None
            await self.db.raw_sensor_data.insert_one({**self.raw, "_id": "raw-2", "timestamp": 2000})
            await self.worker._process_batch()
            self.assertTrue(self.db.raw_sensor_data.docs["raw-2"]["processed_by_inference"])

    async def test_single_reading_and_zero_coordinates_are_preserved(self):
        raw = {**self.raw, "gps": {"latitude": 0, "longitude": 0, "speed": 0},
               "accelerometer": {"x": 1, "y": 2, "z": 3}}
        await self.worker._process_single(raw)
        self.classifier.analyze_data_point.assert_called_once_with(
            device_id="phone", accel_x=1, accel_y=2, accel_z=3, speed=0)
        self.assertEqual(self.db.processed_events.docs["raw-1"]["latitude"], 0)
        self.clusterer.process_event.assert_awaited_once()

    async def test_failed_start_does_not_leave_running_flag(self):
        self.db.inference_logs.create_index = AsyncMock(side_effect=RuntimeError("index unavailable"))
        with self.assertRaises(RuntimeError):
            await self.worker.start()
        self.assertFalse(self.worker._running)
        self.assertIsNone(self.worker._task)

    def test_positive_worker_limits(self):
        for name in ("BATCH_SIZE", "INFERENCE_INTERVAL", "MAX_ATTEMPTS", "RETRY_SECONDS"):
            for value in (0, -1):
                with self.subTest(name=name, value=value), patch.object(inference_worker, name, value):
                    with self.assertRaises(ValueError):
                        inference_worker.InferenceWorker(self.db, self.classifier)

    async def test_saved_event_resumes_clustering_after_failure(self):
        self.clusterer.process_event.side_effect = [AutoReconnect('cluster unavailable'), 'cluster']
        await self.worker._process_batch()
        self.assertFalse(self.db.processed_events.docs['raw-1']['clustering_completed'])
        self.assertFalse(self.db.raw_sensor_data.docs['raw-1'].get('processed_by_inference', False))
        self.retry_due()
        await self.worker._process_batch()
        self.assertTrue(self.db.processed_events.docs['raw-1']['clustering_completed'])
        self.assertEqual(self.db.processed_events.docs['raw-1']['clusterId'], 'cluster')
        self.classifier.analyze_data_point.assert_called_once()
        self.assertNotIn('inference_attempts', self.db.raw_sensor_data.docs['raw-1'])

    async def test_crash_between_cluster_and_completion_does_not_repeat_history(self):
        self.worker.obstacle_clusterer = ObstacleClusterer(self.db)
        original = self.db.processed_events.update_one

        async def fail_completion(query, update, **kwargs):
            if update.get('$set', {}).get('clustering_completed'):
                raise AutoReconnect('completion unavailable')
            return await original(query, update, **kwargs)

        self.db.processed_events.update_one = fail_completion
        await self.worker._process_batch()
        self.assertEqual(len(self.db.obstacle_clusters.docs), 1)
        self.assertFalse(self.db.processed_events.docs['raw-1']['clustering_completed'])
        self.db.processed_events.update_one = original
        self.worker = inference_worker.InferenceWorker(self.db, self.classifier, ObstacleClusterer(self.db))
        self.retry_due()
        await self.worker._process_batch()
        cluster = next(iter(self.db.obstacle_clusters.docs.values()))
        self.assertEqual(cluster['severity']['history'], [2])
        self.assertEqual(cluster['roadInfo']['speeds'], [10])
        self.assertEqual(cluster['event_ids'], ['raw-1'])
        self.assertTrue(self.db.processed_events.docs['raw-1']['clustering_completed'])
        self.classifier.analyze_data_point.assert_called_once()

    async def test_transient_warning_failures_never_quarantine_and_do_not_starve(self):
        async def warning(db, event, source):
            if event['raw_id'] == 'raw-1':
                raise AutoReconnect('warning unavailable')
            return 'warning'

        with patch.object(inference_worker, 'BATCH_SIZE', 1), \
                patch.object(inference_worker.warning_service, 'create_warning_from_event', new=warning):
            await self.worker._process_batch()
            await self.db.raw_sensor_data.insert_one({**self.raw, '_id': 'raw-2', 'timestamp': 2000})
            # A new worker must honor the persisted deadline, not only the local cache.
            self.worker = inference_worker.InferenceWorker(self.db, self.classifier, self.clusterer)
            await self.worker._process_batch()
            self.assertTrue(self.db.raw_sensor_data.docs['raw-2']['processed_by_inference'])
            for _ in range(inference_worker.MAX_ATTEMPTS + 2):
                self.retry_due()
                await self.worker._process_batch()
        raw = self.db.raw_sensor_data.docs['raw-1']
        self.assertEqual(raw['inference_failure_kind'], 'transient')
        self.assertNotIn('inference_attempts', raw)
        self.assertFalse(raw.get('inference_quarantined', False))

    async def test_retry_state_write_failure_still_backs_off_locally(self):
        self.clusterer.process_event.side_effect = AutoReconnect('cluster unavailable')
        self.db.raw_sensor_data.find_one_and_update = AsyncMock(side_effect=AutoReconnect('state unavailable'))
        with patch.object(inference_worker, 'BATCH_SIZE', 1):
            with self.assertLogs('inference_worker', level='ERROR'):
                await self.worker._process_batch()
            self.clusterer.process_event.side_effect = None
            await self.db.raw_sensor_data.insert_one({**self.raw, '_id': 'raw-2', 'timestamp': 2000})
            await self.worker._process_batch()
        self.assertTrue(self.db.raw_sensor_data.docs['raw-2']['processed_by_inference'])
        self.assertFalse(self.db.raw_sensor_data.docs['raw-1'].get('processed_by_inference', False))

    async def test_processed_write_failure_is_transient(self):
        self.db.processed_events.update_one = AsyncMock(side_effect=AutoReconnect('event write unavailable'))
        for _ in range(inference_worker.MAX_ATTEMPTS + 2):
            self.retry_due()
            await self.worker._process_batch()
        raw = self.db.raw_sensor_data.docs['raw-1']
        self.assertNotIn('inference_attempts', raw)
        self.assertFalse(raw.get('inference_quarantined', False))

    async def test_classifier_infrastructure_error_is_not_poison(self):
        self.classifier.analyze_data_point.side_effect = AutoReconnect('classifier dependency unavailable')
        await self.worker._process_batch()
        self.assertNotIn('inference_attempts', self.db.raw_sensor_data.docs['raw-1'])
        self.assertEqual(self.db.raw_sensor_data.docs['raw-1']['inference_failure_kind'], 'transient')

    async def test_persisted_extreme_axis_is_quarantined_without_calling_classifier(self):
        self.db.raw_sensor_data.docs['raw-1']['accelerometer'][0]['x'] = 1e308
        for _ in range(inference_worker.MAX_ATTEMPTS):
            self.retry_due()
            await self.worker._process_batch()
        self.assertTrue(self.db.raw_sensor_data.docs['raw-1']['inference_quarantined'])
        self.classifier.analyze_data_point.assert_not_called()

    async def test_malformed_classifier_output_uses_poison_budget(self):
        self.classifier.analyze_data_point.return_value = {'eventType': 'pothole', 'confidence': float('nan')}
        for _ in range(inference_worker.MAX_ATTEMPTS):
            self.retry_due()
            await self.worker._process_batch()
        self.assertTrue(self.db.raw_sensor_data.docs['raw-1']['inference_quarantined'])
        self.assertFalse(self.db.processed_events.docs)

    def test_malformed_classifier_result_types_and_arithmetic_errors(self):
        for value in ([], False, 1, 'invalid'):
            with self.subTest(value=value):
                self.classifier.analyze_data_point.return_value = value
                with self.assertRaises(inference_worker.ClassificationError):
                    self.worker._classify('phone', point()['accelerometer'], 10)
        self.classifier.analyze_data_point.side_effect = OverflowError('bad arithmetic')
        with self.assertRaises(inference_worker.ClassificationError):
            self.worker._classify('phone', point()['accelerometer'], 10)


class ClusteringTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.db = Database()
        self.clusterer = ObstacleClusterer(self.db)
        self.event = {'id': 'event-1', 'latitude': 55.7, 'longitude': 37.6,
                      'eventType': 'pothole', 'severity': 2, 'speed': 10}

    async def test_repeated_event_updates_histories_once(self):
        cluster_id = await self.clusterer.process_event(self.event, 'phone-1')
        event2 = {**self.event, 'id': 'event-2', 'severity': 3, 'speed': 20}
        await self.clusterer.process_event(event2, 'phone-2')
        before = copy.deepcopy(self.db.obstacle_clusters.docs[cluster_id])
        self.assertEqual(await self.clusterer.process_event(event2, 'phone-2'), cluster_id)
        self.assertEqual(self.db.obstacle_clusters.docs[cluster_id], before)
        self.assertEqual(before['severity']['history'], [2, 3])
        self.assertEqual(before['roadInfo']['speeds'], [10, 20])
        self.assertEqual(before['reportCount'], 2)
        self.assertIn(([('event_ids', 1)], {'unique': True, 'sparse': True}), self.db.obstacle_clusters.indexes)

    async def test_lost_cluster_insert_ack_is_safe_to_resume(self):
        original = self.db.obstacle_clusters.insert_one

        async def lost_ack(doc):
            await original(doc)
            raise AutoReconnect('insert acknowledgement lost')

        self.db.obstacle_clusters.insert_one = lost_ack
        with self.assertRaises(AutoReconnect):
            await self.clusterer.process_event(self.event, 'phone')
        self.db.obstacle_clusters.insert_one = original
        await ObstacleClusterer(self.db).process_event(self.event, 'phone')
        self.assertEqual(len(self.db.obstacle_clusters.docs), 1)
        self.assertEqual(next(iter(self.db.obstacle_clusters.docs.values()))['severity']['history'], [2])

    async def test_lost_cluster_update_ack_is_safe_to_resume(self):
        cluster_id = await self.clusterer.process_event(self.event, 'phone-1')
        original = self.db.obstacle_clusters.update_one

        async def lost_ack(*args, **kwargs):
            await original(*args, **kwargs)
            raise AutoReconnect('update acknowledgement lost')

        self.db.obstacle_clusters.update_one = lost_ack
        event2 = {**self.event, 'id': 'event-2', 'severity': 3, 'speed': 20}
        with self.assertRaises(AutoReconnect):
            await self.clusterer.process_event(event2, 'phone-2')
        self.db.obstacle_clusters.update_one = original
        await ObstacleClusterer(self.db).process_event(event2, 'phone-2')
        self.assertEqual(self.db.obstacle_clusters.docs[cluster_id]['severity']['history'], [2, 3])
        self.assertEqual(self.db.obstacle_clusters.docs[cluster_id]['roadInfo']['speeds'], [10, 20])

    async def test_concurrent_create_uses_unique_event_receipt(self):
        # Force both workers to observe no nearby cluster before either creates one.
        arrived = 0
        ready = asyncio.Event()

        async def no_cluster(*args):
            nonlocal arrived
            arrived += 1
            if arrived == 2:
                ready.set()
            await ready.wait()
            return None

        self.clusterer.find_nearby_cluster = no_cluster
        ids = await asyncio.gather(*(self.clusterer.process_event(self.event, 'phone') for _ in range(2)))
        self.assertEqual(arrived, 2)
        self.assertEqual(ids[0], ids[1])
        self.assertEqual(len(self.db.obstacle_clusters.docs), 1)

    async def test_stale_snapshot_cannot_duplicate_or_lose_history(self):
        cluster_id = await self.clusterer.process_event(self.event, 'phone-1')
        stale = copy.deepcopy(self.db.obstacle_clusters.docs[cluster_id])
        event2 = {**self.event, 'id': 'event-2', 'severity': 3}
        await self.clusterer.update_cluster(stale, event2, 'phone-2')
        await self.clusterer.update_cluster(stale, event2, 'phone-2')
        event3 = {**self.event, 'id': 'event-3', 'severity': 4}
        with self.assertRaisesRegex(RuntimeError, 'concurrently'):
            await self.clusterer.update_cluster(stale, event3, 'phone-3')
        await self.clusterer.process_event(event3, 'phone-3')
        self.assertEqual(self.db.obstacle_clusters.docs[cluster_id]['severity']['history'], [2, 3, 4])

    async def test_unique_receipt_prevents_different_cluster_updates(self):
        first = await self.clusterer.process_event(self.event, 'phone-1')
        second = await self.clusterer.process_event({**self.event, 'id': 'far', 'latitude': 56.7}, 'phone-2')
        snapshots = [copy.deepcopy(self.db.obstacle_clusters.docs[key]) for key in (first, second)]
        event = {**self.event, 'id': 'shared'}
        self.clusterer.find_nearby_cluster = AsyncMock(side_effect=snapshots)
        ids = await asyncio.gather(*(self.clusterer.process_event(event, 'phone-3') for _ in range(2)))
        self.assertEqual(ids[0], ids[1])
        self.assertEqual(sum(len(doc['severity']['history']) for doc in self.db.obstacle_clusters.docs.values()), 3)

    async def test_legacy_cluster_without_revision_accepts_receipt(self):
        cluster_id = await self.clusterer.process_event(self.event, 'phone-1')
        cluster = self.db.obstacle_clusters.docs[cluster_id]
        cluster.pop('revision')
        cluster.pop('event_ids')
        await self.clusterer.process_event({**self.event, 'id': 'event-2'}, 'phone-2')
        self.assertEqual(self.db.obstacle_clusters.docs[cluster_id]['revision'], 1)
        self.assertEqual(self.db.obstacle_clusters.docs[cluster_id]['event_ids'], ['event-2'])


class EndpointSafetyTests(unittest.TestCase):
    def test_public_log_cleanup_is_retired_without_host_access(self):
        env, client = endpoints("admin_clear_logs")
        with patch("builtins.open", side_effect=AssertionError("Host access forbidden")):
            response = client.post("/api/admin/clear-logs")
        self.assertEqual(response.status_code, 410)
        self.assertIn("GitHub Actions", response.json()["detail"])
        self.assertFalse(env["_config"].db.collections)

    def test_readiness_states(self):
        env, client = endpoints("readiness_check")
        config = env["_config"]
        config.mongodb_connecting = True
        self.assertEqual(client.get("/ready").status_code, 503)
        config.mongodb_connecting = False
        self.assertEqual(client.get("/ready").status_code, 503)
        env["app"].state.services_ready = True
        self.assertEqual(client.get("/ready").status_code, 200)
        config.client.admin.command.side_effect = RuntimeError("offline")
        self.assertEqual(client.get("/ready").status_code, 503)
        config.client = None
        self.assertEqual(client.get("/ready").status_code, 503)

    def test_nonpositive_cleanup_days_do_not_delete(self):
        env, client = endpoints("cleanup_old_data", "clear_database")
        for value in (0, -1):
            self.assertEqual(client.post(f"/api/admin/cleanup-old-data?days={value}").status_code, 422)
            self.assertEqual(client.delete(f"/api/admin/clear-database?confirm=CONFIRM&days={value}").status_code, 422)
        self.assertFalse(env["_config"].db.collections)

    def test_date_filtered_cleanups_preserve_recent_and_undated_profiles(self):
        for endpoint, params in (("clear-database", "days=30"),
                                 ("clear-database-v2", "date_to=2020-12-31")):
            with self.subTest(endpoint=endpoint):
                env, client = endpoints("clear_database", "clear_database_v2")
                db = env["_config"].db
                db.collections["calibration_profiles"] = Collection([
                    {"_id": "old", "last_updated": datetime(2020, 1, 1)},
                    {"_id": "recent", "last_updated": datetime.utcnow()},
                    {"_id": "undated"}])
                response = client.delete(f"/api/admin/{endpoint}?confirm=CONFIRM&{params}")
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(set(db.calibration_profiles.docs), {"recent", "undated"})
                self.assertIn("receivedAt", db.raw_sensor_data.deletes[0])

    def test_confirmed_unfiltered_cleanup_still_deletes_all(self):
        for endpoint in ("clear-database", "clear-database-v2"):
            env, client = endpoints("clear_database", "clear_database_v2")
            env["_config"].db.collections["calibration_profiles"] = Collection([{"_id": "profile"}])
            self.assertEqual(client.delete(f"/api/admin/{endpoint}?confirm=CONFIRM").status_code, 200)
            self.assertFalse(env["_config"].db.calibration_profiles.docs)

    def test_positive_saved_limits(self):
        env, client = endpoints("save_limits_api")
        for field in LimitsConfig.model_fields:
            for value in (0, -1):
                response = client.post("/api/admin/settings/limits/api", json={field: value})
                self.assertEqual(response.status_code, 400)
        env["save_limits_to_db"].assert_not_awaited()
        self.assertEqual(client.post("/api/admin/settings/limits/api", json={}).status_code, 200)

    def test_positive_read_limits(self):
        env, client = endpoints("admin_roads_geojson", "get_raw_data", "get_processed_events")
        for endpoint in ("roads-geojson", "v2/raw-data", "v2/events"):
            for value in (0, -1):
                self.assertEqual(client.get(f"/api/admin/{endpoint}?limit={value}").status_code, 422)
        self.assertFalse(env["_config"].db.collections)

    def test_positive_quality_limit(self):
        env, client = endpoints("DataQualityRequest", "llm_analyze_quality")
        for value in (0, -1):
            self.assertEqual(client.post("/api/llm/analyze-quality", json={"limit": value}).status_code, 422)
        self.assertFalse(env["_config"].db.collections)


class StartupTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.env, _ = endpoints("startup_event", "shutdown_event", "readiness_check")
        self.workers = [SimpleNamespace(start=AsyncMock(), stop=AsyncMock()) for _ in range(2)]
        self.neural = SimpleNamespace(reload=Mock(return_value={"available": True}))
        self.env.update(
            connect_to_mongodb=AsyncMock(), close_mongodb_connection=AsyncMock(),
            load_ml_thresholds=AsyncMock(return_value={}),
            DatasetExporter=Mock(), ModelRegistry=Mock(), init_external_training=Mock(),
            init_gpu_machines=Mock(), init_nn_admin=Mock(),
            InferenceWorker=Mock(return_value=self.workers[0]),
            AutoTrainer=Mock(return_value=self.workers[1]),
            event_classifier=SimpleNamespace(neural_classifier=self.neural),
            os=SimpleNamespace(environ={}, path=SimpleNamespace(exists=Mock(return_value=True))),
        )
        self.modules = patch.dict(sys.modules, {
            "config": self.env["_config"],
            "llm_service": SimpleNamespace(init_llm_tracker=Mock(), set_runtime_defaults=Mock()),
            "external_training_api": SimpleNamespace(timeout_stale_training_runs=AsyncMock(),
                                                       cleanup_expired_datasets_task=AsyncMock()),
        })
        self.modules.start()
        self.addCleanup(self.modules.stop)

    async def asyncTearDown(self):
        await self.env["shutdown_event"]()

    async def test_unset_model_path_uses_backend_default_and_shutdown_stops_tasks(self):
        await self.env["startup_event"]()
        self.assertFalse(self.env["app"].state.services_ready)
        await self.env["app"].state.startup_task
        self.neural.reload.assert_called_once_with(str(BACKEND / "models" / "accel_lstm.pt"))
        self.assertTrue(self.env["app"].state.services_ready)
        await self.env["shutdown_event"]()
        for worker in self.workers:
            worker.stop.assert_awaited_once()
        self.assertTrue(self.env["app"].state.maintenance_task.done())
        self.env["close_mongodb_connection"].assert_awaited_once()
        self.assertFalse(self.env["app"].state.services_ready)

    async def test_failed_initialization_keeps_readiness_unavailable(self):
        self.env["connect_to_mongodb"].side_effect = RuntimeError("DB unavailable")
        with self.assertLogs("test.server", level="ERROR"):
            await self.env["startup_event"]()
            await self.env["app"].state.startup_task
        self.assertFalse(self.env["app"].state.services_ready)
        with self.assertRaises(HTTPException) as raised:
            await self.env["readiness_check"]()
        self.assertEqual(raised.exception.status_code, 503)

    async def test_shutdown_cancels_pending_connection(self):
        pending = asyncio.Event()
        self.env["connect_to_mongodb"].side_effect = pending.wait
        await self.env["startup_event"]()
        await asyncio.sleep(0)
        await self.env["shutdown_event"]()
        self.assertTrue(self.env["app"].state.startup_task.cancelled())
        self.assertFalse(self.env["app"].state.services_ready)


if __name__ == "__main__":
    unittest.main()
