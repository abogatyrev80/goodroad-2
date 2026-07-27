import os
import uuid
import asyncio
import logging
from datetime import datetime, timedelta
import httpx
import time

logger = logging.getLogger(__name__)


async def poll_loop(config: dict):
    main_url = config["main_server_url"]
    api_key = config["api_key"]
    webhook_secret = config.get("webhook_secret", "")
    webhook_url = config.get("webhook_url", "")
    poll_interval = config.get("poll_interval", 30)
    output_dir = config.get("output_dir", "/data/models")
    command_poll_interval = config.get("command_poll_interval", 30)
    machine_id = config.get("machine_id", "")

    headers = {"X-Api-Key": api_key}

    logger.info("Poll loop started: server=%s interval=%ds", main_url, poll_interval)

    while True:
        try:
            await _poll_once(main_url, headers, webhook_secret, webhook_url, output_dir, config)
        except Exception as e:
            logger.error("Poll cycle error: %s", e)

        if machine_id:
            try:
                await _poll_commands(main_url, headers, machine_id, output_dir, config)
            except Exception as e:
                logger.error("Command poll error: %s", e)

        if machine_id:
            try:
                await _send_heartbeat(main_url, headers, machine_id)
            except Exception as e:
                logger.error("Heartbeat error: %s", e)

        await asyncio.sleep(poll_interval)


async def _send_heartbeat(main_url, headers, machine_id):
    import torch
    gpu_available = torch.cuda.is_available()
    gpu_name = torch.cuda.get_device_name(0) if gpu_available else ""
    body = {
        "gpu_available": gpu_available,
        "gpu_name": gpu_name,
        "training_active": False,
        "current_run": None,
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{main_url}/api/admin/gpu-machines/{machine_id}/heartbeat",
            json=body, headers=headers,
        )
        if resp.status_code == 200:
            logger.debug("Heartbeat sent: %s", machine_id)


async def _poll_commands(main_url, headers, machine_id, output_dir, config):
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{main_url}/api/admin/gpu-machines/{machine_id}/commands",
            headers=headers,
        )
        if resp.status_code != 200:
            return
        data = resp.json()

    commands = data.get("commands", [])
    if not commands:
        return

    logger.info("Received %d pending commands", len(commands))

    for cmd in commands:
        command_id = cmd.get("command_id", "")
        command = cmd.get("command", "")
        params = cmd.get("params", {})

        if command == "train":
            dataset_id = params.get("dataset_id")
            epochs = params.get("epochs", 50)
            batch_size = params.get("batch_size", 64)
            seq_len = params.get("seq_len", 32)

            if not dataset_id:
                await _complete_command(main_url, command_id, {"error": "no dataset_id"})
                continue

            logger.info("Executing train command: dataset=%s epochs=%d", dataset_id, epochs)

            await _execute_training(
                main_url, headers, config.get("webhook_secret", ""),
                config.get("webhook_url", ""), output_dir, config,
                dataset_id=dataset_id, epochs=epochs,
                batch_size=batch_size, seq_len=seq_len,
            )

            await _complete_command(main_url, command_id, {"status": "completed"})

        elif command == "recalculate":
            logger.info("Executing recalculate command")
            try:
                result = await _execute_recalculate(main_url, headers, config)
                await _complete_command(main_url, command_id, result)
            except Exception as e:
                logger.error("Recalculate failed: %s", e)
                await _fail_command(main_url, command_id, str(e))

        else:
            logger.warning("Unknown command: %s", command)
            await _fail_command(main_url, command_id, f"Unknown command: {command}")


async def _complete_command(main_url, command_id, result):
    async with httpx.AsyncClient(timeout=30) as client:
        await client.post(
            f"{main_url}/api/admin/gpu-machines/commands/{command_id}/complete",
            json=result,
        )


async def _fail_command(main_url, command_id, error):
    async with httpx.AsyncClient(timeout=30) as client:
        await client.post(
            f"{main_url}/api/admin/gpu-machines/commands/{command_id}/fail",
            json={"error": error},
        )


async def _poll_once(main_url, headers, webhook_secret, webhook_url, output_dir, config):
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(f"{main_url}/api/external/training/status", headers=headers)
        if resp.status_code != 200:
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

    await _execute_training(
        main_url, headers, webhook_secret, webhook_url, output_dir, config,
        dataset_id=dataset_id, epochs=epochs, batch_size=batch_size, seq_len=seq_len,
    )


async def _execute_training(main_url, headers, webhook_secret, webhook_url, output_dir, config, dataset_id, epochs=50, batch_size=64, seq_len=32):
    from training.dataset_loader import download_dataset
    dataset_path = await download_dataset(main_url, config.get("api_key", ""), dataset_id)
    logger.info("Dataset downloaded to %s", dataset_path)

    from training.train import train
    import functools
    train_config = {
        "window_size": seq_len,
        "epochs": epochs,
        "batch_size": batch_size,
        "lr": config.get("lr", 1e-3),
        "num_classes": 5,
    }

    start = time.time()
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None, functools.partial(train, dataset_path, output_dir, train_config)
    )
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

    logger.info("Training complete: dataset=%s accuracy=%.3f time=%.1fs", dataset_id, accuracy, elapsed)


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


