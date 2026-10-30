"""API contract tests: health endpoints, admin auth, ingest validation.

Run: pytest tests/test_api_contract.py -v
No MongoDB required - DB-dependent handlers are exercised only for
auth/validation paths that fail before touching the database.
"""
import os

os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("ADMIN_API_TOKEN", "test-admin-token")

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

import server  # noqa: E402


@pytest.fixture(scope="module")
def client():
    return TestClient(server.app)


TOKEN = "test-admin-token"


class TestHealthContract:
    def test_health_ok(self, client):
        r = client.get("/health")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "healthy"
        assert body["service"] == "Good Road API"
        assert "timestamp" in body

    def test_ready_returns_200_or_503(self, client):
        """Readiness depends on Mongo; contract: never 401/404/500."""
        r = client.get("/ready")
        assert r.status_code in (200, 503)


class TestAdminAuthContract:
    """All /api/admin* and /admin* routes must require the bearer token."""

    ADMIN_PATHS = [
        "/api/admin/v2/analytics",
        "/api/admin/events",
        "/api/admin/clusters",
    ]

    @pytest.mark.parametrize("path", ADMIN_PATHS)
    def test_admin_requires_token(self, client, path):
        r = client.get(path)
        assert r.status_code == 401, f"{path} must be protected (got {r.status_code})"

    @pytest.mark.parametrize("path", ADMIN_PATHS)
    def test_admin_rejects_wrong_token(self, client, path):
        r = client.get(path, headers={"Authorization": "Bearer wrong-token"})
        assert r.status_code == 401

    @pytest.mark.parametrize("path", ADMIN_PATHS)
    def test_admin_accepts_correct_token(self, client, path):
        """With correct token request passes auth layer.

        Downstream may return 200/404/422/500 (no live Mongo), but NOT 401/403.
        """
        r = client.get(
            path, headers={"Authorization": f"Bearer {TOKEN}"}
        )
        assert r.status_code not in (401, 403), (
            f"{path}: valid token rejected with {r.status_code}"
        )

    def test_header_token_alternative(self, client):
        r = client.get(
            "/api/admin/v2/analytics", headers={"X-Admin-Token": TOKEN}
        )
        assert r.status_code not in (401, 403)

    def test_public_pages_not_blocked(self, client):
        """Routes outside /admin prefix must not demand a token."""
        r = client.get("/health")
        assert r.status_code == 200


class TestIngestContract:
    def test_sensor_data_requires_fields(self, client):
        """POST sensor data without required fields -> 4xx validation, not 500."""
        r = client.post("/api/sensor-data", json={})
        assert 400 <= r.status_code < 500 or r.status_code in (401, 422)

    def test_unknown_route_404(self, client):
        r = client.get("/api/definitely-not-a-route")
        assert r.status_code == 404
