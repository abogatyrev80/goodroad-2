import math
import statistics
from typing import Dict, List, Optional


def validate_gps_coords(lat: Optional[float], lon: Optional[float]) -> bool:
    if lat is None or lon is None:
        return False
    if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
        return False
    if lat == 0.0 and lon == 0.0:
        return False
    return True


def calculate_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371000
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)
    a = (math.sin(delta_lat / 2) ** 2 +
         math.cos(lat1_rad) * math.cos(lat2_rad) *
         math.sin(delta_lon / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def analyze_accelerometer_data(accel_data: List[Dict]) -> Dict[str, float]:
    if len(accel_data) < 5:
        return {"variance": 0, "spikes": 0, "condition_score": 50}
    total_accelerations = []
    for point in accel_data:
        if 'totalAcceleration' in point['data']:
            total_accelerations.append(point['data']['totalAcceleration'])
        else:
            x, y, z = point['data']['x'], point['data']['y'], point['data']['z']
            total_acc = math.sqrt(x**2 + y**2 + z**2)
            total_accelerations.append(total_acc)
    if len(total_accelerations) < 2:
        return {"variance": 0, "spikes": 0, "condition_score": 50}
    variance = statistics.variance(total_accelerations)
    mean_acc = statistics.mean(total_accelerations)
    threshold = mean_acc + 2 * math.sqrt(variance)
    spikes = sum(1 for acc in total_accelerations if acc > threshold)
    base_score = 100
    variance_penalty = min(50, variance * 1000)
    spike_penalty = min(30, spikes * 5)
    condition_score = max(0, base_score - variance_penalty - spike_penalty)
    return {
        "variance": variance,
        "spikes": spikes,
        "condition_score": condition_score,
        "mean_acceleration": mean_acc
    }


def determine_severity_level(score: float) -> str:
    if score >= 80:
        return "excellent"
    elif score >= 60:
        return "good"
    elif score >= 40:
        return "fair"
    elif score >= 20:
        return "poor"
    else:
        return "very_poor"


def detect_road_issues(analysis: Dict[str, float]) -> List[Dict]:
    warnings = []
    if analysis["spikes"] >= 3:
        warnings.append({
            "warning_type": "pothole",
            "severity": "high" if analysis["spikes"] >= 5 else "medium",
            "confidence": min(0.9, analysis["spikes"] / 10)
        })
    if analysis["variance"] > 0.5:
        warnings.append({
            "warning_type": "rough_road",
            "severity": "high" if analysis["variance"] > 1.0 else "medium",
            "confidence": min(0.8, analysis["variance"])
        })
    return warnings
