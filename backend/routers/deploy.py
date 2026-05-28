import logging
import os
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from fastapi.responses import HTMLResponse, JSONResponse

from config import templates
from services.updater import BackendUpdater, DeployError

logger = logging.getLogger(__name__)

deploy_router = APIRouter(prefix="/api/admin/deploy", tags=["Deploy"])
updater = BackendUpdater()


@deploy_router.get("", response_class=HTMLResponse)
async def deploy_page(request: Request):
    try:
        status = updater.get_status()
    except DeployError as e:
        status = {"error": str(e)}
    log = updater.get_deploy_log(limit=20)
    return templates.TemplateResponse(
        "admin_deploy.html",
        {"request": request, "status": status, "log": log},
    )


@deploy_router.get("/log")
async def deploy_log(limit: int = 20):
    return JSONResponse(content=updater.get_deploy_log(limit=limit))


@deploy_router.post("/pull")
async def manual_pull():
    if not updater.acquire_lock():
        raise HTTPException(429, detail="Another deploy is in progress")
    try:
        result = updater.git_pull()
        if not result.get("changed"):
            return {"message": "Already up to date", "changed": False}

        errors = updater.validate_code()
        if errors:
            raise HTTPException(400, detail=f"Validation failed: {errors[0]}")

        restart = updater.restart_service()
        if not restart.get("success"):
            raise HTTPException(500, detail=f"Restart failed: {restart['output']}")

        return {
            "message": f"Pulled and restarted: {result['message']}",
            "changed": True,
        }
    except DeployError as e:
        raise HTTPException(400, detail=str(e))
    finally:
        updater.release_lock()


@deploy_router.post("/upload")
async def upload_zip(file: UploadFile = File(...)):
    if not file.filename or not file.filename.endswith(".zip"):
        raise HTTPException(400, detail="Only ZIP files are accepted")

    if not updater.acquire_lock():
        raise HTTPException(429, detail="Another deploy is in progress")
    try:
        content = await file.read()
        if len(content) == 0:
            raise HTTPException(400, detail="Empty file")
        if len(content) > 100 * 1024 * 1024:
            raise HTTPException(400, detail="File too large (>100MB)")

        result = updater.deploy_from_zip(content)
        restart = updater.restart_service()
        if not restart.get("success"):
            raise HTTPException(500, detail=f"Deploy succeeded but restart failed: {restart['output']}")

        return {"message": result["message"], "files": result["files"]}
    except DeployError as e:
        raise HTTPException(400, detail=str(e))
    finally:
        updater.release_lock()


# Webhook endpoint at /api/webhook/github (outside /admin prefix)
webhook_router = APIRouter(prefix="/api/webhook", tags=["Webhook"])


@webhook_router.post("/github")
async def github_webhook(request: Request):
    signature = request.headers.get("X-Hub-Signature-256")
    raw_body = await request.body()
    payload = await request.json()

    if not updater.acquire_lock():
        raise HTTPException(429, detail="Another deploy is in progress")
    try:
        result = updater.handle_webhook(payload, signature, raw_body)
        return result
    except DeployError as e:
        raise HTTPException(400, detail=str(e))
    finally:
        updater.release_lock()
