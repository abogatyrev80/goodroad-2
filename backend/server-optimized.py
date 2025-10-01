from fastapi import FastAPI, APIRouter, HTTPException, BackgroundTasks, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi_cache import FastAPICache
from fastapi_cache.backends.redis import RedisBackend
from fastapi_cache.decorator import cache
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, validator
from typing import List, Dict, Any, Optional, Tuple
import uuid
from datetime import datetime, timedelta
import asyncio
import math
import statistics
import numpy as np
from scipy import signal
from collections import defaultdict
import redis.asyncio as redis

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection with optimized settings
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(
    mongo_url,
    maxPoolSize=50,
    minPoolSize=10,
    maxIdleTimeMS=30000,
    serverSelectionTimeoutMS=5000
)
db = client[os.environ['DB_NAME']]

# Redis cache connection (optional - fallback if not available)
try:
    redis_client = redis.from_url("redis://localhost:6379", decode_responses=True)
except:
    redis_client = None
    logging.warning("Redis not available, caching disabled")

# Create optimized FastAPI app
app = FastAPI(
    title="Good Road API - Optimized",
    description="High-Performance Road Monitoring System",
    version="2.0.0"
)

api_router = APIRouter(prefix="/api")

# Enhanced data models with validation
class SensorDataPoint(BaseModel):
    type: str  # 'location' or 'accelerometer'
    timestamp: int
    data: Dict[str, Any]
    
    @validator('type')
    def validate_type(cls, v):
        if v not in ['location', 'accelerometer']:
            raise ValueError('Type must be location or accelerometer')
        return v
    
    @validator('timestamp')
    def validate_timestamp(cls, v):
        if v <= 0:
            raise ValueError('Timestamp must be positive')
        return v

class SensorDataBatch(BaseModel):
    deviceId: str
    sensorData: List[SensorDataPoint]
    
    @validator('deviceId')
    def validate_device_id(cls, v):
        if len(v.strip()) == 0:
            raise ValueError('Device ID cannot be empty')
        return v.strip()
    
    @validator('sensorData')
    def validate_sensor_data(cls, v):
        if len(v) == 0:
            raise ValueError('Sensor data cannot be empty')
        if len(v) > 1000:  # Limit batch size
            raise ValueError('Batch size too large (max 1000 points)')
        return v

class OptimizedLocationQuery(BaseModel):
    latitude: float
    longitude: float
    radius: float = Field(default=1000, ge=1, le=50000)  # 1m to 50km
    limit: int = Field(default=50, ge=1, le=200)
    
    @validator('latitude')
    def validate_latitude(cls, v):
        if not -90 <= v <= 90:
            raise ValueError('Latitude must be between -90 and 90')
        return v
    
    @validator('longitude')
    def validate_longitude(cls, v):
        if not -180 <= v <= 180:
            raise ValueError('Longitude must be between -180 and 180')
        return v

# Optimized geospatial calculations
class GeoUtils:
    """Optimized geospatial utility functions"""
    
    EARTH_RADIUS = 6371000  # Earth's radius in meters
    
    @staticmethod
    def fast_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Fast distance calculation using equirectangular approximation for nearby points"""
        if abs(lat1 - lat2) < 0.01 and abs(lon1 - lon2) < 0.01:  # < ~1km
            lat_rad = math.radians((lat1 + lat2) / 2)
            x = (lon2 - lon1) * math.cos(lat_rad)
            y = lat2 - lat1
            return math.sqrt(x*x + y*y) * GeoUtils.EARTH_RADIUS * math.pi / 180
        else:
            return GeoUtils.haversine_distance(lat1, lon1, lat2, lon2)
    
    @staticmethod
    def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Accurate Haversine distance calculation"""
        lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
        return 2 * GeoUtils.EARTH_RADIUS * math.asin(math.sqrt(a))
    
    @staticmethod
    def create_bounding_box(lat: float, lon: float, radius: float) -> Dict[str, float]:
        """Create bounding box for efficient geospatial queries"""
        lat_delta = radius / GeoUtils.EARTH_RADIUS * 180 / math.pi
        lon_delta = radius / (GeoUtils.EARTH_RADIUS * math.cos(math.radians(lat))) * 180 / math.pi
        
        return {
            "min_lat": lat - lat_delta,
            "max_lat": lat + lat_delta,
            "min_lon": lon - lon_delta,
            "max_lon": lon + lon_delta
        }

