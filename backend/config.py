import asyncio
import logging
import os
import time
from pathlib import Path
from typing import Dict, List, Optional

from dotenv import load_dotenv
from fastapi.templating import Jinja2Templates
from motor.motor_asyncio import AsyncIOMotorClient

from clustering import ObstacleClusterer
from ml_processor import EventClassifier, WarningGenerator
from ml_stats import get_ml_stats_tracker, init_ml_stats_tracker

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ.get('MONGODB_URI') or os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
db_name = os.environ.get('MONGODB_DB_NAME') or os.environ.get('DB_NAME', 'good_road_db')

if mongo_url and '@' in mongo_url:
    masked_url = mongo_url.split('@')[0].split('://')[0] + '://***@' + mongo_url.split('@')[-1]
    logger.info("MongoDB URL configured: %s", masked_url)
else:
    logger.info("MongoDB URL configured: %s", mongo_url)

templates = Jinja2Templates(directory=str(ROOT_DIR / "templates"))

client: Optional[AsyncIOMotorClient] = None
db = None
mongodb_connected = False
obstacle_clusterer: Optional[ObstacleClusterer] = None
event_classifier = EventClassifier()
warning_generator = WarningGenerator()

_default_model_path = ROOT_DIR / "models" / "accel_lstm.pt"
if not os.environ.get("NEURAL_MODEL_PATH") and _default_model_path.exists():
    os.environ["NEURAL_MODEL_PATH"] = str(_default_model_path)

NN_INFERENCE_BACKEND = os.environ.get("NN_INFERENCE_BACKEND", "auto")
NN_DEVICE = os.environ.get("NN_DEVICE", "auto")
NN_USE_NN_BACKEND = os.environ.get("NN_USE_NN_BACKEND", "false").lower() == "true"
NN_REMOTE_GPU_URL = os.environ.get("NN_REMOTE_GPU_URL", "")
NN_AUTO_CONVERT_ONNX = os.environ.get("NN_AUTO_CONVERT_ONNX", "true").lower() == "true"

logger.info(
    "NN config: backend=%s, device=%s, use_nn_backend=%s, auto_onnx=%s",
    NN_INFERENCE_BACKEND, NN_DEVICE, NN_USE_NN_BACKEND, NN_AUTO_CONVERT_ONNX,
)

rate_limit_store: Dict[str, List[float]] = {}
RATE_LIMIT_REQUESTS = int(os.environ.get("RATE_LIMIT_REQUESTS", "30"))
RATE_LIMIT_WINDOW = int(os.environ.get("RATE_LIMIT_WINDOW", "60"))


def check_rate_limit(device_id: str) -> bool:
    now = time.time()
    window_start = now - RATE_LIMIT_WINDOW
    if device_id not in rate_limit_store:
        rate_limit_store[device_id] = []
    rate_limit_store[device_id] = [
        t for t in rate_limit_store[device_id] if t > window_start
    ]
    if len(rate_limit_store[device_id]) >= RATE_LIMIT_REQUESTS:
        return False
    rate_limit_store[device_id].append(now)
    return True


async def connect_to_mongodb(max_retries=5, retry_delay=5):
    global client, db, mongodb_connected, obstacle_clusterer
    logger.info("Attempting to connect to MongoDB database: %s", db_name)
    logger.info("MongoDB URL pattern: %s",
                mongo_url.split('@')[-1] if '@' in mongo_url else 'localhost')
    for attempt in range(1, max_retries + 1):
        try:
            client_options = {
                'serverSelectionTimeoutMS': 10000,
                'connectTimeoutMS': 20000,
                'socketTimeoutMS': 20000,
            }
            if 'mongodb+srv://' in mongo_url or 'mongodb.net' in mongo_url:
                client_options['tls'] = True
                client_options['tlsAllowInvalidCertificates'] = False
                client_options['retryWrites'] = True
                client_options['w'] = 'majority'
                logger.info("Using MongoDB Atlas with SSL/TLS enabled")
            client = AsyncIOMotorClient(mongo_url, **client_options)
            db = client[db_name]
            await client.admin.command('ping')
            mongodb_connected = True
            logger.info("Successfully connected to MongoDB database: %s", db_name)

            tracker = init_ml_stats_tracker(db)
            await tracker.load_history_from_db(hours=24)
            try:
                await db.ml_inference_logs.create_index([("timestamp", -1)])
            except Exception:
                pass
            logger.info("ML stats tracker initialized")

            obstacle_clusterer = ObstacleClusterer(db)
            logger.info("Obstacle clusterer initialized")

            try:
                await db.obstacle_clusters.create_index([("status", 1)])
                await db.obstacle_clusters.create_index([("expiresAt", 1)])
                await db.obstacle_clusters.create_index([("location.latitude", 1)])
                await db.obstacle_clusters.create_index([("location.longitude", 1)])
                logger.info("Created indexes for obstacle_clusters collection")
            except Exception as e:
                logger.warning("Could not create indexes (may already exist): %s", e)
            return
        except Exception as e:
            logger.error("MongoDB connection attempt %d/%d failed: %s", attempt, max_retries, e)
            logger.error("Error type: %s", type(e).__name__)
            if attempt < max_retries:
                logger.info("Retrying in %d seconds...", retry_delay)
                await asyncio.sleep(retry_delay)
            else:
                logger.critical("Failed to connect to MongoDB after %d attempts", max_retries)
                raise Exception(f"MongoDB connection failed after {max_retries} attempts: {e}")


async def close_mongodb_connection():
    global client, mongodb_connected
    if client:
        logger.info("Closing MongoDB connection...")
        client.close()
        mongodb_connected = False
        logger.info("MongoDB connection closed")


async def get_limits_from_db():
    try:
        from models import LimitsConfig
        doc = await db.admin_limits.find_one({"_id": "limits_config"})
        if doc:
            doc.pop("_id", None)
            return LimitsConfig(**doc)
    except Exception:
        pass
    from models import LimitsConfig
    return LimitsConfig()


async def save_limits_to_db(limits):
    await db.admin_limits.update_one(
        {"_id": "limits_config"},
        {"$set": limits.model_dump()},
        upsert=True
    )
    return limits
