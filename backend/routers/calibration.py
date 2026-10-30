# -*- coding: utf-8 -*-
"""
Эндпоинты калибровки сенсоров (вынесены из server.py, декомпозиция).

Роутер монтируется с префиксом /api — внешние пути /api/calibration/* не меняются.
"""
import logging
import math
import statistics
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from config import db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


class CalibrationData(BaseModel):
    deviceId: str
    accelerometerData: List[Dict[str, float]]  # [{x, y, z, timestamp}]
    speed: float
    roadType: Optional[str] = "unknown"  # urban, highway, unpaved


class CalibrationProfile(BaseModel):
    deviceId: str
    baseline: Dict[str, float]  # mean values for x, y, z
    thresholds: Dict[str, float]  # detection thresholds
    std_dev: Dict[str, float]  # standard deviations
    sample_count: int
    last_updated: datetime
    road_type: str


@router.post("/calibration/submit")
async def submit_calibration_data(calibration: CalibrationData):
    """
    Submit calibration data for statistical analysis and adaptive threshold calculation
    """
    try:
        if len(calibration.accelerometerData) < 10:
            raise HTTPException(status_code=400, detail="Need at least 10 data points for calibration")
        
        # Extract accelerometer values
        x_values = [d['x'] for d in calibration.accelerometerData]
        y_values = [d['y'] for d in calibration.accelerometerData]
        z_values = [d['z'] for d in calibration.accelerometerData]
        
        # Calculate statistical metrics
        baseline = {
            'x': statistics.mean(x_values),
            'y': statistics.mean(y_values),
            'z': statistics.mean(z_values)
        }
        
        std_dev = {
            'x': statistics.stdev(x_values) if len(x_values) > 1 else 0,
            'y': statistics.stdev(y_values) if len(y_values) > 1 else 0,
            'z': statistics.stdev(z_values) if len(z_values) > 1 else 0
        }
        
        # Calculate adaptive thresholds (mean + 2*std for anomaly detection)
        thresholds = {
            'x_max': baseline['x'] + 2 * std_dev['x'],
            'x_min': baseline['x'] - 2 * std_dev['x'],
            'y_max': baseline['y'] + 2 * std_dev['y'],
            'y_min': baseline['y'] - 2 * std_dev['y'],
            'z_max': baseline['z'] + 2 * std_dev['z'],
            'z_min': baseline['z'] - 2 * std_dev['z'],
            # Threshold for total acceleration change
            'total_deviation': 2 * math.sqrt(std_dev['x']**2 + std_dev['y']**2 + std_dev['z']**2)
        }
        
        # Check if profile exists
        existing_profile = await db.calibration_profiles.find_one({"deviceId": calibration.deviceId})
        
        if existing_profile:
            # Update existing profile with weighted average (70% old, 30% new)
            old_count = existing_profile.get('sample_count', 0)
            new_count = len(calibration.accelerometerData)
            total_count = old_count + new_count
            
            weight_old = old_count / total_count if total_count > 0 else 0
            weight_new = new_count / total_count if total_count > 0 else 1
            
            # Weighted average for baseline
            updated_baseline = {
                'x': existing_profile['baseline']['x'] * weight_old + baseline['x'] * weight_new,
                'y': existing_profile['baseline']['y'] * weight_old + baseline['y'] * weight_new,
                'z': existing_profile['baseline']['z'] * weight_old + baseline['z'] * weight_new
            }
            
            # Weighted average for std_dev
            updated_std = {
                'x': existing_profile['std_dev']['x'] * weight_old + std_dev['x'] * weight_new,
                'y': existing_profile['std_dev']['y'] * weight_old + std_dev['y'] * weight_new,
                'z': existing_profile['std_dev']['z'] * weight_old + std_dev['z'] * weight_new
            }
            
            # Recalculate thresholds
            updated_thresholds = {
                'x_max': updated_baseline['x'] + 2 * updated_std['x'],
                'x_min': updated_baseline['x'] - 2 * updated_std['x'],
                'y_max': updated_baseline['y'] + 2 * updated_std['y'],
                'y_min': updated_baseline['y'] - 2 * updated_std['y'],
                'z_max': updated_baseline['z'] + 2 * updated_std['z'],
                'z_min': updated_baseline['z'] - 2 * updated_std['z'],
                'total_deviation': 2 * math.sqrt(updated_std['x']**2 + updated_std['y']**2 + updated_std['z']**2)
            }
            
            # Update document
            await db.calibration_profiles.update_one(
                {"deviceId": calibration.deviceId},
                {"$set": {
                    "baseline": updated_baseline,
                    "thresholds": updated_thresholds,
                    "std_dev": updated_std,
                    "sample_count": total_count,
                    "last_updated": datetime.now(),
                    "road_type": calibration.roadType
                }}
            )
            
            return {
                "message": "Calibration profile updated",
                "deviceId": calibration.deviceId,
                "baseline": updated_baseline,
                "thresholds": updated_thresholds,
                "std_dev": updated_std,
                "sample_count": total_count,
                "update_type": "adaptive"
            }
        else:
            # Create new profile
            profile = {
                "deviceId": calibration.deviceId,
                "baseline": baseline,
                "thresholds": thresholds,
                "std_dev": std_dev,
                "sample_count": len(calibration.accelerometerData),
                "last_updated": datetime.now(),
                "road_type": calibration.roadType,
                "created_at": datetime.now()
            }
            
            await db.calibration_profiles.insert_one(profile)
            
            return {
                "message": "Calibration profile created",
                "deviceId": calibration.deviceId,
                "baseline": baseline,
                "thresholds": thresholds,
                "std_dev": std_dev,
                "sample_count": len(calibration.accelerometerData),
                "update_type": "new"
            }
            
    except Exception as e:
        logging.error(f"Error processing calibration data: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error processing calibration: {str(e)}")

