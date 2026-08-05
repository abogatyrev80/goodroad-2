"""
Server-side warning service.

Формирует предупреждения на сервере из классифицированных событий
(processed_events) или напрямую из окон акселерометра (raw_sensor_data),
хранит их в коллекции user_warnings и отдаёт клиентам и админ-панели.

Схема документа user_warnings:
    {
        "_id": ObjectId,
        "deviceId": str,
        "type": str,                  # eventType (pothole/bump/speed_bump/...)
        "severity": int,              # 1-5 (1=критическое)
        "confidence": float,
        "latitude": float,
        "longitude": float,
        "speed": float,
        "kind": str,                  # trigger/prearm/user_report/gpu
        "message": str,               # человекочитаемый текст
        "source": str,                # inference | gpu_classifier | user_report
        "status": str,                # active | expired | verified | dismissed
        "raw_id": str,                # id исходного raw_sensor_data
        "event_id": str,              # id processed_events (если есть)
        "cluster_id": str,            # id кластера (если есть)
        "zone_id": str,
        "created_at": datetime,
        "updated_at": datetime,
        "expiresAt": datetime,        # TTL предупреждения (1h)
        # legacy-совместимые поля для приложения
        "hazard_type": str,
        "description": str,
        "is_verified": bool,
        "city": str,
        "country": str,
    }
"""

import logging
import uuid
from datetime import datetime, timedelta
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

WARNING_TTL = timedelta(hours=1)
WARNING_DEDUP_RADIUS_M = 50.0
CRITICAL_SEVERITY_MAX = 2


def build_warning(
    event_type: str,
    severity: int,
    latitude: float,
    longitude: float,
    device_id: str,
    confidence: float = 0.0,
    speed: float = 0.0,
    kind: str = "trigger",
    source: str = "inference",
    raw_id: Optional[str] = None,
    event_id: Optional[str] = None,
    cluster_id: Optional[str] = None,
    zone_id: Optional[str] = None,
    description: Optional[str] = None,
) -> Dict:
    """Собирает документ предупреждения из классифицированного события."""
    message = description or _severity_text(severity, event_type)
    now = datetime.utcnow()
    return {
        "deviceId": device_id,
        "type": event_type,
        "severity": severity,
        "confidence": float(confidence or 0),
        "latitude": float(latitude),
        "longitude": float(longitude),
        "speed": float(speed or 0),
        "kind": kind,
        "message": message,
        "source": source,
        "status": "active",
        "raw_id": raw_id,
        "event_id": event_id,
        "cluster_id": cluster_id,
        "zone_id": zone_id,
        "created_at": now,
        "updated_at": now,
        "expiresAt": now + WARNING_TTL,
        "hazard_type": event_type,
        "description": message,
        "is_verified": False,
        "city": "",
        "country": "",
    }


def _severity_text(severity: int, event_type: str) -> str:
    severity_text = {
        1: "КРИТИЧЕСКОЕ",
        2: "ВЫСОКОЕ",
        3: "СРЕДНЕЕ",
    }.get(severity, "НИЗКОЕ")
    event_text = {
        "pothole": "ЯМА",
        "braking": "РЕЗКОЕ ТОРМОЖЕНИЕ",
        "bump": "НЕРОВНОСТЬ",
        "vibration": "ПЛОХОЕ ПОКРЫТИЕ",
        "speed_bump": "ЛЕЖАЧИЙ ПОЛИЦЕЙСКИЙ",
        "wave": "ВОЛНА",
    }.get(event_type, "ОПАСНОСТЬ")
    return f"{severity_text}: {event_text}"


def should_warn(severity: int) -> bool:
    """Предупреждаем только о критических/высоких событиях (severity <= 2)."""
    return severity <= CRITICAL_SEVERITY_MAX


async def save_warning(db, warning: Dict, dedup_radius_m: float = WARNING_DEDUP_RADIUS_M) -> Optional[str]:
    """
    Сохраняет предупреждение в user_warnings с дедупликацией.
    Если рядом уже есть активное предупреждение того же типа — обновляет его
    (свежий timestamp) и возвращает его id, иначе вставляет новое.
    """
    try:
        wtype = warning.get("type")
        lat = warning.get("latitude")
        lon = warning.get("longitude")
        if not lat or not lon or not wtype:
            logger.warning("save_warning skipped: missing type/lat/lon")
            return None

        now = datetime.utcnow()
        existing = await db.user_warnings.find_one({
            "type": wtype,
            "status": "active",
            "expiresAt": {"$gt": now},
            "latitude": {"$gte": lat - 0.001, "$lte": lat + 0.001},
            "longitude": {"$gte": lon - 0.001, "$lte": lon + 0.001},
        })

        if existing:
            update = {
                "updated_at": now,
                "expiresAt": now + WARNING_TTL,
                "severity": min(warning.get("severity", 5), existing.get("severity", 5)),
                "confidence": max(warning.get("confidence", 0), existing.get("confidence", 0)),
                "source": warning.get("source", "inference"),
            }
            if warning.get("cluster_id"):
                update["cluster_id"] = warning["cluster_id"]
            await db.user_warnings.update_one({"_id": existing["_id"]}, {"$set": update})
            return str(existing["_id"])

        warning.setdefault("_id", uuid.uuid4())
        result = await db.user_warnings.insert_one(warning)
        return str(result.inserted_id)
    except Exception as e:
        logger.error(f"save_warning error: {e}")
        return None


async def create_warning_from_event(db, event: Dict, source: str = "inference") -> Optional[str]:
    """Удобная обёртка: создаёт предупреждение из словаря события (processed_event)."""
    if not event or not event.get("eventType"):
        return None
    severity = event.get("severity", 5)
    if not should_warn(severity):
        return None
    lat = event.get("latitude")
    lon = event.get("longitude")
    if not lat or not lon:
        return None
    warning = build_warning(
        event_type=event["eventType"],
        severity=severity,
        latitude=lat,
        longitude=lon,
        device_id=event.get("deviceId", "unknown"),
        confidence=event.get("confidence", 0),
        speed=event.get("speed", 0),
        kind=event.get("kind", "trigger"),
        source=source,
        raw_id=str(event.get("raw_id")) if event.get("raw_id") else None,
        event_id=str(event.get("id")) if event.get("id") else None,
        cluster_id=str(event.get("clusterId")) if event.get("clusterId") else None,
        zone_id=event.get("zone_id"),
        description=event.get("description"),
    )
    return await save_warning(db, warning)


async def list_active_warnings(
    db,
    limit: int = 500,
    min_severity: int = 0,
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    radius_m: Optional[float] = None,
) -> List[Dict]:
    """Активные (не истёкшие) предупреждения. Опционально по близости."""
    query = {"status": "active", "expiresAt": {"$gt": datetime.utcnow()}}
    if min_severity:
        query["severity"] = {"$lte": min_severity}

    warnings = await db.user_warnings.find(
        query, {"_id": 0}
    ).sort("created_at", -1).limit(limit).to_list(limit)

    if latitude is not None and longitude is not None and radius_m is not None:
        from services.geo import calculate_distance
        result = []
        for w in warnings:
            d = calculate_distance(latitude, longitude, w["latitude"], w["longitude"])
            w["distance"] = d
            if d <= radius_m:
                result.append(w)
        result.sort(key=lambda x: (x.get("severity", 5), -x.get("distance", 0)))
        return result

    return warnings
