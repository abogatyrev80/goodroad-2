from fastapi import FastAPI, APIRouter, HTTPException, Query, UploadFile, File
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.requests import Request
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
import uuid
from datetime import datetime, timedelta
import asyncio
import math
import statistics
import csv
import io


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection with fallback for production
mongo_url = os.environ.get('MONGO_URL') or os.environ.get('MONGODB_URI', 'mongodb://localhost:27017')
db_name = os.environ.get('DB_NAME') or os.environ.get('MONGODB_DB_NAME', 'good_road_db')

# Create MongoDB client
client = AsyncIOMotorClient(mongo_url)
db = client[db_name]

# Log connection info (without sensitive data)
print(f"Connecting to MongoDB database: {db_name}")
print(f"MongoDB URL pattern: {mongo_url.split('@')[-1] if '@' in mongo_url else 'localhost'}")

# Setup Jinja2 templates
templates = Jinja2Templates(directory=str(ROOT_DIR / "templates"))

# Create the main app without a prefix
app = FastAPI(title="Good Road API", description="Smart Road Monitoring System")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# Data Models
class SensorDataPoint(BaseModel):
    type: str  # 'location' or 'accelerometer'
    timestamp: int
    data: Dict[str, Any]

class SensorDataBatch(BaseModel):
    deviceId: str
    sensorData: List[SensorDataPoint]

