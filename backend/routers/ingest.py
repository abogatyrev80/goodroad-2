# -*- coding: utf-8 -*-
"""
Приём сырых данных с мобильного приложения (вынесено из server.py).
"""
import logging
from datetime import datetime

from fastapi import APIRouter, Header, HTTPException

from config import (
    db, mongodb_connected, check_rate_limit, IDEMPOTENCY_TTL_DAYS,
    obstacle_clusterer, event_classifier, warning_generator,
)
from models import RawDataBatch
from services.geo import validate_gps_coords

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")

IDEMPOTENCY_TTL_DAYS = 7


async def _idempotency_check(package_id: str | None) -> dict | None:
    """Return a previously stored response for this package id, or None.

    Uses the capped collection api_idempotency with a TTL index so retried
    uploads from mobile clients are not double-processed.
    """
    if not package_id:
        return None
    try:
        doc = await db.api_idempotency.find_one({"_id": package_id})
        if doc and doc.get("response") is not None:
            logger.info("Idempotent replay for package %s", package_id)
            return doc["response"]
    except Exception as e:  # pragma: no cover - best effort
        logger.warning("Idempotency lookup failed: %s", e)
    return None


async def _idempotency_store(package_id: str | None, response: dict) -> None:
    if not package_id:
        return
    try:
        await db.api_idempotency.update_one(
            {"_id": package_id},
            {
                "$set": {"response": response, "created_at": datetime.utcnow()},
                "$setOnInsert": {"expires_at": datetime.utcnow()},
            },
            upsert=True,
        )
    except Exception as e:  # pragma: no cover - best effort
        logger.warning("Idempotency store failed: %s", e)


@router.post("/sensor-data", status_code=201)
@router.post("/raw-data", status_code=201)
async def ingest_raw_data(
    batch: RawDataBatch,
    x_package_id: str | None = Header(None, alias="X-Package-Id"),
):
    """
    Приём сырых данных акселерометра + GPS с мобильного приложения.
    Сохраняет в raw_sensor_data, прогоняет через ML классификатор,
    сохраняет события и генерирует предупреждения.
    """
    if not mongodb_connected:
        raise HTTPException(503, detail="MongoDB not connected")

    if not check_rate_limit(batch.deviceId):
        raise HTTPException(429, detail="Rate limit exceeded")

    # Idempotency: retried offline uploads (same X-Package-Id) return the
    # original response instead of duplicating raw points/clusters.
    cached = await _idempotency_check(x_package_id)
    if cached is not None:
        return cached

    if not batch.data:
        raise HTTPException(400, detail="Empty data batch")

    received = len(batch.data)
    detected_events = []
    warnings = []

    for point in batch.data:
        try:
            gps = point.gps
            lat = gps.get("latitude")
            lng = gps.get("longitude")
            if not validate_gps_coords(lat, lng):
                logger.warning("Invalid GPS: device=%s lat=%s lng=%s", batch.deviceId, lat, lng)
                continue

            speed = gps.get("speed", 0)

            raw_doc = {
                "deviceId": batch.deviceId,
                "timestamp": point.timestamp,
                "gps": gps,
                "accelerometer": point.accelerometer,
                "userReported": point.userReported or False,
                "eventType": point.eventType,
                "severity": point.severity,
                "created_at": datetime.utcnow(),
            }
            await db.raw_sensor_data.insert_one(raw_doc)

            accel = point.accelerometer
            if isinstance(accel, list) and len(accel) >= 8:
                event = event_classifier.analyze_accelerometer_array(
                    batch.deviceId,
                    [{"x": a.x, "y": a.y, "z": a.z, "timestamp": a.timestamp or point.timestamp} for a in accel],
                    speed,
                )

                if event and event.get("eventType"):
                    event_type = event["eventType"]
                    severity = event.get("severity", 2)
                    confidence = event.get("confidence", 0.5)

                    event_doc = {
                        "deviceId": batch.deviceId,
                        "timestamp": datetime.utcnow(),
                        "eventType": event_type,
                        "severity": severity,
                        "confidence": confidence,
                        "latitude": lat,
                        "longitude": lng,
                        "speed": speed,
                        "accelerometer_data": {
                            "mean_x": event.get("stats", {}).get("mean_x", 0),
                            "mean_y": event.get("stats", {}).get("mean_y", 0),
                            "mean_z": event.get("stats", {}).get("mean_z", 0),
                            "max_magnitude": event.get("stats", {}).get("max_magnitude", 0),
                        },
                        "roadType": event.get("roadType", "unknown"),
                        "created_at": datetime.utcnow(),
                    }
                    await db.processed_events.insert_one(event_doc)
                    detected_events.append({
                        "eventType": event_type,
                        "severity": severity,
                        "confidence": confidence,
                        "latitude": lat,
                        "longitude": lng,
                    })

                    if obstacle_clusterer:
                        try:
                            nearby = await obstacle_clusterer.find_nearby_cluster(lat, lng, event_type)
                            if nearby:
                                await obstacle_clusterer.update_cluster(lat, lng, event_type, batch.deviceId, confidence)
                            else:
                                await obstacle_clusterer.create_cluster(lat, lng, severity, event_type, batch.deviceId, confidence)
                        except Exception as e:
                            logger.warning("Cluster error: %s", e)

                    warn, dist = warning_generator.should_warn_user(lat, lng, lat, lng, event_type, severity)
                    if warn:
                        msg = warning_generator.create_warning_message(event_type, severity, dist)
                        warnings.append({
                            "eventType": event_type,
                            "severity": severity,
                            "distance": dist,
                            "message": msg,
                            "latitude": lat,
                            "longitude": lng,
                        })

            if point.userReported and point.eventType:
                detected_events.append({
                    "eventType": point.eventType,
                    "severity": point.severity or 2,
                    "confidence": 1.0,
                    "latitude": lat,
                    "longitude": lng,
                    "userReported": True,
                })

        except Exception as e:
            logger.error("Error processing data point: %s", e)
            continue

    response = {
        "received": received,
        "processed": len(detected_events),
        "events": detected_events[:20],
        "warnings": warnings[:10],
    }
    await _idempotency_store(x_package_id, response)
    return response

