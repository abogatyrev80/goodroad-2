import json
import logging
from typing import Optional
from llm_service import generate, generate_json

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a road condition analyst writing reports for city road maintenance departments.
You analyze sensor data from mobile phones to assess road quality.
Road quality categories: excellent, good, fair, poor, very_poor.
Severity levels: critical (immediate danger), high (needs repair soon), medium (monitor), low (cosmetic)."""


async def generate_road_report(clusters: list, events: list = None,
                                region: str = None) -> Optional[str]:
    prompt = f"""Generate a road condition report based on detected obstacles.

Region: {region or 'Unknown'}
Detected clusters: {len(clusters)}
Events analyzed: {len(events) if events else 0}

Cluster summary:
{json.dumps(clusters[:20], indent=2)}

Generate a professional road condition report including:
1. Executive summary
2. Road quality assessment by type
3. Priority repairs (critical/high severity)
4. Trend analysis
5. Recommendations

Write in Russian. Format as a structured report with clear sections.
Keep it concise (300-500 words)."""
    return await generate(prompt, system=SYSTEM_PROMPT, temperature=0.4, max_tokens=1024)


async def generate_road_report_json(clusters: list, events: list = None,
                                     region: str = None) -> Optional[dict]:
    prompt = f"""Analyze road conditions from detected obstacles and return structured data.

Region: {region or 'Unknown'}
Clusters: {len(clusters)}
Events: {len(events) if events else 0}

Cluster data:
{json.dumps(clusters[:30], indent=2)}

Return JSON:
{{
  "region": "...",
  "overall_quality": "excellent|good|fair|poor|very_poor",
  "quality_score": 0-100,
  "by_type": {{
    "pothole": {{"count": N, "avg_severity": "...", "quality_impact": 0-100}},
    "speed_bump": {{"count": N, "avg_severity": "...", "quality_impact": 0-100}}
  }},
  "priority_repairs": [
    {{"type": "...", "severity": "...", "location": {{}}, "description": "..."}}
  ],
  "statistics": {{
    "total_obstacles": N,
    "critical_count": N,
    "high_count": N,
    "medium_count": N,
    "low_count": N
  }},
  "recommendations": ["..."],
  "summary": "..."
}}"""
    return await generate_json(prompt, system=SYSTEM_PROMPT)


async def generate_maintenance_plan(road_report: dict, budget: float = None) -> Optional[dict]:
    prompt = f"""Based on this road condition report, generate a maintenance plan.

Report:
{json.dumps(road_report, indent=2)}

Budget: {f'{budget} RUB' if budget else 'Flexible'}

Create a prioritized maintenance plan:
1. Immediate repairs (safety-critical)
2. Short-term repairs (next 3 months)
3. Medium-term improvements (next year)
4. Monitoring recommendations

Return JSON:
{{
  "plan": {{
    "immediate": [{{"action": "...", "priority": "critical|high", "est_cost": N, "timeline": "..."}}],
    "short_term": [{{"action": "...", "priority": "medium", "est_cost": N, "timeline": "..."}}],
    "medium_term": [{{"action": "...", "priority": "low", "est_cost": N, "timeline": "..."}}],
  }},
  "total_estimated_cost": N,
  "monitoring_recommendations": ["..."],
  "next_assessment_date": "..."
}}"""
    return await generate_json(prompt, system=SYSTEM_PROMPT)


async def compare_periods(report_current: dict, report_previous: dict) -> Optional[dict]:
    prompt = f"""Compare road conditions between two periods.

Previous report:
{json.dumps(report_previous, indent=2)}

Current report:
{json.dumps(report_current, indent=2)}

Analyze:
1. Overall quality change
2. New obstacles appeared
3. Resolved obstacles
4. Trends by severity
5. Recommendations

Return JSON:
{{
  "quality_change": "improved|stable|degraded",
  "quality_delta": 0-100,
  "new_obstacles": N,
  "resolved_obstacles": N,
  "severity_trends": {{"critical": "...", "high": "...", "medium": "...", "low": "..."}},
  "recommendations": ["..."],
  "summary": "..."
}}"""
    return await generate_json(prompt, system=SYSTEM_PROMPT)