class RoadCondition(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    latitude: float
    longitude: float
    condition_score: float  # 0-100, higher = better road
    severity_level: str  # 'excellent', 'good', 'fair', 'poor', 'very_poor'
    data_points: int
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class RoadWarning(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    latitude: float
    longitude: float
    warning_type: str  # 'pothole', 'rough_road', 'speed_bump', 'construction'
    severity: str  # 'low', 'medium', 'high'
    confidence: float  # 0-1
    created_at: datetime = Field(default_factory=datetime.utcnow)

class LocationQuery(BaseModel):
    latitude: float
    longitude: float
    radius: float = 1000  # meters


# Helper Functions
def calculate_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance between two coordinates using Haversine formula"""
    R = 6371000  # Earth's radius in meters
    
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
    """Analyze accelerometer data to detect road conditions"""
    if len(accel_data) < 5:
        return {"variance": 0, "spikes": 0, "condition_score": 50}
    
    # Extract total acceleration values
    total_accelerations = []
    for point in accel_data:
        if 'totalAcceleration' in point['data']:
            total_accelerations.append(point['data']['totalAcceleration'])
        else:
            # Calculate if not provided
            x, y, z = point['data']['x'], point['data']['y'], point['data']['z']
            total_acc = math.sqrt(x**2 + y**2 + z**2)
            total_accelerations.append(total_acc)
    
    if len(total_accelerations) < 2:
        return {"variance": 0, "spikes": 0, "condition_score": 50}
    
    # Calculate variance (road roughness indicator)
    variance = statistics.variance(total_accelerations)
    
    # Count acceleration spikes (potential potholes/bumps)
    mean_acc = statistics.mean(total_accelerations)
    threshold = mean_acc + 2 * math.sqrt(variance)
    spikes = sum(1 for acc in total_accelerations if acc > threshold)
    
    # Calculate condition score (0-100, higher = better)
    # Lower variance and fewer spikes = better road
    base_score = 100
    variance_penalty = min(50, variance * 1000)  # Scale variance
    spike_penalty = min(30, spikes * 5)  # Penalize spikes
    
    condition_score = max(0, base_score - variance_penalty - spike_penalty)
    
    return {
        "variance": variance,
        "spikes": spikes,
        "condition_score": condition_score,
        "mean_acceleration": mean_acc
    }

def determine_severity_level(score: float) -> str:
    """Convert numeric score to severity level"""
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

def detect_road_issues(analysis: Dict[str, float]) -> List[RoadWarning]:
    """Detect specific road issues from analysis"""
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


# API Endpoints
@api_router.get("/")
async def root():
    return {"message": "Good Road API - Smart Road Monitoring System"}

@api_router.post("/sensor-data")
async def upload_sensor_data(batch: SensorDataBatch):
    """Upload batch of sensor data from mobile device"""
    try:
        # Separate location and accelerometer data
        location_data = [point for point in batch.sensorData if point.type == "location"]
        accel_data = [point for point in batch.sensorData if point.type == "accelerometer"]
        
        # Store raw sensor data
        sensor_doc = {
            "deviceId": batch.deviceId,
            "timestamp": datetime.utcnow(),
            "locationPoints": len(location_data),
            "accelerometerPoints": len(accel_data),
            "rawData": [point.dict() for point in batch.sensorData]
        }
        
        await db.sensor_data.insert_one(sensor_doc)
        
        # Process data for road condition analysis
        processed_conditions = []
        processed_warnings = []
        
        if location_data and accel_data:
            # Group accelerometer data by location (simplified approach)
            for location_point in location_data:
                lat = location_point.data.get("latitude")
                lon = location_point.data.get("longitude")
                timestamp = location_point.timestamp
                
                # Find nearby accelerometer readings (within 30 seconds)
                nearby_accel = [
                    point for point in accel_data
                    if abs(point.timestamp - timestamp) <= 30000  # 30 seconds
                ]
                
                if len(nearby_accel) >= 5:  # Need minimum data points
                    # Convert SensorDataPoint objects to dictionaries for analysis
                    accel_dicts = [point.dict() for point in nearby_accel]
                    analysis = analyze_accelerometer_data(accel_dicts)
                    
                    # Create road condition record
                    condition = {
                        "id": str(uuid.uuid4()),
                        "latitude": lat,
                        "longitude": lon,
                        "condition_score": analysis["condition_score"],
                        "severity_level": determine_severity_level(analysis["condition_score"]),
                        "data_points": len(nearby_accel),
                        "analysis_data": analysis,
                        "created_at": datetime.utcnow(),
                        "updated_at": datetime.utcnow()
                    }
                    processed_conditions.append(condition)
                    
                    # Detect warnings
                    warnings = detect_road_issues(analysis)
                    for warning in warnings:
                        warning_doc = {
                            "id": str(uuid.uuid4()),
                            "latitude": lat,
                            "longitude": lon,
                            "created_at": datetime.utcnow(),
                            **warning
                        }
                        processed_warnings.append(warning_doc)
        
        # Store processed data
        if processed_conditions:
            await db.road_conditions.insert_many(processed_conditions)
        
        if processed_warnings:
            await db.road_warnings.insert_many(processed_warnings)
        
        return {
            "message": "Sensor data processed successfully",
            "rawDataPoints": len(batch.sensorData),
            "conditionsProcessed": len(processed_conditions),
            "warningsGenerated": len(processed_warnings)
        }
        
    except Exception as e:
        logging.error(f"Error processing sensor data: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error processing sensor data: {str(e)}")

@api_router.get("/road-conditions")
async def get_road_conditions(
    latitude: float,
    longitude: float,
    radius: float = 1000
):
    """Get road conditions near a specific location"""
    try:
        # MongoDB geospatial query would be better, but using simple distance calculation
        conditions = await db.road_conditions.find({}, {"_id": 0}).to_list(1000)
        
        nearby_conditions = []
        for condition in conditions:
            distance = calculate_distance(
                latitude, longitude,
                condition["latitude"], condition["longitude"]
            )
            
            if distance <= radius:
                condition["distance"] = distance
                nearby_conditions.append(condition)
        
        # Sort by distance
        nearby_conditions.sort(key=lambda x: x["distance"])
        
        return {
            "location": {"latitude": latitude, "longitude": longitude},
            "radius": radius,
            "conditions": nearby_conditions[:50]  # Limit to 50 results
        }
        
    except Exception as e:
        logging.error(f"Error fetching road conditions: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error fetching road conditions: {str(e)}")

@api_router.get("/warnings")
async def get_road_warnings(
    latitude: float,
    longitude: float,
    radius: float = 1000
):
    """Get road warnings near a specific location"""
    try:
        # Get recent warnings (last 7 days)
        cutoff_date = datetime.utcnow() - timedelta(days=7)
        
        warnings = await db.road_warnings.find({
            "created_at": {"$gte": cutoff_date}
        }, {"_id": 0}).to_list(1000)
        
        nearby_warnings = []
        for warning in warnings:
            distance = calculate_distance(
                latitude, longitude,
                warning["latitude"], warning["longitude"]
            )
            
            if distance <= radius:
                warning["distance"] = distance
                nearby_warnings.append(warning)
        
        # Sort by severity and distance
        severity_order = {"high": 3, "medium": 2, "low": 1}
        nearby_warnings.sort(key=lambda x: (severity_order.get(x["severity"], 0), -x["distance"]), reverse=True)
        
        return {
            "location": {"latitude": latitude, "longitude": longitude},
            "radius": radius,
            "warnings": nearby_warnings[:20]  # Limit to 20 warnings
        }
        
    except Exception as e:
        logging.error(f"Error fetching road warnings: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error fetching road warnings: {str(e)}")

# Administrative data models
class AdminSensorDataUpdate(BaseModel):
    hazard_type: Optional[str] = None
    severity: Optional[str] = None
    is_verified: Optional[bool] = None
    admin_notes: Optional[str] = None

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

class AdminAnalytics(BaseModel):
    total_points: int
    verified_points: int
    hazard_points: int
    avg_road_quality: float
    date_range: str

@api_router.get("/admin/sensor-data")
async def get_all_sensor_data(
    limit: int = Query(1000, description="Maximum number of records to return"),
    skip: int = Query(0, description="Number of records to skip"),
    date_from: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
):
    """
    Get all sensor data for administrative analysis
    """
    try:
        # Build query filters
        query = {}
        
        if date_from or date_to:
            date_filter = {}
            if date_from:
                date_filter["$gte"] = datetime.fromisoformat(date_from)
            if date_to:
                date_filter["$lte"] = datetime.fromisoformat(date_to + "T23:59:59")
            query["timestamp"] = date_filter
        
        # Get total count for pagination
        total_count = await db.sensor_data.count_documents(query)
        
        # Get data with sorting (most recent first)
        cursor = db.sensor_data.find(query).sort("timestamp", -1).skip(skip).limit(limit)
        
        data = []
        async for document in cursor:
            # Extract GPS data from rawData array
            latitude = 0
            longitude = 0
            speed = 0
            accuracy = 0
            accelerometer = {"x": 0, "y": 0, "z": 0}
            
            raw_data = document.get("rawData", [])
            for item in raw_data:
                if item.get("type") == "location" and "data" in item:
                    location_data = item["data"]
                    latitude = location_data.get("latitude", 0)
                    longitude = location_data.get("longitude", 0)
                    speed = location_data.get("speed", 0)
                    accuracy = location_data.get("accuracy", 0)
                elif item.get("type") == "accelerometer" and "data" in item:
                    accel_data = item["data"]
                    accelerometer = {
                        "x": accel_data.get("x", 0),
                        "y": accel_data.get("y", 0),
                        "z": accel_data.get("z", 0)
                    }
            
            # Convert ObjectId to string and format data
            doc_dict = {
                "_id": str(document["_id"]),
                "deviceId": document.get("deviceId", "unknown"),
                "latitude": latitude,
                "longitude": longitude,
                "timestamp": document.get("timestamp", datetime.now()).isoformat(),
                "speed": speed,
                "accuracy": accuracy,
                "accelerometer": accelerometer,
                "road_quality_score": document.get("road_quality_score", 50),
                "hazard_type": document.get("hazard_type"),
                "severity": document.get("severity", "medium"),
                "is_verified": document.get("is_verified", False),
                "admin_notes": document.get("admin_notes", "")
            }
            data.append(doc_dict)
        
        return {
            "data": data,
            "total": total_count,
            "limit": limit,
            "skip": skip,
            "returned": len(data)
        }
        
    except Exception as e:
        logging.error(f"Error getting admin sensor data: {e}")
        raise HTTPException(status_code=500, detail=f"Error retrieving admin data: {str(e)}")

@api_router.patch("/admin/sensor-data/{point_id}")
async def update_sensor_data_classification(
    point_id: str,
    updates: AdminSensorDataUpdate
):
    """
    Update sensor data point classification by administrator
    """
    try:
        from bson import ObjectId
        
        # Convert string ID to ObjectId
        try:
            object_id = ObjectId(point_id)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid point ID format")
        
        # Build update document
        update_doc = {}
        if updates.hazard_type is not None:
            update_doc["hazard_type"] = updates.hazard_type
        if updates.severity is not None:
            update_doc["severity"] = updates.severity
        if updates.is_verified is not None:
            update_doc["is_verified"] = updates.is_verified
        if updates.admin_notes is not None:
            update_doc["admin_notes"] = updates.admin_notes
        
        # Add admin timestamp
        update_doc["admin_updated_at"] = datetime.now()
        
        # Update the document
        result = await db.sensor_data.update_one(
            {"_id": object_id},
            {"$set": update_doc}
        )
        
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Sensor data point not found")
        
        return {
            "message": "Sensor data point updated successfully",
            "updated_fields": list(update_doc.keys()),
            "point_id": point_id
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error updating sensor data point {point_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error updating data point: {str(e)}")

@api_router.get("/admin/analytics")
async def get_admin_analytics():
    """
    Get analytics data for administrative dashboard
    """
    try:
        # Basic statistics
        total_points = await db.sensor_data.count_documents({})
        verified_points = await db.sensor_data.count_documents({"is_verified": True})
        hazard_points = await db.sensor_data.count_documents({"hazard_type": {"$ne": None}})
        
        # Calculate average road quality
        pipeline = [
            {"$match": {"road_quality_score": {"$exists": True}}},
            {"$group": {
                "_id": None,
                "avg_quality": {"$avg": "$road_quality_score"},
                "min_quality": {"$min": "$road_quality_score"},
                "max_quality": {"$max": "$road_quality_score"}
            }}
        ]
        
        quality_stats = []
        async for result in db.sensor_data.aggregate(pipeline):
            quality_stats.append(result)
        
        avg_road_quality = quality_stats[0]["avg_quality"] if quality_stats else 0
        
        # Recent activity (last 7 days)
        week_ago = datetime.now() - timedelta(days=7)
        recent_points = await db.sensor_data.count_documents({
            "timestamp": {"$gte": week_ago}
        })
        
        # Hazard types distribution
        hazard_pipeline = [
            {"$match": {"hazard_type": {"$ne": None}}},
            {"$group": {
                "_id": "$hazard_type",
                "count": {"$sum": 1}
            }},
            {"$sort": {"count": -1}}
        ]
        
        hazard_distribution = []
        async for result in db.sensor_data.aggregate(hazard_pipeline):
            hazard_distribution.append({
                "hazard_type": result["_id"],
                "count": result["count"]
            })
        
        # Quality distribution by ranges
        quality_ranges = [
            {"name": "Excellent", "min": 80, "max": 100},
            {"name": "Good", "min": 60, "max": 79},
            {"name": "Fair", "min": 40, "max": 59},
            {"name": "Poor", "min": 20, "max": 39},
            {"name": "Very Poor", "min": 0, "max": 19}
        ]
        
        quality_distribution = []
        for range_info in quality_ranges:
            count = await db.sensor_data.count_documents({
                "road_quality_score": {
                    "$gte": range_info["min"],
                    "$lte": range_info["max"]
                }
            })
            quality_distribution.append({
                "range": range_info["name"],
                "min": range_info["min"],
                "max": range_info["max"],
                "count": count
            })
        
        return {
            "total_points": total_points,
            "verified_points": verified_points,
            "hazard_points": hazard_points,
            "unverified_points": total_points - verified_points,
            "avg_road_quality": round(avg_road_quality, 1) if avg_road_quality else 0,
            "recent_points_7d": recent_points,
            "hazard_distribution": hazard_distribution,
            "quality_distribution": quality_distribution,
            "quality_stats": quality_stats[0] if quality_stats else {
                "avg_quality": 0,
                "min_quality": 0,
                "max_quality": 100
            }
        }
        
    except Exception as e:
        logging.error(f"Error getting admin analytics: {e}")
        raise HTTPException(status_code=500, detail=f"Error retrieving analytics: {str(e)}")

@api_router.get("/admin/heatmap-data")
async def get_heatmap_data(
    southwest_lat: float = Query(..., description="Southwest corner latitude"),
    southwest_lng: float = Query(..., description="Southwest corner longitude"), 
    northeast_lat: float = Query(..., description="Northeast corner latitude"),
    northeast_lng: float = Query(..., description="Northeast corner longitude"),
    zoom_level: int = Query(10, description="Map zoom level for data density")
):
    """
    Get sensor data formatted for heatmap display on maps
    """
    try:
        # Determine grid size based on zoom level
        grid_size = max(0.001, 0.1 / (2 ** (zoom_level - 8)))
        
        # Build query for the bounding box
        query = {
            "latitude": {"$gte": southwest_lat, "$lte": northeast_lat},
            "longitude": {"$gte": southwest_lng, "$lte": northeast_lng}
        }
        
        # Aggregation pipeline for heatmap data
        pipeline = [
            {"$match": query},
            {
                "$group": {
                    "_id": {
                        "lat_grid": {
                            "$multiply": [
                                {"$round": {"$divide": ["$latitude", grid_size]}},
                                grid_size
                            ]
                        },
                        "lng_grid": {
                            "$multiply": [
                                {"$round": {"$divide": ["$longitude", grid_size]}},
                                grid_size
                            ]
                        }
                    },
                    "avg_quality": {"$avg": "$road_quality_score"},
                    "point_count": {"$sum": 1},
                    "hazard_count": {
                        "$sum": {
                            "$cond": [{"$ne": ["$hazard_type", None]}, 1, 0]
                        }
                    },
                    "min_quality": {"$min": "$road_quality_score"},
                    "max_quality": {"$max": "$road_quality_score"}
                }
            },
            {
                "$project": {
                    "latitude": "$_id.lat_grid",
                    "longitude": "$_id.lng_grid",
                    "avg_quality": {"$round": ["$avg_quality", 1]},
                    "point_count": 1,
                    "hazard_count": 1,
                    "quality_variance": {
                        "$subtract": ["$max_quality", "$min_quality"]
                    },
                    "intensity": {
                        "$multiply": [
                            {"$divide": [{"$subtract": [100, "$avg_quality"]}, 100]},
                            {"$min": [{"$divide": ["$point_count", 50]}, 1]}
                        ]
                    }
                }
            },
            {"$sort": {"point_count": -1}},
            {"$limit": 5000}  # Limit for performance
        ]
        
        heatmap_points = []
        async for point in db.sensor_data.aggregate(pipeline):
            heatmap_points.append({
                "lat": point["latitude"],
                "lng": point["longitude"],
                "quality": point["avg_quality"],
                "count": point["point_count"],
                "hazards": point["hazard_count"],
                "intensity": min(1.0, max(0.1, point["intensity"]))
            })
        
        return {
            "heatmap_points": heatmap_points,
            "bounds": {
                "southwest": {"lat": southwest_lat, "lng": southwest_lng},
                "northeast": {"lat": northeast_lat, "lng": northeast_lng}
            },
            "grid_size": grid_size,
            "total_points": len(heatmap_points)
        }
        
    except Exception as e:
        logging.error(f"Error getting heatmap data: {e}")
        raise HTTPException(status_code=500, detail=f"Error retrieving heatmap data: {str(e)}")

@api_router.delete("/data/cleanup")
async def cleanup_old_data():
    """Clean up old sensor data (older than 30 days)"""
    try:
        cutoff_date = datetime.utcnow() - timedelta(days=30)
        
        # Delete old sensor data
        sensor_result = await db.sensor_data.delete_many({
            "timestamp": {"$lt": cutoff_date}
        })
        
        # Delete old warnings
        warning_result = await db.road_warnings.delete_many({
            "created_at": {"$lt": cutoff_date}
        })
        
        return {
            "message": "Data cleanup completed",
            "deletedSensorBatches": sensor_result.deleted_count,
            "deletedWarnings": warning_result.deleted_count
        }
        
    except Exception as e:
        logging.error(f"Error during data cleanup: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error during data cleanup: {str(e)}")

@api_router.delete("/admin/sensor-data/{point_id}")
async def delete_sensor_data_point(point_id: str):
    """
    Delete a specific sensor data point by ID
    """
    try:
        from bson import ObjectId
        
        # Convert string ID to ObjectId
        try:
            object_id = ObjectId(point_id)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid point ID format")
        
        # Delete the document
        result = await db.sensor_data.delete_one({"_id": object_id})
        
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Sensor data point not found")
        
        return {
            "message": "Sensor data point deleted successfully",
            "point_id": point_id,
            "deleted": True
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error deleting sensor data point {point_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error deleting data point: {str(e)}")

@api_router.delete("/admin/cleanup-test-data")
async def cleanup_test_data():
    """
    Delete all test sensor data records (devices with 'test' in deviceId)
    """
    try:
        # Find all records with 'test' in deviceId (case insensitive)
        query = {
            "deviceId": {"$regex": "test", "$options": "i"}
        }
        
        # Count before deletion
        count_before = await db.sensor_data.count_documents(query)
        
        # Delete test records
        result = await db.sensor_data.delete_many(query)
        
        # Get remaining count
        remaining_count = await db.sensor_data.count_documents({})
        
        return {
            "message": "Test data cleanup completed",
            "deleted_records": result.deleted_count,
            "found_test_records": count_before,
            "remaining_records": remaining_count,
            "test_pattern": "deviceId containing 'test' (case insensitive)"
        }
        
    except Exception as e:
        logging.error(f"Error during test data cleanup: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error during test data cleanup: {str(e)}")

# === CALIBRATION ENDPOINTS ===

@api_router.post("/calibration/submit")
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

@api_router.get("/calibration/profile/{device_id}")
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

@api_router.delete("/calibration/profile/{device_id}")
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

@api_router.get("/calibration/stats")
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

# === BULK OPERATIONS MODELS ===

class BulkDeleteFilters(BaseModel):
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    lat_min: Optional[float] = None
    lat_max: Optional[float] = None
    lng_min: Optional[float] = None
    lng_max: Optional[float] = None
    accel_x_min: Optional[float] = None
    accel_x_max: Optional[float] = None
    accel_y_min: Optional[float] = None
    accel_y_max: Optional[float] = None
    accel_z_min: Optional[float] = None
    accel_z_max: Optional[float] = None
    hazard_type: Optional[str] = None
    is_verified: Optional[bool] = None

@api_router.post("/admin/sensor-data/count-by-filters")
async def count_data_by_filters(filters: BulkDeleteFilters):
    """
    Count number of records matching the given filters (preview before delete)
    """
    try:
        query = {}
        
        # Date filters
        if filters.date_from or filters.date_to:
            date_filter = {}
            if filters.date_from:
                date_filter["$gte"] = datetime.fromisoformat(filters.date_from)
            if filters.date_to:
                date_filter["$lte"] = datetime.fromisoformat(filters.date_to + "T23:59:59")
            query["timestamp"] = date_filter
        
        # GPS coordinate filters
        if filters.lat_min is not None or filters.lat_max is not None:
            lat_filter = {}
            if filters.lat_min is not None:
                lat_filter["$gte"] = filters.lat_min
            if filters.lat_max is not None:
                lat_filter["$lte"] = filters.lat_max
            # Note: We need to check rawData array for coordinates
            # This is a simplified version - in production might need aggregation
        
        # Hazard type filter
        if filters.hazard_type:
            query["hazard_type"] = filters.hazard_type
        
        # Verification status filter
        if filters.is_verified is not None:
            query["is_verified"] = filters.is_verified
        
        # Count matching records
        count = await db.sensor_data.count_documents(query)
        
        # Get sample records (first 5)
        sample = await db.sensor_data.find(query).limit(5).to_list(5)
        sample_data = []
        for doc in sample:
            sample_data.append({
                "_id": str(doc["_id"]),
                "timestamp": doc.get("timestamp", datetime.now()).isoformat(),
                "deviceId": doc.get("deviceId", "unknown")
            })
        
        return {
            "count": count,
            "filters_applied": {k: v for k, v in filters.dict().items() if v is not None},
            "sample_records": sample_data
        }
        
    except Exception as e:
        logging.error(f"Error counting data by filters: {e}")
        raise HTTPException(status_code=500, detail=f"Error counting data: {str(e)}")

@api_router.delete("/admin/sensor-data/bulk")
async def bulk_delete_sensor_data(filters: BulkDeleteFilters):
    """
    Bulk delete sensor data records matching the given filters
    """
    try:
        query = {}
        
        # Date filters
        if filters.date_from or filters.date_to:
            date_filter = {}
            if filters.date_from:
                date_filter["$gte"] = datetime.fromisoformat(filters.date_from)
            if filters.date_to:
                date_filter["$lte"] = datetime.fromisoformat(filters.date_to + "T23:59:59")
            query["timestamp"] = date_filter
        
        # Hazard type filter
        if filters.hazard_type:
            query["hazard_type"] = filters.hazard_type
        
        # Verification status filter
        if filters.is_verified is not None:
            query["is_verified"] = filters.is_verified
        
        # Count before deletion
        count_before = await db.sensor_data.count_documents(query)
        
        # Delete matching records
        result = await db.sensor_data.delete_many(query)
        
        # Get remaining count
        remaining_count = await db.sensor_data.count_documents({})
        
        return {
            "message": "Bulk deletion completed",
            "deleted_count": result.deleted_count,
            "matched_count": count_before,
            "remaining_records": remaining_count,
            "filters_applied": {k: v for k, v in filters.dict().items() if v is not None}
        }
        
    except Exception as e:
        logging.error(f"Error during bulk deletion: {e}")
        raise HTTPException(status_code=500, detail=f"Error during bulk deletion: {str(e)}")

@api_router.get("/admin/sensor-data/export/csv")
async def export_sensor_data_csv(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    limit: int = Query(10000, description="Maximum records to export")
):
    """
    Export sensor data as CSV file
    """
    try:
        # Build query
        query = {}
        if date_from or date_to:
            date_filter = {}
            if date_from:
                date_filter["$gte"] = datetime.fromisoformat(date_from)
            if date_to:
                date_filter["$lte"] = datetime.fromisoformat(date_to + "T23:59:59")
            query["timestamp"] = date_filter
        
        # Get data
        cursor = db.sensor_data.find(query).sort("timestamp", -1).limit(limit)
        
        # Create CSV in memory
        output = io.StringIO()
        csv_writer = csv.writer(output)
        
        # Write header
        csv_writer.writerow([
            'ID', 'Device ID', 'Timestamp', 'Latitude', 'Longitude', 
            'Speed', 'Accuracy', 'Accel_X', 'Accel_Y', 'Accel_Z',
            'Road Quality', 'Hazard Type', 'Severity', 'Verified', 'Admin Notes'
        ])
        
        # Write data rows
        async for document in cursor:
            # Extract data from rawData
            latitude = 0
            longitude = 0
            speed = 0
            accuracy = 0
            accelerometer = {"x": 0, "y": 0, "z": 0}
            
            raw_data = document.get("rawData", [])
            for item in raw_data:
                if item.get("type") == "location" and "data" in item:
                    location_data = item["data"]
                    latitude = location_data.get("latitude", 0)
                    longitude = location_data.get("longitude", 0)
                    speed = location_data.get("speed", 0)
                    accuracy = location_data.get("accuracy", 0)
                elif item.get("type") == "accelerometer" and "data" in item:
                    accel_data = item["data"]
                    accelerometer = {
                        "x": accel_data.get("x", 0),
                        "y": accel_data.get("y", 0),
                        "z": accel_data.get("z", 0)
                    }
            
            csv_writer.writerow([
                str(document["_id"]),
                document.get("deviceId", ""),
                document.get("timestamp", datetime.now()).isoformat(),
                latitude,
                longitude,
                speed,
                accuracy,
                accelerometer["x"],
                accelerometer["y"],
                accelerometer["z"],
                document.get("road_quality_score", 50),
                document.get("hazard_type", ""),
                document.get("severity", ""),
                document.get("is_verified", False),
                document.get("admin_notes", "")
            ])
        
        # Prepare response
        output.seek(0)
        
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=sensor_data_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"}
        )
        
    except Exception as e:
        logging.error(f"Error exporting CSV: {e}")
        raise HTTPException(status_code=500, detail=f"Error exporting data: {str(e)}")

@api_router.post("/admin/sensor-data/import/csv")
async def import_sensor_data_csv(file: UploadFile = File(...)):
    """
    Import sensor data from CSV file
    """
    try:
        # Read CSV file
        contents = await file.read()
        decoded = contents.decode('utf-8')
        csv_reader = csv.DictReader(io.StringIO(decoded))
        
        imported_count = 0
        error_count = 0
        errors = []
        
        for row in csv_reader:
            try:
                # Create sensor data document
                doc = {
                    "deviceId": row.get("Device ID", "imported"),
                    "timestamp": datetime.fromisoformat(row["Timestamp"]) if row.get("Timestamp") else datetime.now(),
                    "rawData": [
                        {
                            "type": "location",
                            "timestamp": int(datetime.now().timestamp() * 1000),
                            "data": {
                                "latitude": float(row.get("Latitude", 0)),
                                "longitude": float(row.get("Longitude", 0)),
                                "speed": float(row.get("Speed", 0)),
                                "accuracy": float(row.get("Accuracy", 0))
                            }
                        },
                        {
                            "type": "accelerometer",
                            "timestamp": int(datetime.now().timestamp() * 1000),
                            "data": {
                                "x": float(row.get("Accel_X", 0)),
                                "y": float(row.get("Accel_Y", 0)),
                                "z": float(row.get("Accel_Z", 0))
                            }
                        }
                    ],
                    "road_quality_score": float(row.get("Road Quality", 50)),
                    "hazard_type": row.get("Hazard Type") if row.get("Hazard Type") else None,
                    "severity": row.get("Severity", "medium"),
                    "is_verified": row.get("Verified", "").lower() == "true",
                    "admin_notes": row.get("Admin Notes", "")
                }
                
                await db.sensor_data.insert_one(doc)
                imported_count += 1
                
            except Exception as row_error:
                error_count += 1
                errors.append(f"Row {imported_count + error_count}: {str(row_error)}")
                if len(errors) < 10:  # Limit error messages
                    continue
        
        return {
            "message": "Import completed",
            "imported_count": imported_count,
            "error_count": error_count,
            "errors": errors[:10]  # Return first 10 errors
        }
        
    except Exception as e:
        logging.error(f"Error importing CSV: {e}")
        raise HTTPException(status_code=500, detail=f"Error importing data: {str(e)}")

@api_router.delete("/admin/cleanup-zero-coords")
async def cleanup_zero_coordinates():
    """
    Delete all sensor data records with zero GPS coordinates (0.0, 0.0)
    This removes invalid/corrupted GPS data from the database
    """
    try:
        # Find all records with zero coordinates
        # Since we now extract coordinates from rawData, we need to check rawData structure
        
        # First, let's get all records and check which ones have no valid GPS data
        cursor = db.sensor_data.find({})
        
        records_to_delete = []
        async for document in cursor:
            has_valid_gps = False
            raw_data = document.get("rawData", [])
            
            for item in raw_data:
                if item.get("type") == "location" and "data" in item:
                    location_data = item["data"]
                    lat = location_data.get("latitude", 0)
                    lng = location_data.get("longitude", 0)
                    
                    # If we found non-zero coordinates, this record is valid
                    if lat != 0.0 and lng != 0.0:
                        has_valid_gps = True
                        break
            
            # If no valid GPS data found, mark for deletion
            if not has_valid_gps:
                records_to_delete.append(document["_id"])
        
        # Delete records without valid GPS coordinates
        if records_to_delete:
            delete_result = await db.sensor_data.delete_many({
                "_id": {"$in": records_to_delete}
            })
            deleted_count = delete_result.deleted_count
        else:
            deleted_count = 0
        
        return {
            "message": "Zero coordinate cleanup completed",
            "deleted_records": deleted_count,
            "analyzed_records": len(records_to_delete) + await db.sensor_data.count_documents({}) if records_to_delete else await db.sensor_data.count_documents({}),
            "remaining_records": await db.sensor_data.count_documents({})
        }
        
    except Exception as e:
        logging.error(f"Error during zero coordinate cleanup: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error during zero coordinate cleanup: {str(e)}")


# Admin Dashboard Route - accessible via /api/admin/dashboard
@api_router.get("/admin/dashboard", response_class=HTMLResponse)
async def admin_dashboard_api(request: Request):
    """Serve the admin dashboard web interface via API route"""
    return templates.TemplateResponse("admin_dashboard.html", {"request": request})

# Health check endpoint
@app.get("/health")
async def health_check():
    """Health check endpoint for production monitoring"""
    try:
        # Test database connection
        await db.command("ping")
        return {
            "status": "healthy",
            "database": "connected",
            "message": "Good Road API is running"
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "database": "disconnected", 
            "error": str(e)
        }

# Legacy route for local access
@app.get("/admin/dashboard", response_class=HTMLResponse)
async def admin_dashboard(request: Request):
    """Serve the admin dashboard web interface (local access)"""
    return templates.TemplateResponse("admin_dashboard.html", {"request": request})

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()