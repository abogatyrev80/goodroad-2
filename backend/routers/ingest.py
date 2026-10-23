# -*- coding: utf-8 -*-
"""
Приём сырых данных с мобильного приложения (вынесено из server.py).
"""
import logging

from fastapi import APIRouter, HTTPException

from config import (
    db, mongodb_connected, check_rate_limit,
    obstacle_clusterer, event_classifier, warning_generator,
)
from models import RawDataBatch
from services.geo import validate_gps_coords

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


@router.post("/raw-data", status_code=201)
async def ingest_raw_data(batch: RawDataBatch):
    """
    Приём сырых данных акселерометра + GPS с мобильного приложения.
    Сохраняет в raw_sensor_data, прогоняет через ML классификатор,
    сохраняет события и генерирует предупреждения.
    """
    if not mongodb_connected:
        raise HTTPException(503, detail="MongoDB not connected")

    if not check_rate_limit(batch.deviceId):
        raise HTTPException(429, detail="Rate limit exceeded")

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

    return {
        "received": received,
        "processed": len(detected_events),
        "events": detected_events[:20],
        "warnings": warnings[:10],
    }

