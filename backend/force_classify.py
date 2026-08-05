#!/usr/bin/env python3
"""
Принудительная классификация предупреждений с локальной GPU-машины.

Тянет необработанные окна (trigger/prearm) с прода через admin API,
классифицирует локально (EventClassifier + LSTM на ROCm/GPU),
и пушит получившиеся предупреждения обратно на прод.

Примеры:
    python3 force_classify.py --dry-run                 # только анализ, ничего не пушить
    python3 force_classify.py --push --hours 48         # пушить предупреждения за 48ч
    python3 force_classify.py --push --limit 200 --kind trigger,prearm
    python3 force_classify.py --api http://localhost:8000 --push
"""

import argparse
import asyncio
import json
import logging
import os
import sys
import urllib.request
import urllib.parse
from datetime import datetime, timedelta

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("force_classify")

DEFAULT_API = "https://goodroad.su"


def fetch_json(url: str, method: str = "GET", payload=None, timeout: int = 60):
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        logger.error("HTTP %s %s failed: %s", method, url, e)
        raise


def pull_raw_data(api: str, limit: int, kind: str, hours: int) -> list:
    params = {
        "limit": limit,
        "unprocessed": "true",
        "kind": kind,
    }
    url = f"{api}/api/admin/v2/raw-data?{urllib.parse.urlencode(params)}"
    result = fetch_json(url)
    data = result.get("data", [])
    cutoff = int((datetime.utcnow() - timedelta(hours=hours)).timestamp() * 1000)

    def _ts(doc):
        t = doc.get("timestamp")
        if t is None:
            return 0
        if isinstance(t, str):
            try:
                return int(float(t))
            except Exception:
                return 0
        return int(t)

    filtered = [d for d in data if _ts(d) >= cutoff]
    logger.info(
        "Pulled %d raw docs (total=%s, limit=%d, kind=%s, filtered_by_%dh=%d)",
        len(data), result.get("total"), limit, kind, hours, len(filtered)
    )
    return filtered


def classify_docs(docs: list) -> list:
    """Локальная классификация окон. Возвращает список событий."""
    from config import event_classifier

    events = []
    for doc in docs:
        try:
            gps = doc.get("gps") or {}
            if isinstance(gps, dict):
                lat = gps.get("latitude") or doc.get("latitude")
                lon = gps.get("longitude") or doc.get("longitude")
                speed = gps.get("speed", 0) or doc.get("speed_kmh", 0) or 0
            else:
                lat = doc.get("latitude")
                lon = doc.get("longitude")
                speed = doc.get("speed_kmh", 0) or 0

            accel = doc.get("accelerometer") or []
            if not isinstance(accel, list) or len(accel) < 3:
                continue

            ev = event_classifier.analyze_accelerometer_array(
                device_id=doc.get("deviceId", "gpu-machine"),
                accelerometer_data=accel,
                speed=speed,
            )
            if not ev or not ev.get("eventType"):
                continue

            ev.update({
                "latitude": lat,
                "longitude": lon,
                "speed": speed,
                "raw_id": doc.get("_id"),
                "kind": doc.get("kind", "trigger"),
                "zone_id": doc.get("zone_id"),
                "deviceId": doc.get("deviceId", "gpu-machine"),
            })
            events.append(ev)
        except Exception as e:
            logger.warning("Classification error for doc %s: %s", doc.get("_id"), e)
    return events


def push_warnings(api: str, events: list, push: bool) -> None:
    if not events:
        logger.info("No events to push")
        return
    critical = [e for e in events if (e.get("severity") or 5) <= 2]
    logger.info(
        "Classified: %d events total, %d critical (severity<=2) -> warnings",
        len(events), len(critical)
    )
    if not critical:
        return
    if not push:
        logger.info("DRY-RUN: would push %d warnings", len(critical))
        for e in critical[:10]:
            logger.info(
                "  warning: type=%s sev=%s conf=%.2f lat=%.5f lon=%.5f raw=%s",
                e.get("eventType"), e.get("severity"), e.get("confidence", 0),
                e.get("latitude"), e.get("longitude"), e.get("raw_id")
            )
        return
    payload = {"warnings": critical}
    result = fetch_json(f"{api}/api/admin/warnings/ingest", method="POST", payload=payload)
    logger.info("Pushed warnings: %s", result)


def mark_processed(api: str, docs: list, push: bool) -> None:
    ids = [d.get("_id") for d in docs if d.get("_id")]
    if not ids:
        return
    if not push:
        logger.info("DRY-RUN: would mark %d docs as processed", len(ids))
        return
    result = fetch_json(
        f"{api}/api/admin/raw-data/mark-processed",
        method="POST",
        payload={"ids": ids},
    )
    logger.info("Marked processed: %s", result)


def main() -> int:
    parser = argparse.ArgumentParser(description="Force classification from local GPU machine")
    parser.add_argument("--api", default=DEFAULT_API, help="Backend API URL")
    parser.add_argument("--limit", type=int, default=100, help="Max raw docs to pull")
    parser.add_argument("--kind", default="trigger,prearm", help="Comma-separated kinds")
    parser.add_argument("--hours", type=int, default=24, help="Only docs newer than N hours")
    parser.add_argument("--push", action="store_true", help="Push warnings and mark processed")
    args = parser.parse_args()

    logger.info("Force classification: api=%s limit=%d kind=%s hours=%d push=%s",
                args.api, args.limit, args.kind, args.hours, args.push)

    try:
        docs = pull_raw_data(args.api, args.limit, args.kind, args.hours)
        if not docs:
            logger.info("No raw windows to classify")
            return 0
        events = classify_docs(docs)
        push_warnings(args.api, events, args.push)
        mark_processed(args.api, docs, args.push)
        return 0
    except Exception as e:
        logger.error("Force classification failed: %s", e)
        return 1


if __name__ == "__main__":
    sys.exit(main())
