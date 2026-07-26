import asyncio
import io
import logging
import os
import secrets
import uuid
from datetime import datetime
from typing import Optional, List

import httpx
from fastapi import APIRouter, HTTPException, Header, Query
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

gpu_machine_router = APIRouter(prefix="/api/admin/gpu-machines", tags=["GPU Machines"])

_db = None


def init_gpu_machines(db):
    global _db
    _db = db


def _generate_api_key():
    return f"gpu_{secrets.token_hex(24)}"


def _generate_webhook_secret():
    return secrets.token_hex(32)


# ─── Models ───────────────────────────────────────────────────────────────────

class GPUMachineCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    host: str = Field(..., min_length=1, max_length=255)
    ssh_port: int = Field(default=22, ge=1, le=65535)
    ssh_user: str = Field(default="root", min_length=1)
    ssh_auth: str = Field(default="key", pattern="^(key|password)$")
    ssh_private_key: Optional[str] = None
    ssh_password: Optional[str] = None
    deploy_path: str = Field(default="/opt/goodroad-gpu")


class GPUMachineUpdate(BaseModel):
    name: Optional[str] = None
    host: Optional[str] = None
    ssh_port: Optional[int] = None
    ssh_user: Optional[str] = None
    ssh_auth: Optional[str] = None
    ssh_private_key: Optional[str] = None
    ssh_password: Optional[str] = None
    deploy_path: Optional[str] = None


class SelfRegisterRequest(BaseModel):
    name: str = Field(default="", max_length=100)


class TrainRequest(BaseModel):
    dataset_id: str
    epochs: int = Field(default=50, ge=1, le=200)
    batch_size: int = Field(default=64, ge=8, le=256)
    seq_len: int = Field(default=32, ge=1, le=512)


# ─── CRUD ─────────────────────────────────────────────────────────────────────

@gpu_machine_router.get("/")
async def list_machines():
    machines = await _db.gpu_machines.find(
        {}, {"ssh_private_key": 0, "ssh_password": 0}
    ).to_list(100)
    for m in machines:
        m["_id"] = str(m["_id"])
    return {"machines": machines, "count": len(machines)}


@gpu_machine_router.post("/")
async def create_machine(req: GPUMachineCreate):
    machine_id = f"gpu_{uuid.uuid4().hex[:12]}"
    api_key = _generate_api_key()
    webhook_secret = _generate_webhook_secret()

    doc = {
        "machine_id": machine_id,
        "name": req.name,
        "host": req.host,
        "ssh_port": req.ssh_port,
        "ssh_user": req.ssh_user,
        "ssh_auth": req.ssh_auth,
        "ssh_private_key": req.ssh_private_key or "",
        "ssh_password": req.ssh_password or "",
        "deploy_path": req.deploy_path,
        "api_key": api_key,
        "webhook_secret": webhook_secret,
        "status": "offline",
        "gpu_name": None,
        "gpu_available": False,
        "last_health_check": None,
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }

    await _db.gpu_machines.insert_one(doc)
    logger.info("GPU machine registered: %s (%s)", machine_id, req.name)

    return {
        "machine_id": machine_id,
        "api_key": api_key,
        "webhook_secret": webhook_secret,
    }


@gpu_machine_router.post("/self-register")
async def self_register(req: SelfRegisterRequest = None):
    """Register a GPU machine without SSH credentials (for self-deploying clients)"""
    machine_id = f"gpu_{uuid.uuid4().hex[:12]}"
    api_key = _generate_api_key()
    webhook_secret = _generate_webhook_secret()

    doc = {
        "machine_id": machine_id,
        "name": req.name if req and req.name else f"GPU-{machine_id[-8:]}",
        "host": "",
        "ssh_port": 22,
        "ssh_user": "",
        "ssh_auth": "key",
        "ssh_private_key": "",
        "ssh_password": "",
        "deploy_path": "/opt/goodroad-gpu",
        "api_key": api_key,
        "webhook_secret": webhook_secret,
        "status": "offline",
        "gpu_name": None,
        "gpu_available": False,
        "last_health_check": None,
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }

    await _db.gpu_machines.insert_one(doc)
    logger.info("GPU machine self-registered: %s", machine_id)

    return {
        "machine_id": machine_id,
        "api_key": api_key,
        "webhook_secret": webhook_secret,
    }


