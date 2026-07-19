import os
import asyncio
import logging
import httpx
import time

logger = logging.getLogger(__name__)


async def poll_loop(config: dict):
    main_url = config["main_server_url"]
    api_key = config["api_key"]
    webhook_secret = config.get("webhook_secret", "")
    webhook_url = config.get("webhook_url", "")
    poll_interval = config.get("poll_interval", 300)
    output_dir = config.get("output_dir", "/data/models")

    headers = {"X-Api-Key": api_key}

    logger.info("Poll loop started: server=%s interval=%ds", main_url, poll_interval)

    while True:
        try:
            await _poll_once(main_url, headers, webhook_secret, webhook_url, output_dir, config)
        except Exception as e:
            logger.error("Poll cycle error: %s", e)
        await asyncio.sleep(poll_interval)


async def _poll_once(main_url, headers, webhook_secret, webhook_url, output_dir, config):
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(f"{main_url}/api/external/training/status", headers=headers)
        if resp.status_code != 200:
            logger.warning("Status check failed: %d", resp.status_code)
            return
        status = resp.json()

    latest_run = status.get("latest_run")
    if not latest_run or latest_run.get("status") != "pending":
        return

    run_id = latest_run.get("run_id", "unknown")
    dataset_id = latest_run.get("dataset_id")
    epochs = latest_run.get("epochs", 50)
    batch_size = latest_run.get("batch_size", 64)
    seq_len = latest_run.get("seq_len", 32)

    if not dataset_id:
        logger.warning("Run %s has no dataset_id", run_id)
        return

    logger.info("Found pending run %s (dataset=%s)", run_id, dataset_id)

    from training.dataset_loader import download_dataset
    dataset_path = await download_dataset(main_url, api_key, dataset_id)
    logger.info("Dataset downloaded to %s", dataset_path)

    from training.train import train
    train_config = {
        "window_size": seq_len,
        "epochs": epochs,
        "batch_size": batch_size,
        "lr": config.get("lr", 1e-3),
        "num_classes": 5,
    }

    start = time.time()
    result = train(dataset_path, output_dir, train_config)
    elapsed = time.time() - start

    if "error" in result:
        logger.error("Training failed: %s", result["error"])
        await _send_webhook(main_url, webhook_secret, dataset_id, "failed", {}, {})
        return

    pt_path = result.get("pt_path", "")
    accuracy = result.get("accuracy", 0)
    val_accuracy = result.get("val_accuracy", 0)

    model_url = await _upload_model(main_url, headers, pt_path, dataset_id, accuracy, val_accuracy)

    await _send_webhook(
        main_url, webhook_secret, dataset_id, "completed",
        {"accuracy": accuracy, "val_accuracy": val_accuracy,
         "model_download_url": model_url, "training_time_seconds": elapsed,
         "notes": f"GPU training complete. {result.get('device', 'unknown')}"},
        headers,
    )

    logger.info("Run %s complete: accuracy=%.3f time=%.1fs", run_id, accuracy, elapsed)


async def _upload_model(main_url, headers, pt_path, dataset_id, accuracy, val_accuracy):
    if not pt_path or not os.path.exists(pt_path):
        return ""
    url = f"{main_url}/api/external/model/upload"
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            with open(pt_path, "rb") as f:
                resp = await client.post(
                    url, headers=headers,
                    files={"file": (os.path.basename(pt_path), f, "application/octet-stream")},
                    data={"dataset_id": dataset_id, "accuracy": str(accuracy),
                          "val_accuracy": str(val_accuracy), "notes": "Auto-uploaded from GPU server"},
                )
            if resp.status_code == 200:
                model_id = resp.json().get("model_id", "")
                logger.info("Model uploaded: %s", model_id)
                return f"{main_url}/api/external/model/{model_id}"
    except Exception as e:
        logger.error("Model upload failed: %s", e)
    return ""


async def _send_webhook(main_url, webhook_secret, dataset_id, status, extra, headers=None):
    url = f"{main_url}/api/external/webhook/training-complete"
    body = {"dataset_id": dataset_id, "status": status, **extra}
    hdrs = {"Content-Type": "application/json"}
    if webhook_secret:
        hdrs["X-Webhook-Secret"] = webhook_secret
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, json=body, headers=hdrs)
            logger.info("Webhook sent: status=%s code=%d", status, resp.status_code)
    except Exception as e:
        logger.error("Webhook failed: %s", e)
