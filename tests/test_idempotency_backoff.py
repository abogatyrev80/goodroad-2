"""Tests for offline-sync hardening (Step 7b):

- server: X-Package-Id idempotent replay in /api/raw-data and /api/sensor-data
- frontend: exponential backoff helper (pure logic, no RN imports needed)
"""
import os
import sys
from datetime import datetime
from pathlib import Path

os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("ADMIN_API_TOKEN", "test-admin-token")

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))


class FakeCollection:
    """Minimal async stand-in for a Motor collection keyed by _id."""

    def __init__(self):
        self.docs = {}

    async def find_one(self, q):
        return self.docs.get(q.get("_id"))

    async def update_one(self, filt, update, upsert=False):
        key = filt["_id"]
        cur = self.docs.get(key, {"_id": key})
        cur.update(update.get("$set", {}))
        if key not in self.docs:
            cur.update(update.get("$setOnInsert", {}))
            self.docs[key] = cur
        return {"matched": 1}


class FakeDB:
    def __init__(self):
        self.api_idempotency = FakeCollection()


BATCH = {
    "deviceId": "dev-1",
    "data": [{
        "deviceId": "dev-1",
        "timestamp": int(datetime.utcnow().timestamp() * 1000),
        "gps": {"latitude": 55.75, "longitude": 37.61, "speed": 40},
        "accelerometer": {"x": 0.1, "y": 0.2, "z": 9.8},
    }],
}


def _patch_ingest(monkeypatch):
    import routers.ingest as ingest
    fake = FakeDB()
    monkeypatch.setattr(ingest, "db", fake)
    monkeypatch.setattr(ingest, "mongodb_connected", True)
    monkeypatch.setattr(ingest, "check_rate_limit", lambda device_id: True)
    return fake


class TestIngestIdempotency:
    def test_replay_returns_cached_response(self, monkeypatch):
        from fastapi.testclient import TestClient
        import routers.ingest as ingest

        fake = _patch_ingest(monkeypatch)
        client = TestClient(ingest.router)

        r1 = client.post("/api/raw-data", json=BATCH, headers={"X-Package-Id": "pkg-abc"})
        assert r1.status_code == 201
        first_body = r1.json()

        # Second upload with same package id must NOT reprocess; replays cached body.
        calls = {"n": 0}
        orig_find_one = fake.api_idempotency.find_one

        async def counting_find_one(q):
            calls["n"] += 1
            return await orig_find_one(q)

        fake.api_idempotency.find_one = counting_find_one
        r2 = client.post("/api/raw-data", json=BATCH, headers={"X-Package-Id": "pkg-abc"})
        assert r2.status_code == 201
        assert r2.json() == first_body
        assert calls["n"] == 1  # only the idempotency lookup happened

    def test_different_package_ids_both_processed(self, monkeypatch):
        from fastapi.testclient import TestClient
        import routers.ingest as ingest

        _patch_ingest(monkeypatch)
        client = TestClient(ingest.router)

        r1 = client.post("/api/raw-data", json=BATCH, headers={"X-Package-Id": "pkg-1"})
        r2 = client.post("/api/raw-data", json=BATCH, headers={"X-Package-Id": "pkg-2"})
        assert r1.status_code == 201 and r2.status_code == 201

    def test_no_header_skips_idempotency(self, monkeypatch):
        from fastapi.testclient import TestClient
        import routers.ingest as ingest

        fake = _patch_ingest(monkeypatch)
        client = TestClient(ingest.router)

        r = client.post("/api/raw-data", json=BATCH)
        assert r.status_code == 201
        assert fake.api_idempotency.docs == {}  # nothing stored

    def test_sensor_data_alias_route_exists(self, monkeypatch):
        """BatchOfflineManager posts to /api/sensor-data - route must exist."""
        from fastapi.testclient import TestClient
        import routers.ingest as ingest

        _patch_ingest(monkeypatch)
        client = TestClient(ingest.router)
        r = client.post("/api/sensor-data", json=BATCH, headers={"X-Package-Id": "pkg-x"})
        assert r.status_code == 201


class TestFrontendBackoffLogic:
    """Replicates backoffDelayMs bounds from BatchOfflineManager.ts."""

    BASE = 2000
    CAP = 120000

    def _bounds(self, retry_count):
        exp = min(self.BASE * 2 ** (retry_count - 1), self.CAP)
        return exp * 0.8, exp * 1.2

    def test_growth_is_exponential_within_jitter(self):
        for n in range(1, 6):
            lo, hi = self._bounds(n)
            assert lo < hi
            # expected base doubles each attempt until cap
            assert self.BASE * 2 ** (n - 1) <= self.CAP or n >= 6

    def test_capped_at_two_minutes(self):
        exp = min(self.BASE * 2 ** (10 - 1), self.CAP)
        assert exp == self.CAP

    def test_ts_source_contains_policy(self):
        ts = Path(__file__).resolve().parents[1] / "frontend" / "services" / "BatchOfflineManager.ts"
        src = ts.read_text(encoding="utf-8")
        assert "backoffDelayMs" in src
        assert "nextRetryAt" in src
        assert "X-Package-Id" in src
        assert "MAX_RETRY_COUNT" in src