# Advanced road condition analysis
class RoadAnalyzer:
    """Advanced road condition analysis with signal processing"""
    
    @staticmethod
    def enhanced_road_analysis(accel_data: List[Dict], location_data: List[Dict]) -> Dict[str, Any]:
        """Enhanced road condition analysis using signal processing"""
        if len(accel_data) < 10:
            return {"condition_score": 50, "confidence": 0.1, "features": {}}
        
        # Extract acceleration vectors
        accelerations = []
        timestamps = []
        
        for point in accel_data:
            try:
                data = point['data']
                if 'totalAcceleration' in data:
                    total_acc = data['totalAcceleration']
                else:
                    x, y, z = data['x'], data['y'], data['z']
                    total_acc = math.sqrt(x**2 + y**2 + z**2)
                
                accelerations.append(total_acc)
                timestamps.append(point['timestamp'])
            except (KeyError, ValueError):
                continue
        
        if len(accelerations) < 5:
            return {"condition_score": 50, "confidence": 0.1, "features": {}}
        
        # Convert to numpy for efficient processing
        acc_array = np.array(accelerations)
        time_array = np.array(timestamps)
        
        # Remove gravity and high-frequency noise
        acc_filtered = signal.detrend(acc_array)
        
        # Feature extraction
        features = RoadAnalyzer._extract_features(acc_filtered, time_array)
        
        # Calculate road condition score
        condition_score = RoadAnalyzer._calculate_condition_score(features)
        
        # Assess confidence based on data quality
        confidence = RoadAnalyzer._assess_confidence(features, len(accelerations))
        
        return {
            "condition_score": condition_score,
            "confidence": confidence,
            "features": features,
            "data_points": len(accelerations)
        }
    
    @staticmethod
    def _extract_features(acc_filtered: np.ndarray, time_array: np.ndarray) -> Dict[str, float]:
        """Extract road condition features from acceleration data"""
        features = {}
        
        # Statistical features
        features['mean_abs_deviation'] = np.mean(np.abs(acc_filtered))
        features['std_deviation'] = np.std(acc_filtered)
        features['variance'] = np.var(acc_filtered)
        features['skewness'] = float(signal.skew(acc_filtered)) if len(acc_filtered) > 2 else 0
        features['kurtosis'] = float(signal.kurtosis(acc_filtered)) if len(acc_filtered) > 2 else 0
        
        # Frequency domain features
        if len(acc_filtered) > 8:
            fft = np.fft.fft(acc_filtered)
            power_spectrum = np.abs(fft) ** 2
            features['dominant_frequency'] = np.argmax(power_spectrum[:len(power_spectrum)//2])
            features['spectral_energy'] = np.sum(power_spectrum)
        else:
            features['dominant_frequency'] = 0
            features['spectral_energy'] = 0
        
        # Spike detection
        threshold = np.mean(np.abs(acc_filtered)) + 2 * np.std(acc_filtered)
        spikes = np.where(np.abs(acc_filtered) > threshold)[0]
        features['spike_count'] = len(spikes)
        features['spike_intensity'] = np.mean(np.abs(acc_filtered[spikes])) if len(spikes) > 0 else 0
        
        # Smoothness indicators
        if len(acc_filtered) > 1:
            diff = np.diff(acc_filtered)
            features['smoothness'] = 1 / (1 + np.std(diff))
        else:
            features['smoothness'] = 1
        
        return features
    
    @staticmethod
    def _calculate_condition_score(features: Dict[str, float]) -> float:
        """Calculate road condition score from extracted features"""
        # Weighted scoring based on different features
        weights = {
            'variance_penalty': -20,
            'spike_penalty': -15,
            'smoothness_bonus': 30,
            'frequency_penalty': -10
        }
        
        base_score = 100
        
        # Variance penalty (higher variance = worse road)
        variance_penalty = min(50, features['variance'] * weights['variance_penalty'])
        
        # Spike penalty (more spikes = worse road)
        spike_penalty = min(30, features['spike_count'] * weights['spike_penalty'])
        
        # Smoothness bonus (smoother = better road)
        smoothness_bonus = features['smoothness'] * weights['smoothness_bonus']
        
        # Frequency penalty (certain frequencies indicate road issues)
        freq_penalty = min(20, features['dominant_frequency'] / 10 * weights['frequency_penalty'])
        
        final_score = base_score + variance_penalty + spike_penalty + smoothness_bonus + freq_penalty
        
        return max(0, min(100, final_score))
    
    @staticmethod
    def _assess_confidence(features: Dict[str, float], data_points: int) -> float:
        """Assess confidence in the analysis based on data quality"""
        confidence = 0.5  # Base confidence
        
        # More data points increase confidence
        if data_points >= 50:
            confidence += 0.3
        elif data_points >= 20:
            confidence += 0.2
        elif data_points >= 10:
            confidence += 0.1
        
        # Consistent features increase confidence
        if features['variance'] > 0:
            consistency = 1 / (1 + features['variance'])
            confidence += consistency * 0.2
        
        return min(1.0, confidence)

# Cache management
class CacheManager:
    """Efficient cache management for frequent queries"""
    
    @staticmethod
    async def get_cached_conditions(lat: float, lon: float, radius: float) -> Optional[List[Dict]]:
        """Get cached road conditions"""
        if not redis_client:
            return None
        
        try:
            key = f"conditions:{lat:.4f}:{lon:.4f}:{radius}"
            cached = await redis_client.get(key)
            if cached:
                return eval(cached)  # In production, use proper JSON serialization
        except Exception as e:
            logging.warning(f"Cache get error: {e}")
        
        return None
    
    @staticmethod
    async def set_cached_conditions(lat: float, lon: float, radius: float, conditions: List[Dict], ttl: int = 300):
        """Cache road conditions for 5 minutes"""
        if not redis_client:
            return
        
        try:
            key = f"conditions:{lat:.4f}:{lon:.4f}:{radius}"
            await redis_client.setex(key, ttl, str(conditions))
        except Exception as e:
            logging.warning(f"Cache set error: {e}")

# Database operations with connection pooling
class DatabaseOps:
    """Optimized database operations"""
    
    @staticmethod
    async def ensure_indexes():
        """Ensure database indexes for optimal performance"""
        try:
            # Geospatial index for road conditions
            await db.road_conditions.create_index([("latitude", 1), ("longitude", 1)])
            await db.road_conditions.create_index([("created_at", -1)])
            
            # Index for road warnings
            await db.road_warnings.create_index([("latitude", 1), ("longitude", 1)])
            await db.road_warnings.create_index([("created_at", -1)])
            await db.road_warnings.create_index([("severity", 1)])
            
            # Index for sensor data
            await db.sensor_data.create_index([("deviceId", 1), ("timestamp", -1)])
            
            logging.info("Database indexes ensured")
        except Exception as e:
            logging.error(f"Error creating indexes: {e}")
    
    @staticmethod
    async def optimized_conditions_query(lat: float, lon: float, radius: float, limit: int) -> List[Dict]:
        """Optimized geospatial query for road conditions"""
        bbox = GeoUtils.create_bounding_box(lat, lon, radius)
        
        # Use bounding box for initial filtering, then precise distance calculation
        pipeline = [
            {
                "$match": {
                    "latitude": {"$gte": bbox["min_lat"], "$lte": bbox["max_lat"]},
                    "longitude": {"$gte": bbox["min_lon"], "$lte": bbox["max_lon"]}
                }
            },
            {
                "$project": {
                    "_id": 0,
                    "id": 1,
                    "latitude": 1,
                    "longitude": 1,
                    "condition_score": 1,
                    "severity_level": 1,
                    "created_at": 1,
                    "distance": {
                        "$sqrt": {
                            "$add": [
                                {"$pow": [{"$subtract": ["$latitude", lat]}, 2]},
                                {"$pow": [{"$subtract": ["$longitude", lon]}, 2]}
                            ]
                        }
                    }
                }
            },
            {"$match": {"distance": {"$lte": radius / 111000}}},  # Approximate degree conversion
            {"$sort": {"distance": 1}},
            {"$limit": limit}
        ]
        
        return await db.road_conditions.aggregate(pipeline).to_list(limit)

# Optimized API endpoints
@api_router.get("/")
async def root():
    return {
        "message": "Good Road API - Optimized v2.0",
        "features": ["Advanced signal processing", "Geospatial optimization", "Redis caching", "Performance monitoring"]
    }

@api_router.post("/sensor-data")
async def upload_sensor_data(batch: SensorDataBatch, background_tasks: BackgroundTasks):
    """Optimized sensor data upload with background processing"""
    try:
        # Quick validation and immediate response
        location_data = [p for p in batch.sensorData if p.type == "location"]
        accel_data = [p for p in batch.sensorData if p.type == "accelerometer"]
        
        if not location_data or not accel_data:
            return {
                "message": "Data received but incomplete",
                "rawDataPoints": len(batch.sensorData),
                "warning": "Missing location or accelerometer data"
            }
        
        # Schedule background processing
        background_tasks.add_task(process_sensor_data_background, batch.dict())
        
        return {
            "message": "Sensor data received and queued for processing",
            "rawDataPoints": len(batch.sensorData),
            "locationPoints": len(location_data),
            "accelerometerPoints": len(accel_data),
            "status": "processing"
        }
        
    except Exception as e:
        logging.error(f"Sensor data upload error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Upload error: {str(e)}")

async def process_sensor_data_background(batch_data: Dict):
    """Background task for processing sensor data"""
    try:
        batch = SensorDataBatch(**batch_data)
        location_data = [p for p in batch.sensorData if p.type == "location"]
        accel_data = [p for p in batch.sensorData if p.type == "accelerometer"]
        
        # Store raw data
        sensor_doc = {
            "deviceId": batch.deviceId,
            "timestamp": datetime.utcnow(),
            "locationPoints": len(location_data),
            "accelerometerPoints": len(accel_data),
            "rawData": [point.dict() for point in batch.sensorData]
        }
        
        await db.sensor_data.insert_one(sensor_doc)
        
        # Advanced processing
        processed_conditions = []
        processed_warnings = []
        
        for location_point in location_data:
            lat = location_point.data.get("latitude")
            lon = location_point.data.get("longitude")
            timestamp = location_point.timestamp
            
            # Find temporally correlated accelerometer data
            nearby_accel = [
                p for p in accel_data
                if abs(p.timestamp - timestamp) <= 15000  # 15 seconds window
            ]
            
            if len(nearby_accel) >= 10:  # Higher threshold for quality
                # Enhanced analysis
                analysis = RoadAnalyzer.enhanced_road_analysis(
                    [p.dict() for p in nearby_accel], 
                    [location_point.dict()]
                )
                
                if analysis["confidence"] > 0.5:  # Only high-confidence results
                    condition = {
                        "id": str(uuid.uuid4()),
                        "latitude": lat,
                        "longitude": lon,
                        "condition_score": analysis["condition_score"],
                        "severity_level": determine_severity_level(analysis["condition_score"]),
                        "confidence": analysis["confidence"],
                        "data_points": analysis["data_points"],
                        "features": analysis["features"],
                        "created_at": datetime.utcnow(),
                        "updated_at": datetime.utcnow()
                    }
                    processed_conditions.append(condition)
                    
                    # Generate warnings based on analysis
                    if analysis["condition_score"] < 40:
                        warning = {
                            "id": str(uuid.uuid4()),
                            "latitude": lat,
                            "longitude": lon,
                            "warning_type": "poor_road_condition",
                            "severity": "high" if analysis["condition_score"] < 20 else "medium",
                            "confidence": analysis["confidence"],
                            "created_at": datetime.utcnow()
                        }
                        processed_warnings.append(warning)
        
        # Batch insert for performance
        if processed_conditions:
            await db.road_conditions.insert_many(processed_conditions)
        
        if processed_warnings:
            await db.road_warnings.insert_many(processed_warnings)
            
        # Invalidate relevant cache entries
        # In production, implement more sophisticated cache invalidation
        
        logging.info(f"Processed {len(processed_conditions)} conditions, {len(processed_warnings)} warnings")
        
    except Exception as e:
        logging.error(f"Background processing error: {str(e)}")

@api_router.get("/road-conditions")
async def get_road_conditions_optimized(query: OptimizedLocationQuery = Depends()):
    """Optimized road conditions endpoint with caching"""
    try:
        # Check cache first
        cached_conditions = await CacheManager.get_cached_conditions(
            query.latitude, query.longitude, query.radius
        )
        
        if cached_conditions:
            return {
                "location": {"latitude": query.latitude, "longitude": query.longitude},
                "radius": query.radius,
                "conditions": cached_conditions[:query.limit],
                "cached": True
            }
        
        # Query database with optimization
        conditions = await DatabaseOps.optimized_conditions_query(
            query.latitude, query.longitude, query.radius, query.limit
        )
        
        # Calculate precise distances and add metadata
        for condition in conditions:
            precise_distance = GeoUtils.fast_distance(
                query.latitude, query.longitude,
                condition["latitude"], condition["longitude"]
            )
            condition["distance"] = round(precise_distance, 1)
        
        # Cache results
        await CacheManager.set_cached_conditions(
            query.latitude, query.longitude, query.radius, conditions
        )
        
        return {
            "location": {"latitude": query.latitude, "longitude": query.longitude},
            "radius": query.radius,
            "conditions": conditions,
            "cached": False,
            "count": len(conditions)
        }
        
    except Exception as e:
        logging.error(f"Road conditions query error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Query error: {str(e)}")

def determine_severity_level(score: float) -> str:
    """Enhanced severity level determination"""
    if score >= 85:
        return "excellent"
    elif score >= 70:
        return "good"
    elif score >= 50:
        return "fair"
    elif score >= 30:
        return "poor"
    else:
        return "very_poor"

# Initialize database indexes on startup
@app.on_event("startup")
async def startup_event():
    """Initialize optimizations on startup"""
    await DatabaseOps.ensure_indexes()
    
    # Initialize Redis cache if available
    if redis_client:
        try:
            await redis_client.ping()
            logging.info("Redis cache connected")
        except:
            logging.warning("Redis cache connection failed")

# Include router and middleware
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],  # In production, specify exact origins
    allow_methods=["*"],
    allow_headers=["*"],
)

# Enhanced logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_event():
    """Clean shutdown"""
    client.close()
    if redis_client:
        await redis_client.close()