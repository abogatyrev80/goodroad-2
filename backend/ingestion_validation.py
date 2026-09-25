"""Bounded ingestion for legacy and adaptive collectors.

Axes allow +/-1000 in either shipped g or m/s2 units, well beyond phone motion
while keeping classifier squares/variances safe. Limits allow 50-record legacy
batches and 10-event offline flushes, including 50 Hz adaptive windows.
"""

import json
import math

from fastapi import HTTPException

MAX_BODY_BYTES = 8 * 1024 * 1024
MAX_DEVICE_ID_LENGTH = 256
MAX_BATCH_EVENTS = 100
MAX_SAMPLES_PER_EVENT = 2000
MAX_BATCH_SAMPLES = 50000
MAX_SENSOR_AXIS = 1000


async def read_raw_json(request):
    length = request.headers.get('content-length')
    if length is not None:
        try:
            length = int(length)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid Content-Length")
        if length < 0:
            raise HTTPException(status_code=400, detail="Invalid Content-Length")
        if length > MAX_BODY_BYTES:
            raise HTTPException(status_code=413, detail="Raw batch body too large")
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_BODY_BYTES:
            raise HTTPException(status_code=413, detail="Raw batch body too large")
        body.extend(chunk)
    try:
        return json.loads(body)
    except (ValueError, UnicodeDecodeError, RecursionError):
        raise HTTPException(status_code=400, detail="Invalid JSON body")


def validate_raw_batch(body, *, adaptive=False):
    def invalid(message):
        raise HTTPException(status_code=400, detail=message)

    def number(value, field):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            invalid(f"{field} must be a finite number")
        try:
            finite = math.isfinite(value)
        except OverflowError:
            finite = False
        if not finite:
            invalid(f"{field} must be a finite number")
        if isinstance(value, int) and not -(2**63) <= value < 2**63:
            invalid(f"{field} is outside the supported integer range")
        return value

    if not isinstance(body, dict):
        invalid("JSON body must be an object")
    device_id = body.get("deviceId")
    if not isinstance(device_id, str) or not device_id.strip():
        invalid("deviceId must be a non-empty string")
    if len(device_id) > MAX_DEVICE_ID_LENGTH:
        invalid(f"deviceId must be at most {MAX_DEVICE_ID_LENGTH} characters")
    key = "events" if adaptive and "events" in body else "data"
    points = body.get(key)
    if not isinstance(points, list) or not points:
        invalid(f"{key} must be a non-empty array")
    if len(points) > MAX_BATCH_EVENTS:
        invalid(f"{key} must contain at most {MAX_BATCH_EVENTS} records")

    total_samples = 0
    for index, point in enumerate(points):
        prefix = f"{key}[{index}]"
        if not isinstance(point, dict):
            invalid(f"{prefix} must be an object")
        kind = point.get("kind", "trigger" if adaptive else "legacy")
        if kind not in ("legacy", "background", "trigger", "prearm", "user_report"):
            invalid(f"{prefix}.kind is invalid")
        if "deviceId" in point and point["deviceId"] != device_id:
            invalid(f"{prefix}.deviceId must match batch deviceId")
        gps = point.get("gps")
        if not isinstance(gps, dict):
            invalid(f"{prefix}.gps must be an object")
        lat = number(gps.get("latitude"), f"{prefix}.gps.latitude")
        lon = number(gps.get("longitude"), f"{prefix}.gps.longitude")
        if not -90 <= lat <= 90 or not -180 <= lon <= 180:
            invalid(f"{prefix}.gps coordinates out of range")
        for field in ("speed", "accuracy", "altitude", "heading"):
            if gps.get(field) is not None:
                value = number(gps[field], f"{prefix}.gps.{field}")
                bound = 1000 if field in ("speed", "heading") else 100000
                if abs(value) > bound:
                    invalid(f"{prefix}.gps.{field} exceeds supported range")

        samples = point.get("accelerometer")
        if isinstance(samples, dict):
            samples = [samples]
        elif samples is None:
            samples = []
        if not isinstance(samples, list):
            invalid(f"{prefix}.accelerometer must be an array or reading object")
        total_samples += len(samples)
        if len(samples) > MAX_SAMPLES_PER_EVENT or total_samples > MAX_BATCH_SAMPLES:
            invalid("Too many accelerometer samples")
        if not samples and kind not in ("background", "user_report") and not point.get("userReported"):
            invalid(f"{prefix}.accelerometer must contain samples")
        for sample_index, sample in enumerate(samples):
            field = f"{prefix}.accelerometer[{sample_index}]"
            if not isinstance(sample, dict):
                invalid(f"{field} must be an object")
            for axis in ("x", "y", "z"):
                value = number(sample.get(axis), f"{field}.{axis}")
                if abs(value) > MAX_SENSOR_AXIS:
                    invalid(f"{field}.{axis} must be within +/-{MAX_SENSOR_AXIS}")
            for name in ("timestamp", "magnitude"):
                if sample.get(name) is not None:
                    value = number(sample[name], f"{field}.{name}")
                    if abs(value) > (1e15 if name == 'timestamp' else 2000):
                        invalid(f"{field}.{name} exceeds supported range")
        for field in ("timestamp", "duration_ms", "capture_frequency_hz", "max_magnitude", "trigger_magnitude", "speed_kmh"):
            if point.get(field) is not None:
                value = number(point[field], f"{prefix}.{field}")
                if abs(value) > (1e15 if field == 'timestamp' else 1e9):
                    invalid(f"{prefix}.{field} exceeds supported range")
        if "userReported" in point and not isinstance(point["userReported"], bool):
            invalid(f"{prefix}.userReported must be a boolean")
        if point.get("severity") is not None:
            severity = number(point["severity"], f"{prefix}.severity")
            if int(severity) != severity or not 1 <= severity <= 5:
                invalid(f"{prefix}.severity must be an integer from 1 to 5")
        for field in ("eventType", "zone_id"):
            if point.get(field) is not None and not isinstance(point[field], str):
                invalid(f"{prefix}.{field} must be a string")
    pending = [("body", body)]
    while pending:
        field, value = pending.pop()
        if isinstance(value, dict):
            pending.extend((f"{field}.{key}", item) for key, item in value.items())
        elif isinstance(value, list):
            pending.extend((f"{field}[{index}]", item) for index, item in enumerate(value))
        elif isinstance(value, (int, float)) and not isinstance(value, bool):
            number(value, field)
    return device_id, points
