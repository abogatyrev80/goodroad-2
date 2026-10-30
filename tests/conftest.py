import os

# Настройка ДО импорта backend-модулей
os.environ.setdefault("ENVIRONMENT", "test")
os.environ["ADMIN_API_TOKEN"] = "test-admin-token"

import pytest


@pytest.fixture(scope="session")
def admin_headers():
    return {"Authorization": "Bearer test-admin-token"}