@gpu_machine_router.get("/{machine_id}")
async def get_machine(machine_id: str):
    doc = await _db.gpu_machines.find_one(
        {"machine_id": machine_id},
        {"ssh_private_key": 0, "ssh_password": 0},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Machine not found")
    doc["_id"] = str(doc["_id"])
    return doc


@gpu_machine_router.put("/{machine_id}")
async def update_machine(machine_id: str, req: GPUMachineUpdate):
    update_data = {k: v for k, v in req.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")
    update_data["updated_at"] = datetime.utcnow()
    result = await _db.gpu_machines.update_one(
        {"machine_id": machine_id}, {"$set": update_data}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Machine not found")
    return {"message": "Machine updated"}


@gpu_machine_router.delete("/{machine_id}")
async def delete_machine(machine_id: str):
    result = await _db.gpu_machines.delete_one({"machine_id": machine_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Machine not found")
    await _db.gpu_commands.delete_many({"machine_id": machine_id})
    return {"message": "Machine deleted"}


# ─── Health Check ─────────────────────────────────────────────────────────────

class HeartbeatRequest(BaseModel):
    gpu_available: bool = False
    gpu_name: str = ""
    training_active: bool = False
    current_run: Optional[str] = None


@gpu_machine_router.post("/{machine_id}/heartbeat")
async def machine_heartbeat(machine_id: str, req: HeartbeatRequest):
    """GPU client reports its status periodically (reverse health check)"""
    result = await _db.gpu_machines.update_one(
        {"machine_id": machine_id},
        {"$set": {
            "status": "online",
            "gpu_available": req.gpu_available,
            "gpu_name": req.gpu_name,
            "training_active": req.training_active,
            "current_run": req.current_run,
            "last_health_check": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Machine not found")
    return {"status": "online"}


@gpu_machine_router.get("/{machine_id}/health")
async def check_health(machine_id: str):
    machine = await _db.gpu_machines.find_one({"machine_id": machine_id})
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found")

    host = machine.get("host", "")
    stored_status = machine.get("status", "offline")
    stored_health = machine.get("last_health_check")

    if host and host not in ("0.0.0.0", "", "localhost", "127.0.0.1"):
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(f"http://{host}:8002/health")
                if resp.status_code == 200:
                    data = resp.json()
                    await _db.gpu_machines.update_one(
                        {"machine_id": machine_id},
                        {"$set": {
                            "status": "online",
                            "gpu_available": data.get("gpu_available", False),
                            "gpu_name": data.get("gpu_name"),
                            "last_health_check": datetime.utcnow(),
                            "updated_at": datetime.utcnow(),
                        }},
                    )
                    return {"status": "online", "health": data}
        except Exception as e:
            logger.debug("Direct health check failed for %s: %s", machine_id, e)

    return {"status": stored_status, "last_health_check": str(stored_health) if stored_health else None}


# ─── SSH Helpers ──────────────────────────────────────────────────────────────

def _get_ssh_client(machine: dict):
    try:
        import paramiko
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="paramiko not installed. Run: pip install paramiko",
        )

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    connect_kwargs = {
        "hostname": machine["host"],
        "port": machine.get("ssh_port", 22),
        "username": machine.get("ssh_user", "root"),
        "timeout": 15,
    }

    if machine.get("ssh_auth") == "key" and machine.get("ssh_private_key"):
        key_str = machine["ssh_private_key"]
        if "RSA" in key_str or key_str.startswith("-----BEGIN RSA"):
            pkey = paramiko.RSAKey.from_private_key(io.StringIO(key_str))
        elif "OPENSSH" in key_str or key_str.startswith("-----OPENSSH"):
            pkey = paramiko.Ed25519Key.from_private_key(io.StringIO(key_str))
        else:
            pkey = paramiko.Ed25519Key.from_private_key(io.StringIO(key_str))
        connect_kwargs["pkey"] = pkey
    elif machine.get("ssh_auth") == "password" and machine.get("ssh_password"):
        connect_kwargs["password"] = machine["ssh_password"]
    else:
        raise HTTPException(status_code=400, detail="No SSH credentials configured")

    ssh.connect(**connect_kwargs)
    return ssh


def _run_ssh(machine: dict, command: str, timeout: int = 60):
    ssh = _get_ssh_client(machine)
    try:
        stdin, stdout, stderr = ssh.exec_command(command, timeout=timeout)
        exit_code = stdout.channel.recv_exit_status()
        out = stdout.read().decode()
        err = stderr.read().decode()
        return {"exit_code": exit_code, "stdout": out, "stderr": err}
    finally:
        ssh.close()


# ─── Deploy ───────────────────────────────────────────────────────────────────

@gpu_machine_router.post("/{machine_id}/deploy")
async def deploy_machine(machine_id: str):
    machine = await _db.gpu_machines.find_one({"machine_id": machine_id})
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found")

    await _db.gpu_machines.update_one(
        {"machine_id": machine_id},
        {"$set": {"status": "deploying", "updated_at": datetime.utcnow()}},
    )

    deploy_path = machine.get("deploy_path", "/opt/goodroad-gpu")
    api_key = machine.get("api_key", "")
    webhook_secret = machine.get("webhook_secret", "")
    main_server = os.getenv("MAIN_SERVER_URL", "https://goodroad.su")

    commands = [
        f"mkdir -p {deploy_path}/training {deploy_path}/polling",
    ]

    gpu_server_dir = os.path.join(
        os.path.dirname(os.path.dirname(__file__)), "gpu_server"
    )
    remote_files = {}
    for root, dirs, files in os.walk(gpu_server_dir):
        dirs[:] = [
            d for d in dirs
            if d not in ("__pycache__", ".git", "venv", "node_modules")
        ]
        for f in files:
            if f.endswith(".pyc"):
                continue
            local_path = os.path.join(root, f)
            rel = os.path.relpath(local_path, gpu_server_dir)
            remote_path = f"{deploy_path}/{rel.replace(os.sep, '/')}"
            remote_files[local_path] = remote_path

    results = []

    try:
        ssh = _get_ssh_client(machine)
    except Exception as e:
        await _db.gpu_machines.update_one(
            {"machine_id": machine_id},
            {"$set": {"status": "error", "updated_at": datetime.utcnow()}},
        )
        raise HTTPException(status_code=500, detail=f"SSH connection failed: {e}")

    try:
        for cmd in commands:
            stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
            stdout.channel.recv_exit_status()

        sftp = ssh.open_sftp()
        try:
            for local_path, remote_path in remote_files.items():
                remote_dir = "/".join(remote_path.split("/")[:-1])
                parts = remote_dir.split("/")
                for i in range(1, len(parts) + 1):
                    d = "/".join(parts[:i])
                    if not d:
                        continue
                    try:
                        sftp.stat(d)
                    except FileNotFoundError:
                        sftp.mkdir(d)
                sftp.put(local_path, remote_path)
                results.append(f"Uploaded: {os.path.basename(remote_path)}")
        finally:
            sftp.close()

        env_content = (
            f"MAIN_SERVER_URL={main_server}\n"
            f"EXTERNAL_TRAINING_API_KEY={api_key}\n"
            f"EXTERNAL_TRAINING_WEBHOOK_SECRET={webhook_secret}\n"
            f"POLL_INTERVAL=30\n"
            f"GPU_DEVICE=auto\n"
            f"MODEL_OUTPUT_DIR=/data/models\n"
            f"MACHINE_ID={machine_id}\n"
        )
        stdin, stdout, stderr = ssh.exec_command(
            f"cat > {deploy_path}/.env << 'ENVEOF'\n{env_content}ENVEOF",
            timeout=10,
        )
        stdout.channel.recv_exit_status()
        results.append("Created .env")

        stdin, stdout, stderr = ssh.exec_command(
            f"cd {deploy_path} && pip install -r requirements.txt 2>&1 | tail -3",
            timeout=120,
        )
        stdout.channel.recv_exit_status()
        results.append("Dependencies installed")

        stdin, stdout, stderr = ssh.exec_command(
            f"cd {deploy_path} && "
            f"(docker compose up -d --build 2>&1 || "
            f"(nohup python main.py > {deploy_path}/gpu_server.log 2>&1 &))",
            timeout=120,
        )
        stdout.channel.recv_exit_status()
        results.append("GPU server started")

    except Exception as e:
        await _db.gpu_machines.update_one(
            {"machine_id": machine_id},
            {"$set": {"status": "error", "updated_at": datetime.utcnow()}},
        )
        raise HTTPException(status_code=500, detail=f"Deploy failed: {e}")
    finally:
        ssh.close()

    await _db.gpu_machines.update_one(
        {"machine_id": machine_id},
        {"$set": {"status": "online", "updated_at": datetime.utcnow()}},
    )

    logger.info("Deployed GPU server to %s (%s)", machine_id, machine["host"])
    return {"message": "Deploy complete", "steps": results}


# ─── Start / Stop ─────────────────────────────────────────────────────────────

@gpu_machine_router.post("/{machine_id}/start")
async def start_machine(machine_id: str):
    machine = await _db.gpu_machines.find_one({"machine_id": machine_id})
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found")

    deploy_path = machine.get("deploy_path", "/opt/goodroad-gpu")
    result = _run_ssh(
        machine,
        f"cd {deploy_path} && "
        f"(docker compose up -d 2>&1 || "
        f"(nohup python main.py > {deploy_path}/gpu_server.log 2>&1 &))",
    )

    await _db.gpu_machines.update_one(
        {"machine_id": machine_id},
        {"$set": {"status": "online", "updated_at": datetime.utcnow()}},
    )
    return {"message": "GPU server started", "output": result.get("stdout", "")}


@gpu_machine_router.post("/{machine_id}/stop")
async def stop_machine(machine_id: str):
    machine = await _db.gpu_machines.find_one({"machine_id": machine_id})
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found")

    deploy_path = machine.get("deploy_path", "/opt/goodroad-gpu")
    result = _run_ssh(
        machine,
        f"cd {deploy_path} && docker compose down 2>&1; "
        f"pkill -f 'python main.py' 2>/dev/null; echo done",
    )

    await _db.gpu_machines.update_one(
        {"machine_id": machine_id},
        {"$set": {"status": "offline", "updated_at": datetime.utcnow()}},
    )
    return {"message": "GPU server stopped", "output": result.get("stdout", "")}


# ─── Command Queue (push training to GPU machine) ────────────────────────────

@gpu_machine_router.post("/{machine_id}/train")
async def trigger_training(machine_id: str, req: TrainRequest):
    machine = await _db.gpu_machines.find_one({"machine_id": machine_id})
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found")

    cmd_doc = {
        "command_id": f"cmd_{uuid.uuid4().hex[:12]}",
        "machine_id": machine_id,
        "command": "train",
        "params": {
            "dataset_id": req.dataset_id,
            "epochs": req.epochs,
            "batch_size": req.batch_size,
            "seq_len": req.seq_len,
        },
        "status": "pending",
        "result": None,
        "created_at": datetime.utcnow(),
        "completed_at": None,
    }

    await _db.gpu_commands.insert_one(cmd_doc)
    logger.info(
        "Training command queued for %s: dataset=%s", machine_id, req.dataset_id
    )
    return {"command_id": cmd_doc["command_id"], "status": "pending"}


@gpu_machine_router.get("/{machine_id}/commands")
async def get_pending_commands(machine_id: str):
    commands = await _db.gpu_commands.find(
        {"machine_id": machine_id, "status": "pending"}
    ).sort("created_at", 1).to_list(10)

    for cmd in commands:
        cmd["_id"] = str(cmd["_id"])

    return {"commands": commands, "count": len(commands)}


@gpu_machine_router.post("/commands/{command_id}/complete")
async def complete_command(command_id: str, result: dict = None):
    update = {
        "status": "completed",
        "completed_at": datetime.utcnow(),
        "result": result,
    }
    res = await _db.gpu_commands.update_one(
        {"command_id": command_id}, {"$set": update}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Command not found")
    return {"message": "Command completed"}


@gpu_machine_router.post("/commands/{command_id}/fail")
async def fail_command(command_id: str, error: str = ""):
    update = {
        "status": "failed",
        "completed_at": datetime.utcnow(),
        "result": {"error": error},
    }
    res = await _db.gpu_commands.update_one(
        {"command_id": command_id}, {"$set": update}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Command not found")
    return {"message": "Command marked as failed"}


# ─── Logs ─────────────────────────────────────────────────────────────────────

@gpu_machine_router.get("/{machine_id}/logs")
async def get_machine_logs(machine_id: str, lines: int = Query(50, ge=1, le=500)):
    machine = await _db.gpu_machines.find_one({"machine_id": machine_id})
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found")

    deploy_path = machine.get("deploy_path", "/opt/goodroad-gpu")
    result = _run_ssh(
        machine,
        f"tail -n {lines} {deploy_path}/gpu_server.log 2>/dev/null || "
        f"docker logs --tail {lines} goodroad-gpu-server 2>&1 || "
        f"echo 'No logs available'",
        timeout=10,
    )
    return {"logs": result.get("stdout", "No logs available")}


# ─── SSH Key Generation ──────────────────────────────────────────────────────

@gpu_machine_router.post("/generate-key")
async def generate_ssh_key():
    try:
        import paramiko
    except ImportError:
        raise HTTPException(status_code=500, detail="paramiko not installed")

    key = paramiko.Ed25519Key.generate()
    private_io = io.StringIO()
    key.write_private_key(private_io)
    private_key = private_io.getvalue()
    public_key = f"ssh-ed25519 {key.get_base64()} goodroad-gpu-server"

    return {"private_key": private_key, "public_key": public_key}
