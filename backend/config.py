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
from ml_stats import get_ml_stats_tracker

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

rate_limit_store: Dict[str, List[float]] = {}
RATE_LIMIT_REQUESTS = int(os.environ.get("RATE_LIMIT_REQUESTS", "30"))
RATE_LIMIT_WINDOW = int(os.environ.get("RATE_LIMIT_WINDOW", "60"))
# Max distinct device_ids kept in the sliding-window store. Without a cap,
# an attacker (or just many devices) could grow the dict unboundedly.
RATE_LIMIT_MAX_KEYS = int(os.environ.get("RATE_LIMIT_MAX_KEYS", "10000"))

# Retention (days) for idempotent replay of mobile uploads (X-Package-Id).
IDEMPOTENCY_TTL_DAYS = int(os.environ.get("IDEMPOTENCY_TTL_DAYS", "7"))


def check_rate_limit(device_id: str) -> bool:
    now = time.time()
    window_start = now - RATE_LIMIT_WINDOW

    # Evict stale buckets entirely; this also bounds memory usage.
    if len(rate_limit_store) > RATE_LIMIT_MAX_KEYS:
        for key in [k for k, v in rate_limit_store.items() if not v or v[-1] < window_start]:
            del rate_limit_store[key]
        # Still over cap: drop oldest-active buckets (LRU-ish by last hit).
        if len(rate_limit_store) > RATE_LIMIT_MAX_KEYS:
            for key in sorted(rate_limit_store, key=lambda k: rate_limit_store[k][-1] if rate_limit_store[k] else 0)[: len(rate_limit_store) - RATE_LIMIT_MAX_KEYS]:
                del rate_limit_store[key]

    bucket = rate_limit_store.setdefault(device_id, [])
    bucket[:] = [t for t in bucket if t > window_start]
    if len(bucket) >= RATE_LIMIT_REQUESTS:
        return False
    bucket.append(now)
    return True


async def ensure_indexes(db):
    """Create all required MongoDB indexes in one place.

    Idempotent: create_index on an existing spec is a no-op server-side.
    Replaces the scattered try/except-pass index creation from startup.

    Retention (TTL) collections, controlled by env vars (days; 0 disables):
      - RAW_DATA_TTL_DAYS   -> sensor_data, raw_sensor_data (default 30)
      - ML_LOGS_TTL_DAYS    -> ml_inference_logs           (default 90)
    Note: obstacle_clusters already has its own 'expiresAt' TTL logic.
    """
    raw_ttl_days = int(os.environ.get("RAW_DATA_TTL_DAYS", "30"))
    ml_ttl_days = int(os.environ.get("ML_LOGS_TTL_DAYS", "90"))

    # Hot query paths: device_id + timestamp range scans
    await db.sensor_data.create_index([("device_id", 1), ("timestamp", -1)])
    await db.raw_sensor_data.create_index([("device_id", 1), ("timestamp", -1)])
    await db.processed_events.create_index([("timestamp", -1)])
    await db.processed_events.create_index(
        [("device_id", 1), ("timestamp", -1)]
    )
    await db.ml_inference_logs.create_index([("timestamp", -1)])

    # Obstacle clusters: status lookups + geo queries + expiry
    await db.obstacle_clusters.create_index([("status", 1)])
    await db.obstacle_clusters.create_index([("expiresAt", 1)])
    await db.obstacle_clusters.create_index([("location.latitude", 1)])
    await db.obstacle_clusters.create_index([("location.longitude", 1)])

    # Automatic retention for unbounded growth (TTL on ingest time field).
    if raw_ttl_days > 0:
        expire_after = raw_ttl_days * 86400
        await db.sensor_data.create_index(
            [("timestamp", 1)], expireAfterSeconds=expire_after,
            name="ttl_sensor_data",
        )
        await db.raw_sensor_data.create_index(
            [("timestamp", 1)], expireAfterSeconds=expire_after,
            name="ttl_raw_sensor_data",
        )
        logger.info("TTL indexes enabled for raw data (%d days)", raw_ttl_days)
    if ml_ttl_days > 0:
        await db.ml_inference_logs.create_index(
            [("timestamp", 1)],
            expireAfterSeconds=ml_ttl_days * 86400,
            name="ttl_ml_inference_logs",
        )
        logger.info("TTL index enabled for ml_inference_logs (%d days)", ml_ttl_days)

    # Idempotency store for retried mobile uploads (X-Package-Id).
    await db.api_idempotency.create_index(
        [("expires_at", 1)],
        expireAfterSeconds=IDEMPOTENCY_TTL_DAYS * 86400,
        name="ttl_api_idempotency",
    )

    logger.info("MongoDB indexes ensured")


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
            # Centralized index management (see ensure_indexes below).
            try:
                await ensure_indexes(db)
            except Exception as e:
                logger.warning("ensure_indexes failed (non-fatal): %s", e)
            logger.info("ML stats tracker initialized")

            obstacle_clusterer = ObstacleClusterer(db)
            logger.info("Obstacle clusterer initialized")
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
