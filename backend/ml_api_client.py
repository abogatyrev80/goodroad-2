"""HTTP-клиент для загрузки данных обучения с Good Road API."""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

import requests

DEFAULT_TIMEOUT = 120
PAGE_SIZE = 10000


class GoodRoadApiClient:
    def __init__(self, base_url: str, timeout: int = DEFAULT_TIMEOUT):
        self.base_url = base_url.rstrip("/")
        if not self.base_url.endswith("/api"):
            self.api_base = f"{self.base_url}/api"
        else:
            self.api_base = self.base_url
        self.timeout = timeout
        self.session = requests.Session()

    def _get(self, path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        url = urljoin(self.api_base + "/", path.lstrip("/"))
        resp = self.session.get(url, params=params or {}, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    def health(self) -> Dict[str, Any]:
        return self._get("/")

    def analytics(self) -> Dict[str, Any]:
        return self._get("admin/v2/analytics")

    def fetch_events(
        self,
        max_items: int = 20000,
        event_type: Optional[str] = None,
        page_size: int = PAGE_SIZE,
    ) -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        skip = 0
        while len(items) < max_items:
            limit = min(page_size, max_items - len(items))
            params: Dict[str, Any] = {"limit": limit, "skip": skip}
            if event_type:
                params["event_type"] = event_type
            data = self._get("admin/v2/events", params)
            batch = data.get("events") or []
            if not batch:
                break
            items.extend(batch)
            skip += len(batch)
            if len(batch) < limit:
                break
            time.sleep(0.05)
        return items

    def fetch_raw_data(
        self,
        max_items: int = 50000,
        page_size: int = PAGE_SIZE,
    ) -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        skip = 0
        while len(items) < max_items:
            limit = min(page_size, max_items - len(items))
            data = self._get("admin/v2/raw-data", {"limit": limit, "skip": skip})
            batch = data.get("data") or []
            if not batch:
                break
            items.extend(batch)
            skip += len(batch)
            if len(batch) < limit:
                break
            time.sleep(0.05)
        return items
