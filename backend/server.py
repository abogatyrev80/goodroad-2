from fastapi import FastAPI, APIRouter, HTTPException, Query
from fastapi.responses import HTMLResponse
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