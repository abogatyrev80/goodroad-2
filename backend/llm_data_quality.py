import logging
from typing import Optional
from llm_service import generate_json, generate

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a data quality analyst for a road monitoring system.
The system collects accelerometer data from smartphones mounted in vehicles.
Data fields: accelerometer_data (x, y, z), latitude, longitude, timestamp, device_id.
Labels: pothole, speed_bump, bump, braking, vibration, wave.
Analyze data for quality issues: label noise, sensor errors, statistical outliers, geographic anomalies."""


async def analyze_batch(samples: list, stats: dict = None) -> Optional[dict]:
    prompt = f"""Analyze this batch of road sensor data for quality issues.

Samples ({len(samples)} shown):
{samples[:10]}

Batch statistics:
{stats or 'Not provided'}

Check for:
1. Label noise — mislabeled or suspicious samples
2. Sensor errors — impossible values (e.g., |accel| > 100g, GPS jumps)
3. Statistical outliers — unusual distributions
4. Geographic anomalies — impossible speeds between detections
5. Class imbalance — severe imbalance needing attention

Return JSON:
{{
  "quality_score": 0-100,
  "issues": [
    {{"type": "label_noise|sensor_error|outlier|geographic|imbalance", "severity": "high|medium|low", "description": "...", "affected_samples": [indices]}}
  ],
  "recommendations": ["..."],
  "summary": "..."
}}"""
    return await generate_json(prompt, system=SYSTEM_PROMPT)


async def analyze_label_quality(samples: list, labels: list) -> Optional[dict]:
    prompt = f"""Analyze label quality for these road sensor samples.
Each sample has accelerometer readings and a label.

{len(samples)} samples with labels: {labels[:50]}

For each label category, assess:
- Internal consistency (do samples with same label look similar?)
- Inter-class separability (do different labels look different?)
- Boundary cases (samples near decision boundaries)
- Noise (samples that clearly don't belong to their label)

Return JSON:
{{
  "label_quality": {{
    "label_name": {{"consistency": 0-100, "boundary_cases": [indices], "mislabel_suspects": [indices]}}
  }},
  "overall_consistency": 0-100,
  "worst_labels": ["label1", "label2"],
  "improvement_suggestions": ["..."]
}}"""
    return await generate_json(prompt, system=SYSTEM_PROMPT)


async def analyze_dataset_overview(db, db_name: str, collection: str) -> Optional[dict]:
    pipeline = [
        {"$group": {"_id": "$label", "count": {"$sum": 1},
                     "avg_accel": {"$avg": "$acceleration_magnitude"},
                     "min_accel": {"$min": "$acceleration_magnitude"},
                     "max_accel": {"$max": "$acceleration_magnitude"}}},
        {"$sort": {"count": -1}},
    ]
    cursor = db[collection].aggregate(pipeline)
    labels = await cursor.to_list(length=20)

    pipeline2 = [
        {"$group": {"_id": None,
                     "total": {"$sum": 1},
                     "devices": {"$addToSet": "$device_id"},
                     "avg_points": {"$avg": {"$size": "$accelerometer_data"}}}},
    ]
    cursor2 = db[collection].aggregate(pipeline2)
    overview = await cursor2.to_list(length=1)

    stats = overview[0] if overview else {}
    stats["total_samples"] = stats.get("total", 0)
    stats["unique_devices"] = len(stats.get("devices", []))
    stats["avg_points_per_sample"] = round(stats.get("avg_points", 0), 1)
    stats.pop("devices", None)
    stats.pop("total", None)

    prompt = f"""Analyze this road sensor dataset overview.

Label distribution: {labels}
Overall stats: {stats}

Provide:
1. Dataset quality assessment
2. Label balance analysis
3. Data completeness check
4. Recommendations for improvement

Return JSON:
{{
  "quality_score": 0-100,
  "label_balance": {{"status": "good|fair|poor", "details": "..."}},
  "completeness": {{"status": "good|fair|poor", "details": "..."}},
  "recommendations": ["..."],
  "summary": "..."
}}"""
    return await generate_json(prompt, system=SYSTEM_PROMPT)
