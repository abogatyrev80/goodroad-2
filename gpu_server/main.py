import os
import sys
import asyncio
import logging
from fastapi import FastAPI
from contextlib import asynccontextmanager

sys.path.insert(0, os.path.dirname(__file__))

import config

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("gpu_server")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("GPU Server starting")
    logger.info("Main server: %s", config.MAIN_SERVER_URL)
    logger.info("Output dir: %s", config.MODEL_OUTPUT_DIR)

    poller_config = {
        "main_server_url": config.MAIN_SERVER_URL,
        "api_key": config.API_KEY,
        "webhook_secret": config.WEBHOOK_SECRET,
        "webhook_url": config.WEBHOOK_URL,
        "poll_interval": config.POLL_INTERVAL,
        "output_dir": config.MODEL_OUTPUT_DIR,
        "lr": config.LEARNING_RATE,
    }

    from polling.poller import poll_loop
    task = asyncio.create_task(poll_loop(poller_config))
    logger.info("Poll loop background task started")

    yield

    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    logger.info("GPU Server stopped")


app = FastAPI(title="Good Road GPU Training Server", lifespan=lifespan)


@app.get("/health")
async def health():
    import torch
    gpu_available = torch.cuda.is_available()
    gpu_name = torch.cuda.get_device_name(0) if gpu_available else "none"
    return {
        "status": "healthy",
        "gpu_available": gpu_available,
        "gpu_name": gpu_name,
        "main_server": config.MAIN_SERVER_URL,
        "output_dir": config.MODEL_OUTPUT_DIR,
    }


@app.post("/api/internal/train-now")
async def train_now(dataset_id: str = None, epochs: int = 50, batch_size: int = 64):
    from polling.poller import _poll_once
    poller_config = {
        "main_server_url": config.MAIN_SERVER_URL,
        "api_key": config.API_KEY,
        "webhook_secret": config.WEBHOOK_SECRET,
        "webhook_url": config.WEBHOOK_URL,
        "poll_interval": config.POLL_INTERVAL,
        "output_dir": config.MODEL_OUTPUT_DIR,
        "lr": config.LEARNING_RATE,
    }
    asyncio.create_task(_poll_once(
        config.MAIN_SERVER_URL,
        {"X-Api-Key": config.API_KEY},
        config.WEBHOOK_SECRET,
        config.WEBHOOK_URL,
        config.MODEL_OUTPUT_DIR,
        poller_config,
    ))
    return {"message": "Training triggered", "dataset_id": dataset_id}


if __name__ == "__main__":
    import uvicorn
    os.makedirs(config.MODEL_OUTPUT_DIR, exist_ok=True)
    uvicorn.run(app, host="0.0.0.0", port=8002)