@router.get("/calibration/profile/{device_id}")
async def get_calibration_profile(device_id: str):
    """
    Get calibration profile for a specific device
    """
    try:
        profile = await db.calibration_profiles.find_one({"deviceId": device_id})
        
        if not profile:
            # Return default thresholds if no profile exists
            return {
                "deviceId": device_id,
                "has_profile": False,
                "message": "No calibration profile found. Using default thresholds.",
                "default_thresholds": {
                    "total_deviation": 2.0,  # Default threshold
                    "x_max": 2.0,
                    "x_min": -2.0,
                    "y_max": 2.0,
                    "y_min": -2.0,
                    "z_max": 12.0,  # Adjusted for gravity
                    "z_min": 8.0
                }
            }
        
        # Convert ObjectId to string
        profile['_id'] = str(profile['_id'])
        profile['has_profile'] = True
        
        return profile
        
    except Exception as e:
        logging.error(f"Error getting calibration profile: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error getting calibration profile: {str(e)}")

@router.delete("/calibration/profile/{device_id}")
async def reset_calibration_profile(device_id: str):
    """
    Reset/delete calibration profile for a device (forces recalibration)
    """
    try:
        result = await db.calibration_profiles.delete_one({"deviceId": device_id})
        
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Calibration profile not found")
        
        return {
            "message": "Calibration profile reset successfully",
            "deviceId": device_id,
            "note": "Device will use default thresholds until recalibrated"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error resetting calibration profile: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error resetting calibration: {str(e)}")

@router.get("/calibration/stats")
async def get_calibration_stats():
    """
    Get statistics about calibrated devices
    """
    try:
        total_profiles = await db.calibration_profiles.count_documents({})
        
        # Get profiles with most samples
        top_profiles = await db.calibration_profiles.find({}) \
            .sort("sample_count", -1) \
            .limit(10) \
            .to_list(10)
        
        profiles_summary = []
        for profile in top_profiles:
            profiles_summary.append({
                "deviceId": profile['deviceId'],
                "sample_count": profile['sample_count'],
                "road_type": profile.get('road_type', 'unknown'),
                "last_updated": profile['last_updated'].isoformat()
            })
        
        return {
            "total_calibrated_devices": total_profiles,
            "top_calibrated_devices": profiles_summary
        }
        
    except Exception as e:
        logging.error(f"Error getting calibration stats: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error getting calibration stats: {str(e)}")

# ==============================================================================
# DATA INGESTION — приём сырых данных с мобильного приложения
# ==============================================================================

