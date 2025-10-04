from fastapi import FastAPI, APIRouter, HTTPException, Query
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

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

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

@api_router.get("/analytics/summary")
async def get_analytics_summary():
    """Get analytics summary of collected data"""
    try:
        # Count total data points
        sensor_data_count = await db.sensor_data.count_documents({})
        conditions_count = await db.road_conditions.count_documents({})
        warnings_count = await db.road_warnings.count_documents({})
        
        # Get condition distribution
        pipeline = [
            {"$group": {"_id": "$severity_level", "count": {"$sum": 1}}}
        ]
        condition_distribution = await db.road_conditions.aggregate(pipeline).to_list(10)
        
        return {
            "totalSensorDataBatches": sensor_data_count,
            "totalRoadConditions": conditions_count,
            "totalWarnings": warnings_count,
            "conditionDistribution": {item["_id"]: item["count"] for item in condition_distribution},
            "lastUpdated": datetime.utcnow()
        }
        
    except Exception as e:
        logging.error(f"Error fetching analytics: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error fetching analytics: {str(e)}")

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