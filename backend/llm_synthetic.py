import json
import math
import random
import logging
from typing import Optional
from llm_service import generate_json_list

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a sensor data generator for a road monitoring system.
Generate realistic accelerometer data simulating smartphone sensors in vehicles.
The accelerometer data is a time series of {x, y, z} readings in m/s^2.
Gravity is approximately 9.81 on the z-axis when phone is flat.
Vehicle vibrations add 0.5-2.0 m/s^2 noise baseline."""


async def generate_samples(label: str, count: int = 5, window_size: int = 32,
                           context: dict = None) -> Optional[list]:
    prompt = f"""Generate {count} realistic accelerometer samples for label "{label}".
Window size: {window_size} readings.
Context: {json.dumps(context or {}, indent=2)}

Each sample must have:
- "accelerometer_data": array of {window_size} objects with x, y, z
- "label": "{label}"
- "latitude", "longitude": realistic GPS coordinates
- "speed_kmh": realistic vehicle speed
- "quality": 0.0-1.0

Label-specific patterns:
- pothole: sharp negative z-spike (-20 to -40), quick recovery, speed 30-80 km/h
- speed_bump: smooth hump (z goes +15 to +25 then -15 to -25), speed 10-30 km/h
- bump: sharp positive z-spike (+15 to +30), speed 20-60 km/h
- braking: gradual deceleration (z negative 10-20 for several readings), speed decreasing
- vibration: continuous oscillation (z ±2-5, regular), speed 40-100 km/h
- wave: sinusoidal z pattern (±10-15, period 4-8 readings), speed 20-60 km/h

Return JSON array of {count} samples."""
    return await generate_json_list(prompt, system=SYSTEM_PROMPT)


async def generate_balanced_dataset(db, db_name: str, collection: str,
                                     target_per_label: int = 500) -> Optional[dict]:
    pipeline = [
        {"$group": {"_id": "$label", "count": {"$sum": 1}}},
    ]
    cursor = db[collection].aggregate(pipeline)
    counts = {doc["_id"]: doc["count"] for doc in await cursor.to_list(length=20)}

    target_labels = ["pothole", "speed_bump", "bump", "braking", "vibration"]
    deficit = {}
    for label in target_labels:
        current = counts.get(label, 0)
        if current < target_per_label:
            deficit[label] = target_per_label - current

    if not deficit:
        return {"status": "balanced", "counts": counts, "deficit": {}}

    generated = {}
    for label, needed in deficit.items():
        batch_size = min(50, needed)
        samples = await generate_samples(label, count=batch_size, context={"target_total": needed})
        if samples:
            generated[label] = len(samples)
            for s in samples:
                s["synthetic"] = True
                s["synthetic_provider"] = "ollama"

    total_generated = sum(generated.values())
    return {
        "status": "partial",
        "current_counts": counts,
        "deficit": deficit,
        "generated": generated,
        "total_generated": total_generated,
    }


async def augment_sample(sample: dict, variation_type: str = "noise") -> Optional[dict]:
    prompt = f"""Given this accelerometer sample:
{json.dumps(sample, indent=2)}

Generate an augmented version with "{variation_type}" augmentation:
- noise: add Gaussian noise (std=0.5-2.0)
- time_shift: shift the signal by 1-4 readings
- amplitude_scale: scale amplitude by 0.8-1.2
- rotation: rotate coordinate frame slightly

Return the augmented sample as JSON with the same structure."""
    return await generate_json_list(prompt, system=SYSTEM_PROMPT)
