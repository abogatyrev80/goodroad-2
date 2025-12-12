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
from typing import List, Dict, Any, Optional, Union
import uuid
from datetime import datetime, timedelta
import asyncio
import math
import statistics
import csv
import io

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection configuration with fallback for production
# Priority: MONGODB_URI (deployment) > MONGO_URL (local) > default
mongo_url = os.environ.get('MONGODB_URI') or os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
db_name = os.environ.get('MONGODB_DB_NAME') or os.environ.get('DB_NAME', 'good_road_db')

# Log configuration (masked for security)
if mongo_url and '@' in mongo_url:
    masked_url = mongo_url.split('@')[0].split('://')[0] + '://***@' + mongo_url.split('@')[-1]
    logger.info(f"MongoDB URL configured: {masked_url}")
else:
    logger.info(f"MongoDB URL configured: {mongo_url}")

# Global MongoDB client (will be initialized in startup event)
client = None
db = None

# Connection state
mongodb_connected = False

# Setup Jinja2 templates
templates = Jinja2Templates(directory=str(ROOT_DIR / "templates"))

# MongoDB connection helper
async def connect_to_mongodb(max_retries=5, retry_delay=5):
    """
    Connect to MongoDB with retry logic for production deployment
    """
    global client, db, mongodb_connected
    
    logger.info(f"Attempting to connect to MongoDB database: {db_name}")
    logger.info(f"MongoDB URL pattern: {mongo_url.split('@')[-1] if '@' in mongo_url else 'localhost'}")
    
    for attempt in range(1, max_retries + 1):
        try:
            # Create MongoDB client with proper timeout settings
            client_options = {
                'serverSelectionTimeoutMS': 10000,  # Increased for Atlas
                'connectTimeoutMS': 20000,  # Increased for Atlas
                'socketTimeoutMS': 20000,  # Increased for Atlas
            }
            
            # Add SSL/TLS settings for MongoDB Atlas
            if 'mongodb+srv://' in mongo_url or 'mongodb.net' in mongo_url:
                client_options['tls'] = True
                client_options['tlsAllowInvalidCertificates'] = False
                client_options['retryWrites'] = True  # Enable retryable writes for Atlas
                client_options['w'] = 'majority'  # Write concern for Atlas
                logger.info("Using MongoDB Atlas with SSL/TLS enabled")
            
            client = AsyncIOMotorClient(mongo_url, **client_options)
            db = client[db_name]
            
            # Test connection
            await client.admin.command('ping')
            
            mongodb_connected = True
            logger.info(f"✅ Successfully connected to MongoDB database: {db_name}")
            
            # 🆕 Инициализация кластеризатора
            global obstacle_clusterer
            obstacle_clusterer = ObstacleClusterer(db)
            logger.info("✅ Obstacle clusterer initialized")
            
            # 🆕 Создание индексов для obstacle_clusters
            try:
                await db.obstacle_clusters.create_index([("status", 1)])
                await db.obstacle_clusters.create_index([("expiresAt", 1)])
                # Простые индексы для lat/lng (не гео-пространственные)
                await db.obstacle_clusters.create_index([("location.latitude", 1)])
                await db.obstacle_clusters.create_index([("location.longitude", 1)])
                logger.info("✅ Created indexes for obstacle_clusters collection")
            except Exception as e:
                logger.warning(f"⚠️ Could not create indexes (may already exist): {e}")
            
            return
            
        except Exception as e:
            logger.error(f"❌ MongoDB connection attempt {attempt}/{max_retries} failed: {str(e)}")
            logger.error(f"Error type: {type(e).__name__}")
            
            if attempt < max_retries:
                logger.info(f"⏳ Retrying in {retry_delay} seconds...")
                await asyncio.sleep(retry_delay)
            else:
                logger.critical(f"❌ Failed to connect to MongoDB after {max_retries} attempts")
                # Don't raise HTTPException in startup - just raise regular Exception
                raise Exception(f"MongoDB connection failed after {max_retries} attempts: {str(e)}")

async def close_mongodb_connection():
    """
    Close MongoDB connection gracefully
    """
    global client, mongodb_connected
    
    if client:
        logger.info("Closing MongoDB connection...")
        client.close()
        mongodb_connected = False
        logger.info("✅ MongoDB connection closed")

# Create the main app without a prefix
app = FastAPI(
    title="Good Road API",
    description="Smart Road Monitoring System",
    version="2.0.0"
)

@app.on_event("startup")
async def startup_event():
    """
    Initialize services on startup
    Graceful degradation: API starts even if MongoDB is temporarily unavailable
    """
    logger.info("🚀 Starting Good Road API...")
    try:
        await connect_to_mongodb()
        logger.info("✅ All services initialized successfully")
    except Exception as e:
        logger.error(f"⚠️ Failed to connect to MongoDB during startup: {str(e)}")
        logger.warning("⚠️ API will start in degraded mode. Health checks will fail until database is available.")
        # Don't raise - let the app start and retry connections via readiness probe
        global mongodb_connected
        mongodb_connected = False

@app.on_event("shutdown")
async def shutdown_event():
    """
    Cleanup on shutdown
    """
    logger.info("🛑 Shutting down Good Road API...")
    await close_mongodb_connection()
    logger.info("✅ Shutdown complete")

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

# НОВЫЕ МОДЕЛИ ДЛЯ ИЗБЫТОЧНОГО СБОРА ДАННЫХ
class AccelerometerReading(BaseModel):
    """Одно значение акселерометра с timestamp"""
    x: float
    y: float
    z: float
    timestamp: Optional[int] = None

class RawSensorData(BaseModel):
    """Сырые данные с устройства для серверного анализа"""
    deviceId: str
    timestamp: int  # Unix timestamp в миллисекундах
    gps: Dict[str, Any]  # {latitude, longitude, speed, accuracy, altitude}
    # 🆕 Поддержка двух форматов для обратной совместимости:
    # - Новый: массив высокочастотных данных [{x, y, z, timestamp}, ...]
    # - Старый: один объект {x, y, z}
    accelerometer: Union[List[AccelerometerReading], Dict[str, float]]
    # Опциональные поля для пользовательских отчетов
    userReported: Optional[bool] = False
    eventType: Optional[str] = None
    severity: Optional[int] = None
    
class RawDataBatch(BaseModel):
    """Батч сырых данных"""
    deviceId: str
    data: List[RawSensorData]

class ProcessedEvent(BaseModel):
    """Событие, классифицированное сервером"""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    deviceId: str
    timestamp: datetime
    eventType: str  # 'pothole', 'braking', 'bump', 'vibration', 'normal'
    severity: int  # 1-5
    confidence: float  # 0-1
    latitude: float
    longitude: float
    speed: float
    accelerometer_data: Dict[str, float]  # {x, y, z, magnitude, deltaY, deltaZ, variance}
    roadType: str  # 'asphalt', 'gravel', 'dirt', 'unknown'
    created_at: datetime = Field(default_factory=datetime.utcnow)

class UserWarning(BaseModel):
    """Предупреждение для пользователя"""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    deviceId: str
    eventType: str
    severity: int
    latitude: float
    longitude: float
    distance: float  # Расстояние до события в метрах
    message: str
    expiresAt: datetime
    created_at: datetime = Field(default_factory=datetime.utcnow)


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


# Health Check Endpoints (for Kubernetes probes)
@app.get("/health")
async def health_check():
    """
    Liveness probe - returns 200 if service process is running
    This endpoint should always return quickly without heavy operations
    """
    return {
        "status": "healthy",
        "service": "Good Road API",
        "version": "2.0.0",
        "timestamp": datetime.utcnow().isoformat()
    }

@app.get("/ready")
async def readiness_check():
    """
    Readiness probe - returns 200 only if all dependencies are ready
    Checks MongoDB connection and other critical dependencies
    """
    if not mongodb_connected:
        logger.warning("Readiness check failed: MongoDB not connected")
        raise HTTPException(status_code=503, detail="MongoDB not connected")
    
    try:
        # Quick ping to verify MongoDB is still responsive
        if client:
            await client.admin.command('ping')
        return {
            "status": "ready",
            "service": "Good Road API",
            "mongodb": "connected",
            "database": db_name,
            "timestamp": datetime.utcnow().isoformat()
        }
    except Exception as e:
        logger.error(f"Readiness check failed: {str(e)}")
        raise HTTPException(status_code=503, detail=f"Database check failed: {str(e)}")