# ─── Recalculate Clusters ────────────────────────────────────────────────────

CLUSTER_RADIUS = 15.0
COMPATIBLE_GROUPS = [
    {'pothole', 'bump'},
    {'speed_bump'},
    {'braking'},
    {'vibration'},
]


def _haversine(lat1, lon1, lat2, lon2):
    import math
    R = 6371000
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _types_compatible(t1, t2):
    for group in COMPATIBLE_GROUPS:
        if t1 in group and t2 in group:
            return True
    return False


async def _execute_recalculate(main_url, headers, config):
    logger.info("Starting recalculate: downloading events from %s", main_url)

    all_events = []
    skip = 0
    limit = 50000
    while True:
        url = f"{main_url}/api/admin/v2/events?limit={limit}&skip={skip}"
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code != 200:
                logger.error("Failed to fetch events: %d", resp.status_code)
                break
            data = resp.json()
            events = data.get("events", [])
            all_events.extend(events)
            skip += limit
            logger.info("  Downloaded %d events (total %d)", len(events), len(all_events))
            if len(events) < limit:
                break

    logger.info("Total events downloaded: %d", len(all_events))

    clusters = {}
    processed = 0
    skipped = 0

    for ev in all_events:
        lat = ev.get("latitude")
        lon = ev.get("longitude")
        etype = ev.get("eventType")
        if not lat or not lon or not etype:
            skipped += 1
            continue

        device_id = ev.get("deviceId", "unknown")
        severity = ev.get("severity", 3)
        confidence = ev.get("confidence", 0.7)
        speed = ev.get("speed", 0)
        ts_str = ev.get("timestamp", "")

        # Find matching cluster
        found = None
        for cid, cl in clusters.items():
            dist = _haversine(lat, lon, cl["location"]["latitude"], cl["location"]["longitude"])
            if dist < CLUSTER_RADIUS and _types_compatible(etype, cl["obstacleType"]):
                found = cid
                break

        if found:
            cl = clusters[found]
            if device_id not in cl["devices"]:
                cl["devices"].append(device_id)
                cl["reportCount"] = len(cl["devices"])
            cl["severity"]["history"].append(severity)
            cl["severity"]["max"] = min(cl["severity"]["max"], severity)
            cl["severity"]["min"] = max(cl["severity"]["min"], severity)
            cl["severity"]["average"] = sum(cl["severity"]["history"]) / len(cl["severity"]["history"])
            cl["severity"]["mode"] = max(set(cl["severity"]["history"]), key=cl["severity"]["history"].count)
            cl["confidence"] = min(0.99, 0.80 + (cl["reportCount"] - 1) * 0.05)
            cl["lastReported"] = ts_str or cl["lastReported"]
            cl["roadInfo"]["speeds"].append(speed)
            cl["roadInfo"]["avgSpeed"] = sum(cl["roadInfo"]["speeds"]) / len(cl["roadInfo"]["speeds"])
        else:
            cid = str(uuid.uuid4())
            clusters[cid] = {
                "clusterId": cid,
                "obstacleType": etype,
                "location": {"latitude": lat, "longitude": lon, "radius": CLUSTER_RADIUS},
                "severity": {
                    "average": severity, "max": severity, "min": severity, "mode": severity,
                    "history": [severity],
                },
                "confidence": 0.80,
                "reportCount": 1,
                "devices": [device_id],
                "firstReported": ts_str,
                "lastReported": ts_str,
                "status": "active",
                "expiresAt": (datetime.utcnow() + timedelta(days=15)).isoformat(),
                "roadInfo": {"avgSpeed": speed, "speedVariance": 0, "speeds": [speed]},
                "roadSnap": {},
            }

        processed += 1
        if processed % 10000 == 0:
            logger.info("  Clustered %d/%d (skipped %d, clusters %d)", processed, len(all_events), skipped, len(clusters))

    logger.info("Clustering done: %d clusters from %d events (skipped %d)", len(clusters), processed, skipped)

    # Upload clusters in batches of 5000
    cluster_list = list(clusters.values())
    url = f"{main_url}/api/admin/gpu-machines/clusters/bulk-upload"
    batch_size = 5000
    total_uploaded = 0
    upload_errors = 0

    for i in range(0, len(cluster_list), batch_size):
        batch = cluster_list[i:i + batch_size]
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(url, json={"clusters": batch, "total_events_processed": processed}, headers=headers)
            if resp.status_code == 200:
                result = resp.json()
                total_uploaded += result.get("inserted", 0)
                logger.info("Upload batch %d: %d/%d inserted", i // batch_size + 1, result.get("inserted", 0), len(batch))
            else:
                logger.error("Upload batch %d failed: %d %s", i // batch_size + 1, resp.status_code, resp.text[:200])
                upload_errors += 1

    logger.info("Upload complete: %d clusters uploaded (%d errors)", total_uploaded, upload_errors)

    return {
        "total_events": len(all_events),
        "processed": processed,
        "skipped": skipped,
        "clusters_created": len(clusters),
        "clusters_uploaded": total_uploaded,
        "upload_errors": upload_errors,
    }
