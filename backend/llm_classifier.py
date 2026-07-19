import json
import logging
from typing import Optional
from llm_service import generate_json

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a road obstacle classifier analyzing accelerometer data from smartphones.
You classify time-series accelerometer readings into road obstacle types.
Labels: pothole, speed_bump, bump, braking, vibration, wave.
Each reading has x, y, z in m/s^2. Gravity ≈ 9.81 on z-axis."""


async def classify_batch(samples: list, ml_predictions: list = None) -> Optional[dict]:
    prompt = f"""Classify these {len(samples)} accelerometer samples.

Samples:
{json.dumps(samples[:20], indent=2)}

ML model predictions (if available):
{json.dumps(ml_predictions[:20], indent=2) if ml_predictions else 'None'}

For each sample, predict:
1. label: one of [pothole, speed_bump, bump, braking, vibration, wave]
2. confidence: 0.0-1.0
3. reasoning: brief explanation

Also provide:
- overall_confidence: average confidence across all samples
- disagreements: cases where LLM disagrees with ML model
- uncertainty_samples: samples where confidence < 0.5

Return JSON:
{{
  "predictions": [
    {{"index": 0, "label": "...", "confidence": 0.0-1.0, "reasoning": "..."}}
  ],
  "overall_confidence": 0.0-1.0,
  "disagreements": [{{"index": 0, "llm_label": "...", "ml_label": "...", "reasoning": "..."}}],
  "uncertainty_samples": [{{"index": 0, "reasoning": "..."}}],
  "summary": "..."
}}"""
    return await generate_json(prompt, system=SYSTEM_PROMPT)


async def classify_single(sample: dict) -> Optional[dict]:
    prompt = f"""Classify this accelerometer sample:
{json.dumps(sample, indent=2)}

Predict the label and confidence.
Return JSON:
{{
  "label": "pothole|speed_bump|bump|braking|vibration|wave",
  "confidence": 0.0-1.0,
  "reasoning": "...",
  "features_used": ["feature1", "feature2"]
}}"""
    return await generate_json(prompt, system=SYSTEM_PROMPT)


async def validate_classification(sample: dict, claimed_label: str) -> Optional[dict]:
    prompt = f"""Validate whether this sample is correctly labeled as "{claimed_label}":
{json.dumps(sample, indent=2)}

Analyze:
1. Does the signal pattern match the claimed label?
2. Are there signs of misclassification?
3. What label would you assign?
4. Confidence in your assessment?

Return JSON:
{{
  "is_correct": true/false,
  "confidence": 0.0-1.0,
  "suggested_label": "...",
  "reasoning": "...",
  "key_features": ["feature1", "feature2"]
}}"""
    return await generate_json(prompt, system=SYSTEM_PROMPT)


async def explain_classification(sample: dict, label: str) -> Optional[str]:
    prompt = f"""Explain why this sample is classified as "{label}":
{json.dumps(sample, indent=2)}

Provide a clear explanation of the signal features that support this classification.
Keep it under 100 words."""
    from llm_service import generate
    return await generate(prompt, system=SYSTEM_PROMPT, temperature=0.2, max_tokens=200)