# API Endpoints
@api_router.get("/")
async def root():
    return {
        "message": "Good Road API - Smart Road Monitoring System",
        "version": "2.0.0",
        "status": "operational",
        "mongodb_connected": mongodb_connected
    }

@api_router.post("/sensor-data")
async def upload_sensor_data(batch: SensorDataBatch):
    """Upload batch of sensor data from mobile device"""
    try:
        # Separate location, accelerometer, and event data
        location_data = [point for point in batch.sensorData if point.type == "location"]
        accel_data = [point for point in batch.sensorData if point.type == "accelerometer"]
        event_data = [point for point in batch.sensorData if point.type == "event"]  # NEW: EventDetector events
        
        # Store raw sensor data
        sensor_doc = {
            "deviceId": batch.deviceId,
            "timestamp": datetime.utcnow(),
            "locationPoints": len(location_data),
            "accelerometerPoints": len(accel_data),
            "eventPoints": len(event_data),  # NEW: count of events
            "rawData": [point.dict() for point in batch.sensorData]
        }
        
        await db.sensor_data.insert_one(sensor_doc)
        
        print(f"📥 Received batch from {batch.deviceId}:")
        print(f"   Location points: {len(location_data)}")
        print(f"   Accelerometer points: {len(accel_data)}")
        print(f"   Event points: {len(event_data)}")  # NEW: log events
        
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
        
        # ✨ NEW: Process EventDetector events (modern event-driven approach)
        if event_data:
            print(f"🎯 Processing {len(event_data)} EventDetector events...")
            for event_point in event_data:
                event_info = event_point.data
                
                # Логирование для отладки
                print(f"   📍 Debug - event_info structure: {list(event_info.keys())}")
                print(f"   📍 Debug - location field: {event_info.get('location')}")
                
                # Extract location from event
                location = event_info.get("location", {})
                lat = location.get("latitude")
                lon = location.get("longitude")
                
                print(f"   📍 Debug - extracted lat: {lat}, lon: {lon}")
                
                if lat and lon:
                    # Map event severity (1-5) to condition score (0-100)
                    # severity 1 = critical = score 80
                    # severity 2 = high = score 60
                    # severity 3 = medium = score 40
                    # severity 4 = low = score 20
                    # severity 5 = normal = score 0
                    severity = event_info.get("severity", 5)
                    condition_score = 100 - (severity * 20)  # 1->80, 2->60, 3->40, 4->20, 5->0
                    
                    # Extract accelerometer data
                    accel = event_info.get("accelerometer", {})
                    
                    # Проверка пользовательской отметки
                    user_reported = event_info.get("userReported", False)
                    event_type = event_info.get("eventType")
                    
                    # Механизм устаревания для пользовательских отметок
                    expires_at = None
                    if user_reported and event_type == "accident":
                        # Аварии устаревают через 4 часа
                        expires_at = datetime.utcnow() + timedelta(hours=4)
                    elif user_reported:
                        # Другие пользовательские отметки через 24 часа
                        expires_at = datetime.utcnow() + timedelta(hours=24)
                    
                    # Проверить существующее препятствие поблизости (радиус 50 метров)
                    existing_obstacle = None
                    if user_reported:
                        # Найти существующие препятствия в радиусе 50м
                        nearby_obstacles = await db.road_conditions.find({
                            "latitude": {"$gte": lat - 0.0005, "$lte": lat + 0.0005},
                            "longitude": {"$gte": lon - 0.0005, "$lte": lon + 0.0005},
                            "event_type": event_type,
                            "status": {"$ne": "resolved"}
                        }).to_list(length=10)
                        
                        if nearby_obstacles:
                            # Найти ближайшее
                            for obstacle in nearby_obstacles:
                                existing_obstacle = obstacle
                                break
                    
                    if existing_obstacle and user_reported:
                        # Обновить существующее препятствие (подтверждение)
                        confirmations = existing_obstacle.get("confirmations", 1) + 1
                        last_confirmed_at = datetime.utcnow()
                        
                        # Продлить срок действия при подтверждении
                        if event_type == "accident":
                            new_expires_at = last_confirmed_at + timedelta(hours=4)
                        else:
                            new_expires_at = last_confirmed_at + timedelta(hours=24)
                        
                        await db.road_conditions.update_one(
                            {"_id": existing_obstacle["_id"]},
                            {
                                "$set": {
                                    "confirmations": confirmations,
                                    "last_confirmed_at": last_confirmed_at,
                                    "expires_at": new_expires_at,
                                    "updated_at": datetime.utcnow(),
                                    "status": "active"
                                }
                            }
                        )
                        print(f"   ✅ Обновлено препятствие: {event_type} (подтверждений: {confirmations})")
                    else:
                        # Создать новое препятствие
                        condition = {
                            "id": str(uuid.uuid4()),
                            "latitude": lat,
                            "longitude": lon,
                            "condition_score": max(0, min(100, condition_score)),
                            "severity_level": determine_severity_level(condition_score),
                            "data_points": 1,
                            "event_type": event_type,
                            "road_type": event_info.get("roadType", "unknown"),
                            "speed": event_info.get("speed", 0),
                            # Сырые данные акселерометра для ML анализа и адаптации устройств
                            "accelerometer_x": accel.get("x", 0),
                            "accelerometer_y": accel.get("y", 0),
                            "accelerometer_z": accel.get("z", 0),
                            "accelerometer_magnitude": accel.get("magnitude", 0),
                            "accelerometer_variance": accel.get("variance", 0),
                            "accelerometer_deltaX": accel.get("deltaX", 0),
                            "accelerometer_deltaY": accel.get("deltaY", 0),
                            "accelerometer_deltaZ": accel.get("deltaZ", 0),
                            "user_reported": user_reported,  # НОВОЕ: пользовательская отметка
                            "confirmations": 1,  # НОВОЕ: начальное количество подтверждений
                            "last_confirmed_at": datetime.utcnow() if user_reported else None,  # НОВОЕ
                            "expires_at": expires_at,  # НОВОЕ: время устаревания
                            "status": "active",  # НОВОЕ: active/expired/resolved
                            "created_at": datetime.utcnow(),
                            "updated_at": datetime.utcnow()
                        }
                        processed_conditions.append(condition)
                    
                    # Generate warning for critical events
                    if severity <= 2:  # Critical or high severity
                        event_type = event_info.get("eventType", "unknown")
                        warning_type_map = {
                            "pothole": "pothole",
                            "braking": "rough_road",
                            "bump": "speed_bump",
                            "vibration": "rough_road"
                        }
                        
                        warning_doc = {
                            "id": str(uuid.uuid4()),
                            "latitude": lat,
                            "longitude": lon,
                            "warning_type": warning_type_map.get(event_type, "rough_road"),
                            "severity": "high" if severity == 1 else "medium",
                            "confidence": 0.85,  # High confidence from EventDetector
                            "event_type": event_type,
                            "road_type": event_info.get("roadType", "unknown"),
                            "created_at": datetime.utcnow()
                        }
                        processed_warnings.append(warning_doc)
                        print(f"   ⚠️  Warning generated: {event_type} at ({lat:.6f}, {lon:.6f})")
        
        # Store processed data
        if processed_conditions:
            await db.road_conditions.insert_many(processed_conditions)
            print(f"✅ Stored {len(processed_conditions)} road conditions")
        
        if processed_warnings:
            await db.road_warnings.insert_many(processed_warnings)
            print(f"✅ Stored {len(processed_warnings)} warnings")
        
        return {
            "message": "Sensor data processed successfully",
            "rawDataPoints": len(batch.sensorData),
            "locationPoints": len(location_data),
            "accelerometerPoints": len(accel_data),
            "eventPoints": len(event_data),  # NEW
            "conditionsProcessed": len(processed_conditions),
            "warningsGenerated": len(processed_warnings)
        }
        
    except Exception as e:
        logging.error(f"Error processing sensor data: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error processing sensor data: {str(e)}")

