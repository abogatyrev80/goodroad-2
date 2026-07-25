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
        "command_poll_interval": config.COMMAND_POLL_INTERVAL,
        "machine_id": config.MACHINE_ID,
        "output_dir": config.MODEL_OUTPUT_DIR,
        "lr": config.LEARNING_RATE,
    }

    from polling.poller import poll_loop
    task = asyncio.create_task(poll_loop(poller_config))
    logger.info("Poll loop background task started (machine_id=%s)", config.MACHINE_ID)

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
        "machine_id": config.MACHINE_ID,
    }


@app.get("/api/status")
async def detailed_status():
    import torch
    gpu_available = torch.cuda.is_available()
    gpu_name = torch.cuda.get_device_name(0) if gpu_available else "none"
    return {
        "machine_id": config.MACHINE_ID,
        "gpu_available": gpu_available,
        "gpu_name": gpu_name,
        "main_server": config.MAIN_SERVER_URL,
        "output_dir": config.MODEL_OUTPUT_DIR,
        "training_active": _training_active,
        "current_run": _current_run,
    }


_training_active = False
_current_run = None


@app.post("/api/webhook/trigger")
async def webhook_trigger(body: dict):
    global _training_active, _current_run
    command = body.get("command", "")
    params = body.get("params", {})
    command_id = body.get("command_id", "")

    logger.info("Webhook trigger received: command=%s params=%s", command, params)

    if command == "train":
        dataset_id = params.get("dataset_id")
        epochs = params.get("epochs", 50)
        batch_size = params.get("batch_size", 64)
        seq_len = params.get("seq_len", 32)

        if not dataset_id:
            return {"error": "dataset_id required"}

        _training_active = True
        _current_run = {"command_id": command_id, "dataset_id": dataset_id}

        poller_config = {
            "main_server_url": config.MAIN_SERVER_URL,
            "api_key": config.API_KEY,
            "webhook_secret": config.WEBHOOK_SECRET,
            "webhook_url": config.WEBHOOK_URL,
            "poll_interval": config.POLL_INTERVAL,
            "output_dir": config.MODEL_OUTPUT_DIR,
            "lr": config.LEARNING_RATE,
        }

        from polling.poller import _execute_training
        asyncio.create_task(_run_training_wrapper(
            poller_config, dataset_id, epochs, batch_size, seq_len, command_id,
        ))

        return {"message": "Training started", "dataset_id": dataset_id}

    elif command == "stop":
        logger.info("Stop command received")
        return {"message": "Stop acknowledged"}

    elif command == "restart":
        logger.info("Restart command received")
        return {"message": "Restart acknowledged"}

    return {"error": f"Unknown command: {command}"}


async def _run_training_wrapper(poller_config, dataset_id, epochs, batch_size, seq_len, command_id):
    global _training_active, _current_run
    try:
        from polling.poller import _execute_training
        await _execute_training(
            config.MAIN_SERVER_URL,
            {"X-Api-Key": config.API_KEY},
            config.WEBHOOK_SECRET,
            config.WEBHOOK_URL,
            config.MODEL_OUTPUT_DIR,
            poller_config,
            dataset_id=dataset_id,
            epochs=epochs,
            batch_size=batch_size,
            seq_len=seq_len,
        )
    except Exception as e:
        logger.error("Training failed: %s", e)
    finally:
        _training_active = False
        _current_run = None


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
