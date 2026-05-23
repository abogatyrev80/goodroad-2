"""
Загрузка обучающих окон акселерометра из MongoDB, Good Road API и синтетики.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

import numpy as np
from motor.motor_asyncio import AsyncIOMotorClient

from ml_api_client import GoodRoadApiClient
from ml_constants import (
    API_LABEL_MAP,
    DEFAULT_WINDOW_SIZE,
    EVENT_TO_INDEX,
    EVENT_TYPES,
    MIN_WINDOW_SIZE,
)

SequenceSample = Tuple[np.ndarray, int]  # (window, class_index)


def normalize_event_type(event_type: Optional[str]) -> Optional[str]:
    if not event_type:
        return None
    mapped = API_LABEL_MAP.get(event_type, event_type)
    return mapped if mapped in EVENT_TO_INDEX else None


def _parse_ts(value) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00").replace("+00:00", ""))
        except ValueError:
            return None
    return None


def _pad_or_trim(window: np.ndarray, size: int) -> np.ndarray:
    """Приводит окно к фиксированной длине (timesteps, 3)."""
    if window.shape[0] == size:
        return window
    if window.shape[0] > size:
        start = (window.shape[0] - size) // 2
        return window[start : start + size]
    pad = np.zeros((size - window.shape[0], 3), dtype=np.float32)
    return np.vstack([pad, window])


def _accel_points_from_raw_point(point: dict) -> List[Dict[str, float]]:
    """Извлекает список {x,y,z} из точки sensor_data.rawData."""
    data = point.get("data") or {}
    if point.get("type") == "accelerometer":
        if isinstance(data, dict) and "x" in data:
            return [{"x": data["x"], "y": data["y"], "z": data["z"]}]
        if isinstance(data, list):
            out = []
            for item in data:
                if isinstance(item, dict) and "x" in item:
                    out.append(
                        {
                            "x": float(item["x"]),
                            "y": float(item["y"]),
                            "z": float(item["z"]),
                        }
                    )
            return out
    return []


def _event_label_from_point(point: dict) -> Optional[str]:
    if point.get("type") != "event":
        return None
    data = point.get("data") or {}
    label = data.get("eventType") or data.get("event_type")
    if label in EVENT_TO_INDEX:
        return label
    return None


def build_windows_from_accel_series(
    series: List[Dict[str, float]],
    label: str,
    window_size: int = DEFAULT_WINDOW_SIZE,
) -> List[SequenceSample]:
    """Скользящее окно по ряду акселерометра."""
    if label not in EVENT_TO_INDEX or len(series) < MIN_WINDOW_SIZE:
        return []

    arr = np.array(
        [[p["x"], p["y"], p["z"]] for p in series],
        dtype=np.float32,
    )
    samples: List[SequenceSample] = []
    step = max(1, window_size // 4)
    for start in range(0, len(arr) - MIN_WINDOW_SIZE + 1, step):
        chunk = arr[start : start + window_size]
        if chunk.shape[0] < MIN_WINDOW_SIZE:
            continue
        samples.append((_pad_or_trim(chunk, window_size), EVENT_TO_INDEX[label]))
    return samples


async def load_sequences_from_mongo(
    mongo_url: str,
    db_name: str,
    window_size: int = DEFAULT_WINDOW_SIZE,
    limit_batches: int = 5000,
    days_back: Optional[int] = None,
) -> List[SequenceSample]:
    """
    Источники:
    1) sensor_data.rawData — события type=event + соседние accelerometer
    2) processed_events — окна из соседних raw_sensor_data по deviceId
    """
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]
    samples: List[SequenceSample] = []

    time_filter = {}
    if days_back is not None:
        since = datetime.utcnow() - timedelta(days=days_back)
        time_filter["created_at"] = {"$gte": since}

    # --- sensor_data: события с контекстом акселерометра ---
    cursor = db.sensor_data.find(time_filter).sort("timestamp", -1).limit(limit_batches)
    async for doc in cursor:
        raw = doc.get("rawData") or []
        if not raw:
            continue

        accel_buffer: List[Dict[str, float]] = []
        for point in raw:
            accel_buffer.extend(_accel_points_from_raw_point(point))
            label = _event_label_from_point(point)
            if label and len(accel_buffer) >= MIN_WINDOW_SIZE:
                samples.extend(
                    build_windows_from_accel_series(accel_buffer, label, window_size)
                )

    # --- processed_events + raw_sensor_data по устройству ---
    events = (
        await db.processed_events.find(
            {**time_filter, "eventType": {"$in": list(EVENT_TYPES)}}
        )
        .sort("timestamp", -1)
        .limit(limit_batches)
        .to_list(length=limit_batches)
    )

    for ev in events:
        label = ev.get("eventType")
        if label not in EVENT_TO_INDEX:
            continue
        device_id = ev.get("deviceId")
        ts = ev.get("timestamp")
        if not device_id or not ts:
            continue

        t0 = ts - timedelta(seconds=2)
        t1 = ts + timedelta(seconds=2)
        rows = (
            await db.raw_sensor_data.find(
                {
                    "deviceId": device_id,
                    "timestamp": {"$gte": t0, "$lte": t1},
                }
            )
            .sort("timestamp", 1)
            .to_list(length=256)
        )
        if len(rows) < MIN_WINDOW_SIZE:
            continue

        series = [
            {
                "x": float(r.get("accelerometer_x", 0)),
                "y": float(r.get("accelerometer_y", 0)),
                "z": float(r.get("accelerometer_z", 0)),
            }
            for r in rows
        ]
        samples.extend(build_windows_from_accel_series(series, label, window_size))

    client.close()
    return samples


def _samples_from_events_list(
    events: List[Dict],
    window_size: int,
) -> List[SequenceSample]:
    """Строит окна из последовательностей событий одного устройства."""
    by_device: Dict[str, List[Dict]] = defaultdict(list)
    for ev in events:
        label = normalize_event_type(ev.get("eventType"))
        if not label:
            continue
        device = ev.get("deviceId")
        ts = _parse_ts(ev.get("timestamp"))
        if not device or not ts:
            continue
        by_device[device].append(
            {
                "ts": ts,
                "label": label,
                "x": float(ev.get("accelerometer_x", 0)),
                "y": float(ev.get("accelerometer_y", 0)),
                "z": float(ev.get("accelerometer_z", 0)),
            }
        )

    samples: List[SequenceSample] = []
    for device_events in by_device.values():
        device_events.sort(key=lambda e: e["ts"])
        buffer: List[Dict[str, float]] = []
        labels: List[str] = []
        for pt in device_events:
            buffer.append({"x": pt["x"], "y": pt["y"], "z": pt["z"]})
            labels.append(pt["label"])
            if len(buffer) < window_size:
                continue
            window = buffer[-window_size:]
            center_label = labels[len(labels) - window_size // 2]
            samples.extend(build_windows_from_accel_series(window, center_label, window_size))
            if len(buffer) > window_size * 2:
                buffer = buffer[-window_size:]
                labels = labels[-window_size:]
    return samples


def _samples_from_raw_with_events(
    raw_rows: List[Dict],
    events: List[Dict],
    window_size: int,
    max_gap_sec: float = 0.5,
    label_tolerance_sec: float = 1.0,
) -> List[SequenceSample]:
    """Группирует сырые точки по устройству и сопоставляет метку ближайшего события."""
    event_index: Dict[str, List[Tuple[datetime, str]]] = defaultdict(list)
    for ev in events:
        label = normalize_event_type(ev.get("eventType"))
        device = ev.get("deviceId")
        ts = _parse_ts(ev.get("timestamp"))
        if label and device and ts:
            event_index[device].append((ts, label))
    for device in event_index:
        event_index[device].sort(key=lambda x: x[0])

    def nearest_label(device: str, ts: datetime) -> Optional[str]:
        candidates = event_index.get(device) or []
        best = None
        best_dt = label_tolerance_sec + 1
        for ev_ts, lbl in candidates:
            dt = abs((ts - ev_ts).total_seconds())
            if dt < best_dt:
                best_dt = dt
                best = lbl
        return best if best_dt <= label_tolerance_sec else None

    by_device: Dict[str, List[Tuple[datetime, Dict[str, float]]]] = defaultdict(list)
    for row in raw_rows:
        device = row.get("deviceId")
        ts = _parse_ts(row.get("timestamp"))
        if not device or not ts:
            continue
        by_device[device].append(
            (
                ts,
                {
                    "x": float(row.get("accelerometer_x", 0)),
                    "y": float(row.get("accelerometer_y", 0)),
                    "z": float(row.get("accelerometer_z", 0)),
                },
            )
        )

    samples: List[SequenceSample] = []
    for device, points in by_device.items():
        points.sort(key=lambda p: p[0])
        buffer: List[Dict[str, float]] = []
        buffer_ts: List[datetime] = []
        for ts, pt in points:
            if buffer_ts and (ts - buffer_ts[-1]).total_seconds() > max_gap_sec:
                buffer.clear()
                buffer_ts.clear()
            buffer.append(pt)
            buffer_ts.append(ts)
            if len(buffer) < MIN_WINDOW_SIZE:
                continue
            label = nearest_label(device, buffer_ts[len(buffer) // 2])
            if label:
                samples.extend(
                    build_windows_from_accel_series(buffer[-window_size:], label, window_size)
                )
            buffer = buffer[-window_size:]
            buffer_ts = buffer_ts[-window_size:]
    return samples


def load_sequences_from_api(
    api_url: str,
    window_size: int = DEFAULT_WINDOW_SIZE,
    max_events: int = 20000,
    max_raw: int = 30000,
) -> List[SequenceSample]:
    """
    Загружает данные с production API (https://goodroad.su).
  """
    client = GoodRoadApiClient(api_url)
    health = client.health()
    print(f"  API: {api_url} — {health.get('status', '?')}, MongoDB: {health.get('mongodb_connected')}")

    analytics = client.analytics()
    summary = analytics.get("summary") or {}
    print(
        f"  В базе: raw={summary.get('raw_data_points', '?')}, "
        f"events={summary.get('processed_events', '?')}"
    )

    print(f"  Загрузка событий (до {max_events})...")
    events = client.fetch_events(max_items=max_events)
    print(f"  Получено событий: {len(events)}")

    samples = _samples_from_events_list(events, window_size)
    print(f"  Окон из событий: {len(samples)}")

    if max_raw > 0:
        print(f"  Загрузка raw-data (до {max_raw})...")
        raw_rows = client.fetch_raw_data(max_items=max_raw)
        print(f"  Получено raw точек: {len(raw_rows)}")
        raw_samples = _samples_from_raw_with_events(raw_rows, events, window_size)
        print(f"  Окон из raw-data: {len(raw_samples)}")
        samples.extend(raw_samples)

    return _dedupe_samples(samples)


def _dedupe_samples(samples: List[SequenceSample]) -> List[SequenceSample]:
    seen = set()
    unique: List[SequenceSample] = []
    for window, label in samples:
        key = (label, tuple(np.round(window, 4).flatten().tolist()))
        if key in seen:
            continue
        seen.add(key)
        unique.append((window, label))
    return unique


def generate_synthetic_samples(
    per_class: int = 200,
    window_size: int = DEFAULT_WINDOW_SIZE,
    seed: int = 42,
) -> List[SequenceSample]:
    """Синтетические окна для проверки пайплайна без MongoDB."""
    rng = np.random.default_rng(seed)
    samples: List[SequenceSample] = []

    profiles = {
        "pothole": {"z_spike": 2.5, "noise": 0.15},
        "speed_bump": {"z_wave": 1.2, "noise": 0.1},
        "bump": {"z_spike": 1.0, "noise": 0.12},
        "braking": {"y_spike": 1.5, "noise": 0.1},
        "vibration": {"noise": 0.45},
    }

    for label, params in profiles.items():
        idx = EVENT_TO_INDEX[label]
        for _ in range(per_class):
            t = np.linspace(0, 1, window_size, dtype=np.float32)
            x = rng.normal(0, 0.05, window_size).astype(np.float32)
            y = rng.normal(0, 0.05, window_size).astype(np.float32)
            z = np.full(window_size, 9.81, dtype=np.float32) + rng.normal(
                0, params.get("noise", 0.1), window_size
            ).astype(np.float32)

            if "z_spike" in params:
                mid = window_size // 2
                z[mid] += params["z_spike"]
            if "z_wave" in params:
                z += params["z_wave"] * np.sin(t * np.pi).astype(np.float32)
            if "y_spike" in params:
                mid = window_size // 2
                y[mid] -= params["y_spike"]

            window = np.column_stack([x, y, z])
            samples.append((window, idx))

    rng.shuffle(samples)
    return samples


def train_val_test_split(
    samples: List[SequenceSample],
    val_ratio: float = 0.15,
    test_ratio: float = 0.15,
    seed: int = 42,
) -> Tuple[List[SequenceSample], List[SequenceSample], List[SequenceSample]]:
    rng = np.random.default_rng(seed)
    indices = np.arange(len(samples))
    rng.shuffle(indices)
    n = len(indices)
    n_test = int(n * test_ratio)
    n_val = int(n * val_ratio)
    test_idx = indices[:n_test]
    val_idx = indices[n_test : n_test + n_val]
    train_idx = indices[n_test + n_val :]

    def pick(idxs):
        return [samples[i] for i in idxs]

    return pick(train_idx), pick(val_idx), pick(test_idx)


def samples_to_arrays(
    samples: List[SequenceSample],
) -> Tuple[np.ndarray, np.ndarray]:
    if not samples:
        return np.empty((0, 0, 3), dtype=np.float32), np.empty((0,), dtype=np.int64)
    x = np.stack([s[0] for s in samples], axis=0)
    y = np.array([s[1] for s in samples], dtype=np.int64)
    return x, y