@api_router.post("/cleanup-expired-obstacles")
async def cleanup_expired_obstacles():
    """Очистить устаревшие препятствия (cron-задача)"""
    try:
        now = datetime.utcnow()
        
        # Найти устаревшие препятствия
        expired = await db.road_conditions.find({
            "expires_at": {"$lt": now},
            "status": "active"
        }).to_list(length=1000)
        
        # Пометить как устаревшие
        if expired:
            expired_ids = [e["_id"] for e in expired]
            result = await db.road_conditions.update_many(
                {"_id": {"$in": expired_ids}},
                {
                    "$set": {
                        "status": "expired",
                        "updated_at": now
                    }
                }
            )
            
            print(f"🕒 Помечено {result.modified_count} препятствий как устаревшие")
            
            return {
                "message": "Cleanup completed",
                "expired_count": result.modified_count,
                "timestamp": now
            }
        
        return {
            "message": "No expired obstacles found",
            "expired_count": 0,
            "timestamp": now
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/ml-statistics")
async def get_ml_statistics():
    """Get ML-ready statistics with variance, speed, and delta values"""
    try:
        conditions = await db.road_conditions.find({
            "event_type": {"$ne": None},
            "accelerometer_variance": {"$exists": True}
        }).to_list(length=1000)
        
        # Group by event type
        stats_by_type = {}
        for condition in conditions:
            event_type = condition.get("event_type", "unknown")
            if event_type not in stats_by_type:
                stats_by_type[event_type] = {
                    "count": 0,
                    "avg_magnitude": 0,
                    "avg_variance": 0,
                    "avg_speed": 0,
                    "avg_deltaX": 0,
                    "avg_deltaY": 0,
                    "avg_deltaZ": 0,
                    "magnitudes": [],
                    "variances": [],
                    "speeds": []
                }
            
            stats = stats_by_type[event_type]
            stats["count"] += 1
            stats["magnitudes"].append(condition.get("accelerometer_magnitude", 0))
            stats["variances"].append(condition.get("accelerometer_variance", 0))
            stats["speeds"].append(condition.get("speed", 0))
        
        # Calculate averages
        for event_type, stats in stats_by_type.items():
            if stats["count"] > 0:
                stats["avg_magnitude"] = sum(stats["magnitudes"]) / stats["count"]
                stats["avg_variance"] = sum(stats["variances"]) / stats["count"]
                stats["avg_speed"] = sum(stats["speeds"]) / stats["count"]
                del stats["magnitudes"]
                del stats["variances"]
                del stats["speeds"]
        
        return {
            "total_events": len(conditions),
            "stats_by_type": stats_by_type
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==============================================================================
# НОВАЯ АРХИТЕКТУРА: Избыточный сбор данных + серверная классификация
# ==============================================================================

from ml_processor import EventClassifier, WarningGenerator
from clustering import ObstacleClusterer

# Инициализация ML процессоров
event_classifier = EventClassifier()
warning_generator = WarningGenerator()

# 🆕 Инициализация кластеризатора (будет инициализирован после подключения к БД)
obstacle_clusterer = None

@api_router.post("/raw-data")
async def process_raw_data(batch: RawDataBatch):
    """
    Новый endpoint для приема сырых данных с устройств
    Сервер анализирует данные и классифицирует события
    """
    try:
        device_id = batch.deviceId
        raw_count = len(batch.data)
        
        print(f"📥 Получен батч сырых данных от {device_id}: {raw_count} точек")
        
        # Сохраняем сырые данные для истории и ML обучения
        raw_documents = []
        processed_events = []
        user_warnings = []
        
        for data_point in batch.data:
            # Извлекаем данные
            timestamp = datetime.fromtimestamp(data_point.timestamp / 1000)
            gps = data_point.gps
            accel_raw = data_point.accelerometer
            
            # 🆕 Обратная совместимость: поддержка обоих форматов
            if isinstance(accel_raw, list):
                # Новый формат: массив значений
                accel_array = accel_raw
                accel_summary = {
                    "x": sum(a.x for a in accel_array) / len(accel_array) if accel_array else 0,
                    "y": sum(a.y for a in accel_array) / len(accel_array) if accel_array else 0,
                    "z": sum(a.z for a in accel_array) / len(accel_array) if accel_array else 0,
                }
                print(f"   📊 Получен массив: {len(accel_array)} значений акселерометра")
            else:
                # Старый формат: один объект {x, y, z}
                accel_array = []
                accel_summary = {
                    "x": accel_raw.get("x", 0),
                    "y": accel_raw.get("y", 0),
                    "z": accel_raw.get("z", 0),
                }
                print("   📊 Получен старый формат: одно значение акселерометра")
            
            # Сохраняем сырые данные (summary для backward compatibility)
            raw_doc = {
                "deviceId": device_id,
                "timestamp": timestamp,
                "latitude": gps.get("latitude"),
                "longitude": gps.get("longitude"),
                "speed": gps.get("speed", 0),
                "accuracy": gps.get("accuracy", 0),
                "altitude": gps.get("altitude"),
                "accelerometer_x": accel_summary["x"],
                "accelerometer_y": accel_summary["y"],
                "accelerometer_z": accel_summary["z"],
                "accelerometer_count": len(accel_array),  # 🆕 Сколько значений в массиве
                "created_at": datetime.utcnow()
            }
            raw_documents.append(raw_doc)
            
            # Проверяем является ли это пользовательским сообщением об аварии
            is_user_reported = getattr(data_point, 'userReported', False)
            manual_event_type = getattr(data_point, 'eventType', None)
            manual_severity = getattr(data_point, 'severity', None)
            
            # Если пользователь вручную сообщил об аварии - используем его данные
            if is_user_reported and manual_event_type:
                event = {
                    'eventType': manual_event_type,
                    'severity': manual_severity or 1,
                    'confidence': 1.0,  # Максимальная уверенность для ручных отчетов
                    'roadType': 'unknown',
                    'accelerometer': {
                        'x': accel_summary["x"],
                        'y': accel_summary["y"],
                        'z': accel_summary["z"],
                        'magnitude': 0,
                        'deltaX': 0,
                        'deltaY': 0,
                        'deltaZ': 0,
                        'variance': 0,
                    }
                }
                print(f"   🚨 Пользовательский отчет: {manual_event_type} от {device_id}")
            else:
                # 🆕 Классифицируем событие через ML процессор с массивом данных
                if accel_array and len(accel_array) > 0:
                    # Конвертируем AccelerometerReading объекты в dict для ML процессора
                    accel_dict_array = [
                        {"x": a.x, "y": a.y, "z": a.z, "timestamp": a.timestamp}
                        for a in accel_array
                    ]
                    event = event_classifier.analyze_accelerometer_array(
                        device_id=device_id,
                        accelerometer_data=accel_dict_array,
                        speed=gps.get("speed", 0)
                    )
                else:
                    event = None
                
                # Если событие обнаружено, добавляем accelerometer данные для обратной совместимости
                if event:
                    event['roadType'] = 'unknown'  # TODO: определить тип дороги
                    event['accelerometer'] = {
                        'x': accel_summary["x"],
                        'y': accel_summary["y"],
                        'z': accel_summary["z"],
                        'magnitude': event.get('magnitude', 0),
                        'deltaX': 0,
                        'deltaY': event.get('delta_y', 0),
                        'deltaZ': event.get('delta_z', 0),
                        'variance': event.get('variance', 0),
                    }
            
            if event and event.get('eventType'):
                # 🆕 КЛАСТЕРИЗАЦИЯ: Находим или создаём кластер для события
                cluster_id = None
                if obstacle_clusterer:
                    try:
                        cluster_id = await obstacle_clusterer.process_event(
                            event={
                                'eventType': event.get('eventType'),
                                'severity': event.get('severity', 3),
                                'latitude': gps.get("latitude"),
                                'longitude': gps.get("longitude"),
                                'speed': gps.get("speed", 0)
                            },
                            device_id=device_id
                        )
                        print(f"✅ Кластеризация: событие {event.get('eventType')} → cluster {cluster_id}")
                    except Exception as e:
                        print(f"⚠️ Ошибка кластеризации: {e}")
                        import traceback
                        traceback.print_exc()
                
                # Событие обнаружено - сохраняем с clusterId
                processed_event = {
                    "id": str(uuid.uuid4()),
                    "deviceId": device_id,
                    "timestamp": timestamp,
                    "eventType": event['eventType'],
                    "severity": event['severity'],
                    "confidence": event['confidence'],
                    "latitude": gps.get("latitude"),
                    "longitude": gps.get("longitude"),
                    "speed": gps.get("speed", 0),
                    "accelerometer_x": event['accelerometer']['x'],
                    "accelerometer_y": event['accelerometer']['y'],
                    "accelerometer_z": event['accelerometer']['z'],
                    "accelerometer_magnitude": event['accelerometer']['magnitude'],
                    "accelerometer_deltaX": event['accelerometer']['deltaX'],
                    "accelerometer_deltaY": event['accelerometer']['deltaY'],
                    "accelerometer_deltaZ": event['accelerometer']['deltaZ'],
                    "accelerometer_variance": event['accelerometer']['variance'],
                    "roadType": event['roadType'],
                    "clusterId": cluster_id,  # 🆕 Добавляем ID кластера
                    "created_at": datetime.utcnow()
                }
                
                # 🆕 Копируем дополнительные поля из анализа паттернов
                if 'impact_intensity' in event:
                    processed_event['impact_intensity'] = event['impact_intensity']
                if 'wave_amplitude' in event:
                    processed_event['wave_amplitude'] = event['wave_amplitude']
                if 'vibration_frequency' in event:
                    processed_event['vibration_frequency'] = event['vibration_frequency']
                if 'detection_method' in event:
                    processed_event['detection_method'] = event['detection_method']
                if 'note' in event:
                    processed_event['note'] = event['note']
                
                processed_events.append(processed_event)
                
                # Проверяем нужно ли предупредить пользователя
                should_warn, distance = warning_generator.should_warn_user(
                    user_lat=gps.get("latitude"),
                    user_lng=gps.get("longitude"),
                    event_lat=gps.get("latitude"),
                    event_lng=gps.get("longitude"),
                    event_type=event['eventType'],
                    severity=event['severity']
                )
                
                if should_warn:
                    warning_message = warning_generator.create_warning_message(
                        event['eventType'],
                        event['severity'],
                        distance
                    )
                    
                    warning_doc = {
                        "id": str(uuid.uuid4()),
                        "deviceId": device_id,
                        "eventType": event['eventType'],
                        "severity": event['severity'],
                        "latitude": gps.get("latitude"),
                        "longitude": gps.get("longitude"),
                        "distance": distance,
                        "message": warning_message,
                        "expiresAt": datetime.utcnow() + timedelta(minutes=5),
                        "created_at": datetime.utcnow()
                    }
                    user_warnings.append(warning_doc)
                    print(f"   ⚠️  Предупреждение: {warning_message}")
        
        # Сохраняем в базу данных
        if raw_documents:
            await db.raw_sensor_data.insert_many(raw_documents)
            print(f"✅ Сохранено {len(raw_documents)} сырых записей")
        
        if processed_events:
            await db.processed_events.insert_many(processed_events)
            print(f"✅ Классифицировано {len(processed_events)} событий")
        
        if user_warnings:
            await db.user_warnings.insert_many(user_warnings)
            print(f"✅ Создано {len(user_warnings)} предупреждений")
        
        return {
            "message": "Raw data processed successfully",
            "rawDataSaved": len(raw_documents),
            "eventsDetected": len(processed_events),
            "warningsGenerated": len(user_warnings)
        }
        
    except Exception as e:
        logging.error(f"Error processing raw data: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error processing raw data: {str(e)}")

@api_router.get("/warnings/{device_id}")
async def get_active_warnings(device_id: str):
    """
    Получить активные предупреждения для устройства
    """
    try:
        now = datetime.utcnow()
        
        # Находим активные предупреждения (не истекшие)
        warnings = await db.user_warnings.find({
            "deviceId": device_id,
            "expiresAt": {"$gt": now}
        }).sort("created_at", -1).to_list(length=10)
        
        # Преобразуем ObjectId в строку
        for warning in warnings:
            warning["_id"] = str(warning["_id"])
        
        return {
            "deviceId": device_id,
            "count": len(warnings),
            "warnings": warnings
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.delete("/warnings/{warning_id}")
async def dismiss_warning(warning_id: str):
    """
    Удалить/отклонить предупреждение
    """
    try:
        result = await db.user_warnings.delete_one({"id": warning_id})
        
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Warning not found")
        
        return {"message": "Warning dismissed"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==============================================================================
# НОВЫЕ ADMIN ENDPOINTS ДЛЯ НОВОЙ АРХИТЕКТУРЫ
# ==============================================================================

@api_router.get("/admin/v2/analytics")
async def get_v2_analytics():
    """
    Новая аналитика для новой архитектуры
    Работает с коллекциями: raw_sensor_data, processed_events, user_warnings
    """
    try:
        # Подсчет сырых данных
        raw_data_count = await db.raw_sensor_data.count_documents({})
        
        # Подсчет обработанных событий
        processed_events_count = await db.processed_events.count_documents({})
        
        # Подсчет предупреждений
        warnings_count = await db.user_warnings.count_documents({})
        
        # Статистика по типам событий
        event_pipeline = [
            {"$group": {
                "_id": "$eventType",
                "count": {"$sum": 1},
                "avg_severity": {"$avg": "$severity"},
                "avg_confidence": {"$avg": "$confidence"}
            }}
        ]
        event_stats = await db.processed_events.aggregate(event_pipeline).to_list(100)
        
        # Статистика по устройствам
        device_pipeline = [
            {"$group": {
                "_id": "$deviceId",
                "raw_points": {"$sum": 1}
            }},
            {"$limit": 10}
        ]
        device_stats = await db.raw_sensor_data.aggregate(device_pipeline).to_list(10)
        
        # Последние события
        recent_events = await db.processed_events.find(
            {},
            {"_id": 0}
        ).sort("timestamp", -1).limit(10).to_list(10)
        
        return {
            "summary": {
                "raw_data_points": raw_data_count,
                "processed_events": processed_events_count,
                "active_warnings": warnings_count
            },
            "event_statistics": event_stats,
            "top_devices": device_stats,
            "recent_events": recent_events
        }
    except Exception as e:
        logging.error(f"Error in v2 analytics: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error retrieving v2 analytics: {str(e)}")

@api_router.get("/admin/v2/raw-data")
async def get_raw_data(
    limit: int = Query(100, ge=1, le=50000, description="Максимальное количество записей (1-50000)"),
    skip: int = Query(0, ge=0, description="Количество записей для пропуска")
):
    """Получить сырые данные из коллекции raw_sensor_data"""
    try:
        total = await db.raw_sensor_data.count_documents({})
        
        data = await db.raw_sensor_data.find(
            {},
            {"_id": 0}
        ).sort("timestamp", -1).skip(skip).limit(limit).to_list(limit)
        
        return {
            "total": total,
            "limit": limit,
            "skip": skip,
            "returned": len(data),
            "data": data
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving raw data: {str(e)}")

@api_router.get("/admin/v2/events")
async def get_processed_events(
    limit: int = Query(100, ge=1, le=50000, description="Максимальное количество событий (1-50000)"),
    skip: int = Query(0, ge=0, description="Количество событий для пропуска"),
    event_type: str = None
):
    """Получить обработанные события из коллекции processed_events"""
    try:
        query = {}
        if event_type:
            query["eventType"] = event_type
        
        total = await db.processed_events.count_documents(query)
        
        events = await db.processed_events.find(
            query,
            {"_id": 0}
        ).sort("timestamp", -1).skip(skip).limit(limit).to_list(limit)
        
        return {
            "total": total,
            "limit": limit,
            "skip": skip,
            "returned": len(events),
            "events": events
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving events: {str(e)}")

@api_router.get("/admin/v2/clusters")
async def get_obstacle_clusters(
    limit: int = Query(1000, ge=1, le=50000, description="Максимальное количество кластеров (1-50000)"),
    status: str = "active",
    min_reports: int = 0  # 🆕 Минимум отчётов для фильтрации
):
    """
    🆕 Получить кластеры препятствий
    
    Args:
        limit: Максимальное количество кластеров (по умолчанию 1000, макс 50000)
        status: Статус кластера (active, expired, fixed)
        min_reports: Минимальное количество отчётов (0 = все, 3 = подтверждённые)
    
    Returns:
        Список кластеров с агрегированной информацией
    """
    try:
        if not obstacle_clusterer:
            raise HTTPException(status_code=503, detail="Obstacle clusterer not initialized")
        
        # Автоматически помечаем устаревшие кластеры
        await obstacle_clusterer.expire_old_clusters()
        
        # Получаем активные кластеры
        query = {"status": status}
        if status == "active":
            query["expiresAt"] = {"$gt": datetime.utcnow()}
        
        # 🆕 Фильтр по минимальному количеству отчётов
        if min_reports > 0:
            query["reportCount"] = {"$gte": min_reports}
        
        clusters = await db.obstacle_clusters.find(
            query,
            {"_id": 1, "obstacleType": 1, "location": 1, "severity": 1, 
             "confidence": 1, "reportCount": 1, "devices": 1, 
             "firstReported": 1, "lastReported": 1, "status": 1, 
             "expiresAt": 1, "roadInfo": 1}
        ).sort("lastReported", -1).limit(limit).to_list(limit)
        
        # Преобразуем даты в строки для JSON
        for cluster in clusters:
            cluster['clusterId'] = cluster.pop('_id')
            cluster['firstReported'] = cluster['firstReported'].isoformat() if cluster.get('firstReported') else None
            cluster['lastReported'] = cluster['lastReported'].isoformat() if cluster.get('lastReported') else None
            cluster['expiresAt'] = cluster['expiresAt'].isoformat() if cluster.get('expiresAt') else None
            
            # Убираем history из severity (слишком большой для передачи)
            if 'severity' in cluster and 'history' in cluster['severity']:
                del cluster['severity']['history']
            if 'roadInfo' in cluster and 'speeds' in cluster['roadInfo']:
                del cluster['roadInfo']['speeds']
        
        return {
            "total": len(clusters),
            "clusters": clusters
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving clusters: {str(e)}")

@api_router.post("/admin/recalculate-clusters")
async def recalculate_all_clusters():
    """
    🔄 Удалить все кластеры и пересоздать их заново на основе событий
    
    Используется после изменения параметров кластеризации
    """
    try:
        if not obstacle_clusterer:
            raise HTTPException(status_code=503, detail="Obstacle clusterer not initialized")
        
        logger.info("🗑️ Удаление всех существующих кластеров...")
        
        # Удаляем все кластеры
        delete_result = await db.obstacle_clusters.delete_many({})
        deleted_count = delete_result.deleted_count
        
        logger.info(f"✅ Удалено кластеров: {deleted_count}")
        
        # Получаем ВСЕ события (используем cursor для больших объёмов)
        logger.info("📊 Получение всех событий...")
        
        # Подсчитываем сначала
        total_events = await db.processed_events.count_documents({})
        logger.info(f"📦 Всего событий в БД: {total_events}")
        
        # Получаем все события батчами
        all_events = []
        cursor = db.processed_events.find({})
        async for event in cursor:
            all_events.append(event)
        
        logger.info(f"📦 Получено событий для обработки: {len(all_events)}")
        
        # Пересоздаём кластеры
        logger.info("🔄 Создание кластеров с новыми параметрами...")
        created_count = 0
        error_count = 0
        
        for event in all_events:
            try:
                # Используем функцию process_event
                await obstacle_clusterer.process_event(
                    event_id=str(event['_id']),
                    event_type=event.get('eventType'),
                    latitude=event.get('latitude'),
                    longitude=event.get('longitude'),
                    severity=event.get('severity', 3),
                    confidence=event.get('confidence', 0.7),
                    speed=event.get('speed', 0),
                    timestamp=event.get('timestamp'),
                    device_id=event.get('deviceId')
                )
                created_count += 1
                
                if created_count % 500 == 0:
                    logger.info(f"  Обработано событий: {created_count}/{len(all_events)}")
                    
            except Exception as e:
                logger.error(f"Ошибка обработки события {event.get('_id')}: {str(e)}")
                error_count += 1
                continue
        
        # Подсчитываем итоговое количество кластеров
        final_clusters = await db.obstacle_clusters.count_documents({})
        
        logger.info(f"✅ Пересоздание завершено!")
        logger.info(f"  Обработано событий: {created_count}/{len(all_events)}")
        logger.info(f"  Создано кластеров: {final_clusters}")
        
        return {
            "success": True,
            "deleted_clusters": deleted_count,
            "processed_events": created_count,
            "total_events": len(all_events),
            "final_clusters": final_clusters,
            "message": f"Пересоздано кластеров: {final_clusters} (было: {deleted_count})"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error recalculating clusters: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error recalculating clusters: {str(e)}")

@api_router.post("/admin/cleanup-old-data")
async def cleanup_old_data(
    days: int = 30,
    delete_events: bool = False,
    delete_clusters: bool = False,
    delete_raw_data: bool = True
):
    """
    🗑️ Очистить старые данные
    
    Args:
        days: Удалить данные старше N дней
        delete_events: Удалить старые события
        delete_clusters: Удалить старые кластеры
        delete_raw_data: Удалить старые сырые данные (по умолчанию True)
    """
    try:
        from datetime import datetime, timedelta
        
        cutoff_date = datetime.utcnow() - timedelta(days=days)
        logger.info(f"🗑️ Очистка данных старше {cutoff_date.strftime('%Y-%m-%d')}")
        
        results = {
            "cutoff_date": cutoff_date.isoformat(),
            "days": days
        }
        
        # Удаление сырых данных
        if delete_raw_data:
            raw_result = await db.raw_sensor_data.delete_many({
                "created_at": {"$lt": cutoff_date}
            })
            results["deleted_raw_data"] = raw_result.deleted_count
            logger.info(f"  ✅ Удалено сырых данных: {raw_result.deleted_count}")
        
        # Удаление событий
        if delete_events:
            events_result = await db.processed_events.delete_many({
                "timestamp": {"$lt": cutoff_date}
            })
            results["deleted_events"] = events_result.deleted_count
            logger.info(f"  ✅ Удалено событий: {events_result.deleted_count}")
        
        # Удаление кластеров
        if delete_clusters:
            clusters_result = await db.obstacle_clusters.delete_many({
                "created_at": {"$lt": cutoff_date}
            })
            results["deleted_clusters"] = clusters_result.deleted_count
            logger.info(f"  ✅ Удалено кластеров: {clusters_result.deleted_count}")
        
        # Статистика после очистки
        remaining_raw = await db.raw_sensor_data.count_documents({})
        remaining_events = await db.processed_events.count_documents({})
        remaining_clusters = await db.obstacle_clusters.count_documents({})
        
        results["remaining"] = {
            "raw_data": remaining_raw,
            "events": remaining_events,
            "clusters": remaining_clusters
        }
        
        logger.info(f"✅ Очистка завершена. Осталось: raw={remaining_raw}, events={remaining_events}, clusters={remaining_clusters}")
        
        return results
        
    except Exception as e:
        logger.error(f"Error cleaning up old data: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error cleaning up: {str(e)}")

@api_router.post("/admin/delete-all-data")
async def delete_all_data(
    confirm: str = None,
    delete_events: bool = False,
    delete_clusters: bool = False,
    delete_raw_data: bool = False
):
    """
    ⚠️ Удалить ВСЕ данные (требует подтверждение)
    
    Args:
        confirm: Должно быть "DELETE_ALL_DATA"
        delete_events: Удалить все события
        delete_clusters: Удалить все кластеры
        delete_raw_data: Удалить все сырые данные
    """
    try:
        if confirm != "DELETE_ALL_DATA":
            raise HTTPException(
                status_code=400,
                detail="Требуется подтверждение: confirm='DELETE_ALL_DATA'"
            )
        
        logger.warning("⚠️ УДАЛЕНИЕ ВСЕХ ДАННЫХ!")
        
        results = {}
        
        if delete_raw_data:
            raw_result = await db.raw_sensor_data.delete_many({})
            results["deleted_raw_data"] = raw_result.deleted_count
            logger.warning(f"  🗑️ Удалено всех сырых данных: {raw_result.deleted_count}")
        
        if delete_events:
            events_result = await db.processed_events.delete_many({})
            results["deleted_events"] = events_result.deleted_count
            logger.warning(f"  🗑️ Удалено всех событий: {events_result.deleted_count}")
        
        if delete_clusters:
            clusters_result = await db.obstacle_clusters.delete_many({})
            results["deleted_clusters"] = clusters_result.deleted_count
            logger.warning(f"  🗑️ Удалено всех кластеров: {clusters_result.deleted_count}")
        
        return {
            "success": True,
            "deleted": results,
            "message": "Данные успешно удалены"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting all data: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error deleting data: {str(e)}")

@api_router.get("/admin/v2/heatmap")
async def get_heatmap_data_simple():
    """Получить данные для heatmap из processed_events (упрощенная версия)"""
    try:
        events = await db.processed_events.find(
            {"latitude": {"$ne": None}, "longitude": {"$ne": None}},
            {"_id": 0, "latitude": 1, "longitude": 1, "eventType": 1, "severity": 1}
        ).to_list(5000)
        
        # Форматируем для heatmap
        heatmap_data = []
        for event in events:
            heatmap_data.append({
                "lat": event.get("latitude"),
                "lng": event.get("longitude"),
                "intensity": (6 - event.get("severity", 5)) / 5,  # Инвертируем severity для intensity
                "type": event.get("eventType", "unknown")
            })
        
        return {
            "points": heatmap_data,
            "total": len(heatmap_data)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving heatmap data: {str(e)}")

@api_router.get("/obstacles/nearby")
async def get_nearby_obstacles(
    latitude: float,
    longitude: float,
    radius: float = 5000,  # 5 км по умолчанию
    min_confirmations: int = 1
):
    """
    🆕 Получить препятствия рядом с текущей позицией (для мобильного приложения)
    
    Args:
        latitude: Широта текущей позиции
        longitude: Долгота текущей позиции
        radius: Радиус поиска в метрах (по умолчанию 5000м = 5км)
        min_confirmations: Минимальное количество подтверждений (по умолчанию 1)
    
    Returns:
        Список активных кластеров препятствий отсортированных по приоритету
    """
    try:
        if not obstacle_clusterer:
            raise HTTPException(status_code=503, detail="Obstacle clusterer not initialized")
        
        # Получаем все активные кластеры
        all_clusters = await db.obstacle_clusters.find({
            "status": "active",
            "expiresAt": {"$gt": datetime.utcnow()},
            "reportCount": {"$gte": min_confirmations}
        }).to_list(1000)
        
        # Фильтруем по расстоянию и добавляем расстояние к каждому кластеру
        nearby_obstacles = []
        for cluster in all_clusters:
            distance = obstacle_clusterer.haversine_distance(
                latitude, longitude,
                cluster['location']['latitude'],
                cluster['location']['longitude']
            )
            
            if distance <= radius:
                # Оптимизированный формат для мобильного приложения
                obstacle = {
                    "id": str(cluster['_id']),
                    "type": cluster['obstacleType'],
                    "latitude": cluster['location']['latitude'],
                    "longitude": cluster['location']['longitude'],
                    "distance": round(distance, 1),  # метры
                    "severity": {
                        "average": round(cluster['severity']['average'], 1),
                        "max": cluster['severity']['max']
                    },
                    "confidence": round(cluster['confidence'], 2),
                    "confirmations": cluster['reportCount'],
                    "avgSpeed": round(cluster['roadInfo']['avgSpeed'] * 3.6, 1),  # м/с -> км/ч
                    "lastReported": cluster['lastReported'].isoformat()
                }
                
                # Вычисляем приоритет для сортировки
                # Приоритет = confirmations * 100 + (1 / (distance + 1)) * 10
                # Чем больше подтверждений и ближе - тем выше приоритет
                priority = cluster['reportCount'] * 100 + (1 / (distance + 1)) * 10
                obstacle['priority'] = round(priority, 2)
                
                nearby_obstacles.append(obstacle)
        
        # Сортируем по приоритету (убывание)
        nearby_obstacles.sort(key=lambda x: x['priority'], reverse=True)
        
        return {
            "userLocation": {
                "latitude": latitude,
                "longitude": longitude
            },
            "searchRadius": radius,
            "minConfirmations": min_confirmations,
            "total": len(nearby_obstacles),
            "obstacles": nearby_obstacles
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving nearby obstacles: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error retrieving nearby obstacles: {str(e)}")

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


# 🆕 ML Configuration Models
class MLThresholdsUpdate(BaseModel):
    """Модель для обновления порогов ML классификатора"""
    pothole: Optional[Dict[str, float]] = None
    braking: Optional[Dict[str, float]] = None
    bump: Optional[Dict[str, float]] = None
    vibration: Optional[Dict[str, float]] = None

# 🆕 API для управления порогами ML
@api_router.get("/admin/v2/ml-thresholds")
async def get_ml_thresholds():
    """Получить текущие пороги ML классификатора"""
    try:
        thresholds = event_classifier.get_thresholds()
        return {
            "thresholds": thresholds,
            "description": {
                "pothole": "Порог для обнаружения ям (deltaY, deltaZ, magnitude)",
                "braking": "Порог для обнаружения резкого торможения (deltaY, magnitude)",
                "bump": "Порог для обнаружения неровностей (deltaZ, magnitude)",
                "vibration": "Порог для обнаружения вибраций (variance, magnitude)"
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/admin/v2/ml-thresholds")
async def update_ml_thresholds(update: MLThresholdsUpdate):
    """Обновить пороги ML классификатора"""
    try:
        # Подготовка данных для обновления
        new_thresholds = {}
        if update.pothole:
            new_thresholds['pothole'] = update.pothole
        if update.braking:
            new_thresholds['braking'] = update.braking
        if update.bump:
            new_thresholds['bump'] = update.bump
        if update.vibration:
            new_thresholds['vibration'] = update.vibration
        
        # Обновляем пороги
        event_classifier.update_thresholds(new_thresholds)
        
        return {
            "message": "Пороги успешно обновлены",
            "updated_thresholds": new_thresholds,
            "current_thresholds": event_classifier.get_thresholds()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 🆕 API для редактирования событий
@api_router.put("/admin/v2/events/{event_id}")
async def update_event(event_id: str, update_data: Dict):
    """Обновить событие по ID"""
    try:
        result = await db.processed_events.update_one(
            {"id": event_id},
            {"$set": update_data}
        )
        
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Событие не найдено")
        
        return {"message": "Событие обновлено", "modified_count": result.modified_count}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.delete("/admin/v2/events/{event_id}")
async def delete_event(event_id: str):
    """Удалить событие по ID"""
    try:
        result = await db.processed_events.delete_one({"id": event_id})
        
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Событие не найдено")
        
        return {"message": "Событие удалено", "deleted_count": result.deleted_count}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 🆕 API для очистки базы данных (работает с любой подключенной БД)
@api_router.delete("/admin/clear-database")
async def clear_database(
    confirm: str = Query(..., description="Введите 'CONFIRM' для подтверждения"),
    days: Optional[int] = Query(None, description="Удалить данные старше N дней (если не указано - удалить все)")
):
    """
    Очистить базу данных (локальную или Atlas) с возможностью фильтрации по периоду
    
    Параметры:
    - confirm: должно быть 'CONFIRM' для подтверждения
    - days: удалить данные старше N дней (опционально)
    
    Примеры:
    - /admin/clear-database?confirm=CONFIRM - удалить ВСЕ данные
    - /admin/clear-database?confirm=CONFIRM&days=7 - удалить данные старше 7 дней
    - /admin/clear-database?confirm=CONFIRM&days=30 - удалить данные старше 30 дней
    """
    if confirm != "CONFIRM":
        raise HTTPException(
            status_code=400, 
            detail="Для подтверждения передайте параметр confirm=CONFIRM"
        )
    
    try:
        collections_to_clear = [
            'raw_sensor_data',
            'processed_events', 
            'events',
            'user_warnings',
            'road_conditions',
            'road_warnings',
            'sensor_data',
            'calibration_profiles'
        ]
        
        # Определяем фильтр по дате
        if days is not None and days > 0:
            cutoff_date = datetime.utcnow() - timedelta(days=days)
            # Для коллекций с полем timestamp (datetime)
            date_filter_timestamp = {"timestamp": {"$lt": cutoff_date}}
            # Для коллекций с полем created_at (datetime)
            date_filter_created = {"created_at": {"$lt": cutoff_date}}
        else:
            date_filter_timestamp = {}
            date_filter_created = {}
        
        results = {}
        total_deleted = 0
        
        for collection_name in collections_to_clear:
            try:
                # Выбираем правильный фильтр в зависимости от структуры коллекции
                if collection_name in ['raw_sensor_data', 'sensor_data']:
                    filter_to_use = date_filter_timestamp if days else {}
                elif collection_name in ['road_conditions', 'road_warnings', 'user_warnings', 'processed_events', 'events']:
                    filter_to_use = date_filter_created if days else {}
                else:
                    filter_to_use = {}
                
                result = await db[collection_name].delete_many(filter_to_use)
                results[collection_name] = result.deleted_count
                total_deleted += result.deleted_count
            except Exception as e:
                results[collection_name] = f"Error: {str(e)}"
        
        period_msg = f"старше {days} дней" if days else "все данные"
        
        return {
            "message": f"База данных очищена ({period_msg})",
            "database": db_name,
            "period": f"{days} days" if days else "all time",
            "total_deleted": total_deleted,
            "details": results
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 🆕 API для очистки базы данных V2 с фильтром по диапазону дат
@api_router.delete("/admin/clear-database-v2")
async def clear_database_v2(
    confirm: str = Query(..., description="Введите 'CONFIRM' для подтверждения"),
    date_from: Optional[str] = Query(None, description="Начальная дата для удаления (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="Конечная дата для удаления (YYYY-MM-DD)")
):
    """
    Очистить базу данных с возможностью фильтрации по диапазону дат
    
    Параметры:
    - confirm: должно быть 'CONFIRM' для подтверждения
    - date_from: начальная дата (включительно) в формате YYYY-MM-DD
    - date_to: конечная дата (включительно) в формате YYYY-MM-DD
    
    Примеры:
    - /admin/clear-database-v2?confirm=CONFIRM - удалить ВСЕ данные
    - /admin/clear-database-v2?confirm=CONFIRM&date_from=2025-01-01&date_to=2025-01-31 - удалить данные за январь 2025
    - /admin/clear-database-v2?confirm=CONFIRM&date_to=2024-12-31 - удалить все данные до конца 2024 года
    - /admin/clear-database-v2?confirm=CONFIRM&date_from=2024-01-01 - удалить все данные с начала 2024 года
    """
    if confirm != "CONFIRM":
        raise HTTPException(
            status_code=400, 
            detail="Для подтверждения передайте параметр confirm=CONFIRM"
        )
    
    try:
        collections_to_clear = [
            'raw_sensor_data',
            'processed_events', 
            'events',
            'user_warnings',
            'road_conditions',
            'road_warnings',
            'sensor_data',
            'calibration_profiles'
        ]
        
        # Определяем фильтры по диапазону дат
        date_filter_timestamp = {}
        date_filter_created = {}
        
        if date_from or date_to:
            # Для коллекций с полем timestamp (datetime)
            timestamp_conditions = {}
            if date_from:
                from_date = datetime.fromisoformat(date_from)
                timestamp_conditions["$gte"] = from_date
            if date_to:
                to_date = datetime.fromisoformat(date_to + "T23:59:59")
                timestamp_conditions["$lte"] = to_date
            date_filter_timestamp = {"timestamp": timestamp_conditions}
            
            # Для коллекций с полем created_at (datetime)
            created_conditions = {}
            if date_from:
                from_date = datetime.fromisoformat(date_from)
                created_conditions["$gte"] = from_date
            if date_to:
                to_date = datetime.fromisoformat(date_to + "T23:59:59")
                created_conditions["$lte"] = to_date
            date_filter_created = {"created_at": created_conditions}
        
        results = {}
        total_deleted = 0
        
        for collection_name in collections_to_clear:
            try:
                # Выбираем правильный фильтр в зависимости от структуры коллекции
                if collection_name in ['raw_sensor_data', 'sensor_data']:
                    filter_to_use = date_filter_timestamp if (date_from or date_to) else {}
                elif collection_name in ['road_conditions', 'road_warnings', 'user_warnings', 'processed_events', 'events']:
                    filter_to_use = date_filter_created if (date_from or date_to) else {}
                else:
                    filter_to_use = {}
                
                result = await db[collection_name].delete_many(filter_to_use)
                results[collection_name] = result.deleted_count
                total_deleted += result.deleted_count
            except Exception as e:
                results[collection_name] = f"Error: {str(e)}"
        
        # Формируем сообщение о периоде
        if date_from and date_to:
            period_msg = f"с {date_from} по {date_to}"
        elif date_from:
            period_msg = f"с {date_from} до сегодня"
        elif date_to:
            period_msg = f"до {date_to}"
        else:
            period_msg = "все данные"
        
        return {
            "message": f"База данных очищена ({period_msg})",
            "database": db_name,
            "period": {
                "from": date_from,
                "to": date_to
            },
            "total_deleted": total_deleted,
            "details": results
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Неверный формат даты: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 🆕 API для редактирования raw data
@api_router.delete("/admin/v2/raw-data/{data_id}")
async def delete_raw_data(data_id: str):
    """Удалить raw data по ID"""
    try:
        from bson import ObjectId
        result = await db.raw_sensor_data.delete_one({"_id": ObjectId(data_id)})
        
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Данные не найдены")
        
        return {"message": "Данные удалены", "deleted_count": result.deleted_count}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/admin/sensor-data")
async def get_all_sensor_data(
    limit: int = Query(1000, ge=1, le=100000, description="Максимальное количество записей (1-100000)"),
    skip: int = Query(0, ge=0, description="Количество записей для пропуска"),
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
                # Обработка старого формата (location)
                if item.get("type") == "location" and "data" in item:
                    location_data = item["data"]
                    latitude = location_data.get("latitude", 0)
                    longitude = location_data.get("longitude", 0)
                    speed = location_data.get("speed", 0)
                    accuracy = location_data.get("accuracy", 0)
                # Обработка нового формата (event) - НОВОЕ
                elif item.get("type") == "event" and "data" in item:
                    event_data_item = item["data"]
                    # Location находится внутри data.location
                    location_in_event = event_data_item.get("location", {})
                    if location_in_event:
                        latitude = location_in_event.get("latitude", 0)
                        longitude = location_in_event.get("longitude", 0)
                        speed = location_in_event.get("speed", 0)
                        accuracy = location_in_event.get("accuracy", 0)
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
    date_from: Optional[str] = Query(None, description="Дата начала (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="Дата окончания (YYYY-MM-DD)"),
    limit: int = Query(10000, ge=1, le=100000, description="Максимальное количество записей для экспорта (1-100000)")
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
                # Обработка старого формата (location)
                if item.get("type") == "location" and "data" in item:
                    location_data = item["data"]
                    latitude = location_data.get("latitude", 0)
                    longitude = location_data.get("longitude", 0)
                    speed = location_data.get("speed", 0)
                    accuracy = location_data.get("accuracy", 0)
                # Обработка нового формата (event) - НОВОЕ
                elif item.get("type") == "event" and "data" in item:
                    event_data_item = item["data"]
                    # Location находится внутри data.location
                    location_in_event = event_data_item.get("location", {})
                    if location_in_event:
                        latitude = location_in_event.get("latitude", 0)
                        longitude = location_in_event.get("longitude", 0)
                        speed = location_in_event.get("speed", 0)
                        accuracy = location_in_event.get("accuracy", 0)
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
                # Обработка старого формата (location)
                if item.get("type") == "location" and "data" in item:
                    location_data = item["data"]
                    lat = location_data.get("latitude", 0)
                    lng = location_data.get("longitude", 0)
                    
                    # If we found non-zero coordinates, this record is valid
                    if lat != 0.0 and lng != 0.0:
                        has_valid_gps = True
                        break
                # Обработка нового формата (event) - НОВОЕ
                elif item.get("type") == "event" and "data" in item:
                    event_data_item = item["data"]
                    # Location находится внутри data.location
                    location_in_event = event_data_item.get("location", {})
                    if location_in_event:
                        lat = location_in_event.get("latitude", 0)
                        lng = location_in_event.get("longitude", 0)
                        
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


# Health check is defined earlier in the file (line ~356)

# Admin Dashboard v3 Routes
@app.get("/admin/dashboard/v3", response_class=HTMLResponse)
async def admin_dashboard_v3(request: Request):
    """Serve the admin dashboard v3 page with integrated editor"""
    return templates.TemplateResponse("admin_dashboard_v3.html", {"request": request})

@api_router.get("/admin/dashboard/v3", response_class=HTMLResponse)
async def admin_dashboard_v3_api(request: Request):
    """Serve the admin dashboard v3 page through /api route"""
    return templates.TemplateResponse("admin_dashboard_v3.html", {"request": request})


@api_router.put("/admin/editor/events/{event_id}")
async def update_event(event_id: str, data: dict):
    """
    Обновление события по ID для админ-панели v3
    """
    try:
        update_data = {}
        if 'eventType' in data:
            update_data['eventType'] = data['eventType']
        if 'severity' in data:
            update_data['severity'] = data['severity']
        if 'confidence' in data:
            update_data['confidence'] = data['confidence']
        if 'notes' in data:
            update_data['notes'] = data['notes']
        
        if not update_data:
            raise HTTPException(status_code=400, detail="No data to update")
        
        result = await db.processed_events.update_one(
            {"id": event_id},
            {"$set": update_data}
        )
        
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Event not found")
        
        return {"success": True, "message": "Event updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating event: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error updating event: {str(e)}")

@api_router.put("/admin/editor/clusters/{cluster_id}")
async def update_cluster(cluster_id: str, data: dict):
    """
    Обновление кластера по ID для админ-панели v3
    """
    try:
        update_data = {}
        if 'obstacleType' in data:
            update_data['obstacleType'] = data['obstacleType']
        if 'severity_max' in data:
            update_data['severity.max'] = data['severity_max']
        if 'confidence' in data:
            update_data['confidence'] = data['confidence']
        if 'status' in data:
            update_data['status'] = data['status']
        if 'notes' in data:
            update_data['notes'] = data['notes']
        
        if not update_data:
            raise HTTPException(status_code=400, detail="No data to update")
        
        result = await db.obstacle_clusters.update_one(
            {"_id": cluster_id},
            {"$set": update_data}
        )
        
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Cluster not found")
        
        return {"success": True, "message": "Cluster updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating cluster: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error updating cluster: {str(e)}")

@api_router.delete("/admin/editor/events/{event_id}")
async def delete_event(event_id: str):
    """
    Удаление события по ID для админ-панели v3
    """
    try:
        result = await db.processed_events.delete_one({"id": event_id})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Event not found")
        return {"success": True, "message": "Event deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting event: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error deleting event: {str(e)}")

@api_router.delete("/admin/editor/clusters/{cluster_id}")
async def delete_cluster(cluster_id: str):
    """
    Удаление кластера по ID для админ-панели v3
    """
    try:
        result = await db.obstacle_clusters.delete_one({"_id": cluster_id})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Cluster not found")
        return {"success": True, "message": "Cluster deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting cluster: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error deleting cluster: {str(e)}")

@api_router.post("/admin/editor/events/bulk-delete")
async def bulk_delete_events(ids_data: dict):
    """
    Массовое удаление событий для админ-панели v3
    """
    try:
        ids = ids_data.get("ids", [])
        if not ids:
            raise HTTPException(status_code=400, detail="No IDs provided")
        
        result = await db.processed_events.delete_many({"id": {"$in": ids}})
        return {
            "success": True,
            "message": f"Deleted {result.deleted_count} events",
            "deleted_count": result.deleted_count
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error bulk deleting events: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error bulk deleting events: {str(e)}")

@api_router.post("/admin/editor/clusters/bulk-delete")
async def bulk_delete_clusters(ids_data: dict):
    """
    Массовое удаление кластеров для админ-панели v3
    """
    try:
        ids = ids_data.get("ids", [])
        if not ids:
            raise HTTPException(status_code=400, detail="No IDs provided")
        
        result = await db.obstacle_clusters.delete_many({"_id": {"$in": ids}})
        return {
            "success": True,
            "message": f"Deleted {result.deleted_count} clusters",
            "deleted_count": result.deleted_count
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error bulk deleting clusters: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error bulk deleting clusters: {str(e)}")


@api_router.get("/admin/settings/v2", response_class=HTMLResponse)
async def admin_settings_v2_api(request: Request):
    """Serve the ML settings page through /api route"""
    return templates.TemplateResponse("admin_settings_v2.html", {"request": request})

@app.get("/admin/apk-guide", response_class=HTMLResponse)
async def apk_guide(request: Request):
    """Serve the APK build guide page"""
    return templates.TemplateResponse("apk_guide.html", {"request": request})

@api_router.get("/admin/apk-guide", response_class=HTMLResponse)
async def apk_guide_api(request: Request):
    """Serve the APK build guide page through /api route"""
    return templates.TemplateResponse("apk_guide.html", {"request": request})

@app.get("/admin/ml-settings", response_class=HTMLResponse)
async def ml_settings(request: Request):
    """Serve the ML settings page"""
    return templates.TemplateResponse("ml_settings.html", {"request": request})

@api_router.get("/admin/ml-settings", response_class=HTMLResponse)
async def ml_settings_api(request: Request):
    """Serve the ML settings page through /api route"""
    return templates.TemplateResponse("ml_settings.html", {"request": request})


# Admin Index - Main navigation page
@app.get("/admin", response_class=HTMLResponse)
async def admin_index(request: Request):
    """Serve the main admin navigation page"""
    return templates.TemplateResponse("admin_index.html", {"request": request})

# Also add via API router for deployment access
@api_router.get("/admin", response_class=HTMLResponse)
async def admin_index_api(request: Request):
    """Serve the main admin navigation page via API route"""
    return templates.TemplateResponse("admin_index.html", {"request": request})

# API Endpoints documentation page
@app.get("/admin/api-docs", response_class=HTMLResponse)
async def api_endpoints_page(request: Request):
    """Serve the API endpoints documentation page"""
    return templates.TemplateResponse("api_endpoints.html", {"request": request})

@api_router.get("/admin/api-docs", response_class=HTMLResponse)
async def api_endpoints_page_api(request: Request):
    """Serve the API endpoints documentation page via API route"""
    return templates.TemplateResponse("api_endpoints.html", {"request": request})

# QR Code page endpoint (outside of /api router)
@app.get("/expo-qr", response_class=HTMLResponse)
async def expo_qr_page(request: Request):
    """Serve QR codes page for Expo Go"""
    return templates.TemplateResponse("expo_qr_page.html", {"request": request})

# Also add via API router for deployment access
@api_router.get("/expo-qr", response_class=HTMLResponse)
async def expo_qr_page_api(request: Request):
    """Serve QR codes page via API route (for deployment)"""
    return templates.TemplateResponse("expo_qr_page.html", {"request": request})

# Download endpoint for frontend archive
@app.get("/download/good-road-frontend.tar.gz")
async def download_frontend_archive():
    """Download the frontend archive for local APK building"""
    import os
    from fastapi.responses import FileResponse
    
    archive_path = "/app/good-road-frontend.tar.gz"
    
    if not os.path.exists(archive_path):
        raise HTTPException(status_code=404, detail="Archive not found")
    
    return FileResponse(
        path=archive_path,
        media_type="application/gzip",
        filename="good-road-frontend.tar.gz"
    )

# Include the router in the main app
app.include_router(api_router)

# Include admin editor router
from admin_api import get_admin_editor_router
admin_editor_router = get_admin_editor_router(db)
app.include_router(admin_editor_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Old shutdown handler removed - using new startup/shutdown events above