#!/usr/bin/env python3
"""
Good Road GPU Client — deploy & run on any machine (Linux/Windows).

Usage:
  # Interactive mode (asks for missing values)
  python deploy_gpu_client.py

  # Fully automated
  python deploy_gpu_client.py --name "My GPU" --gpu auto

  # With existing machine credentials
  python deploy_gpu_client.py --machine-id gpu_xxx --api-key gpu_xxx

  # Override backend URL
  python deploy_gpu_client.py --server https://goodroad.su

  # Custom install dir
  python deploy_gpu_client.py --dir /opt/goodroad-gpu

  # Just copy files + register, don't start
  python deploy_gpu_client.py --no-start
"""
import argparse
import json
import os
import platform
import secrets
import shutil
import stat
import subprocess
import sys
import textwrap
import time
import uuid
from pathlib import Path

MAIN_SERVER = "https://goodroad.su"
DEFAULT_PORT = 8002
REQUIREMENTS = [
    "fastapi>=0.115.0",
    "uvicorn>=0.32.0",
    "httpx>=0.27.0",
    "numpy>=1.26.0",
    "scikit-learn>=1.5.0",
    "python-dotenv>=1.0.0",
]
TORCH_INDEX = {
    "cpu": "https://download.pytorch.org/whl/cpu",
    "cuda": "https://download.pytorch.org/whl/cu124",
    "rocm": "https://download.pytorch.org/whl/rocm6.2",
}
SOURCE_FILES = {
    "main.py": None,
    "config.py": None,
    "requirements.txt": None,
    "polling/__init__.py": "",
    "training/__init__.py": "",
    "training/model.py": None,
    "training/train.py": None,
    "training/dataset_loader.py": None,
    "polling/poller.py": None,
}

log = lambda msg: print(f"  [INFO] {msg}")
err = lambda msg: print(f"  [ERROR] {msg}", file=sys.stderr)
ok = lambda msg: print(f"  [OK] {msg}")


# ─── helpers ──────────────────────────────────────────────────────────────────


def _run(cmd, cwd=None, timeout=300, check=False):
    res = subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    if check and res.returncode != 0:
        print(f"  [CMD] {cmd}")
        print(f"  [STDERR] {res.stderr.strip()}")
        sys.exit(1)
    return res


def _http_get(url, headers=None):
    import urllib.request
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:200]
        fail(f"HTTP {e.code} from {url}: {body}")
    except Exception as e:
        fail(f"Request failed: {e}")


def _http_post(url, data, headers=None):
    import urllib.request
    body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, headers={
        "Content-Type": "application/json", **(headers or {}),
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:300]
        fail(f"HTTP {e.code} from {url}: {body}")
    except Exception as e:
        fail(f"Request failed: {e}")


def fail(msg):
    err(msg)
    sys.exit(1)


def prompt(label, default=""):
    d = f" [{default}]" if default else ""
    v = input(f"  {label}{d}: ").strip()
    return v or default


# ─── steps ────────────────────────────────────────────────────────────────────


def check_python():
    log(f"Python {sys.version_info.major}.{sys.version_info.minor}")
    if sys.version_info < (3, 8):
        fail("Python 3.8+ required")


def detect_gpu(preference):
    if preference != "auto":
        log(f"GPU forced: {preference}")
        return preference
    system = platform.system()
    if system == "Linux":
        lspci = _run("lspci 2>/dev/null | grep -iE 'nvidia|amd|radeon|vga.*3d'")
        out = lspci.stdout.lower()
        if "nvidia" in out:
            log("NVIDIA GPU detected")
            return "cuda"
        if any(k in out for k in ("amd", "radeon", "advanced micro")):
            log("AMD GPU detected")
            return "rocm"
    elif system == "Windows":
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DEVICEMAP\VIDEO") as key:
                pass
            import subprocess
            res = subprocess.run(["wmic", "path", "win32_videocontroller", "get", "name"], capture_output=True, text=True, timeout=10)
            out = res.stdout.lower()
            if "nvidia" in out:
                log("NVIDIA GPU detected")
                return "cuda"
            if any(k in out for k in ("amd", "radeon")):
                log("AMD GPU detected (Windows: use CPU torch or DirectML)")
                return "cpu"
        except Exception:
            pass
    log("No supported GPU detected, using CPU")
    return "cpu"


def register_machine(server, name=""):
    log(f"Registering with {server}...")
    import urllib.request, urllib.error
    data = json.dumps({"name": name} if name else {}).encode()
    req = urllib.request.Request(
        f"{server}/api/admin/gpu-machines/self-register",
        data=data, headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            result = json.loads(r.read().decode())
            log(f"Registered: machine_id={result['machine_id']}")
            return result
    except urllib.error.HTTPError as e:
        log(f"self-register unavailable (HTTP {e.code}), using admin register...")
        dummy = json.dumps({
            "name": name or f"gpu-auto-{uuid.uuid4().hex[:6]}",
            "host": "0.0.0.0",
            "ssh_port": 22,
            "ssh_user": "root",
            "ssh_auth": "key",
            "ssh_private_key": "",
            "ssh_password": "",
            "deploy_path": "/opt/goodroad-gpu",
        }).encode()
        req2 = urllib.request.Request(
            f"{server}/api/admin/gpu-machines/",
            data=dummy, headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req2, timeout=30) as r2:
            result = json.loads(r2.read().decode())
            log(f"Registered: machine_id={result['machine_id']}")
            return result


def resolve_source(source_arg):
    if source_arg:
        if os.path.isdir(source_arg):
            return source_arg
        fail(f"Source directory not found: {source_arg}")
    script_dir = Path(__file__).parent.resolve()
    candidates = [
        script_dir / "gpu_server",
        script_dir.parent / "gpu_server" if script_dir.name == "scripts" else None,
    ]
    for c in candidates:
        if c and c.is_dir():
            return str(c)
    fail(
        "gpu_server/ not found. Either run from the repo root, or pass --source /path/to/gpu_server"
    )


def copy_gpu_server(source_dir, target_dir):
    log(f"Copying files from {source_dir}...")
    ignore = shutil.ignore_patterns("__pycache__", "venv", ".git", "node_modules", "*.pyc")
    ignore_model = shutil.ignore_patterns("__pycache__", "venv", ".git")
    for item in os.listdir(source_dir):
        s = os.path.join(source_dir, item)
        if item in ("__pycache__", "venv", ".git", "node_modules"):
            continue
        if item.endswith(".pyc"):
            continue
        t = os.path.join(target_dir, item)
        if os.path.isdir(s):
            if os.path.exists(t):
                shutil.rmtree(t)
            shutil.copytree(s, t, ignore=ignore_model)
        elif item.endswith((".py", ".txt", ".sh", ".env", ".yml", ".yaml", ".dockerignore")):
            shutil.copy2(s, t)
    ok("Files copied")


def create_venv(target_dir):
    venv_path = os.path.join(target_dir, "venv")
    if os.path.isdir(venv_path):
        log(f"Virtual env exists at {venv_path}")
        return venv_path
    log("Creating virtual environment...")
    _run(f"{sys.executable} -m venv {venv_path}", check=True)
    ok("Virtual environment created")
    return venv_path


def get_pip_path(venv_path):
    if platform.system() == "Windows":
        return os.path.join(venv_path, "Scripts", "pip.exe")
    return os.path.join(venv_path, "bin", "pip")


def get_python_path(venv_path):
    if platform.system() == "Windows":
        return os.path.join(venv_path, "Scripts", "python.exe")
    return os.path.join(venv_path, "bin", "python")


def install_deps(venv_path, gpu_device):
    pip = get_pip_path(venv_path)
    log("Upgrading pip...")
    _run(f'"{pip}" install --upgrade pip --quiet', timeout=120)
    log("Installing base dependencies...")
    for pkg in REQUIREMENTS:
        _run(f'"{pip}" install "{pkg}" --quiet', timeout=120, check=True)

    log(f"Installing PyTorch ({gpu_device})...")
    idx = TORCH_INDEX.get(gpu_device, TORCH_INDEX["cpu"])
    _run(
        f'"{pip}" install torch torchvision torchaudio --index-url {idx} --quiet',
        timeout=600,
    )
    ok("Dependencies installed")


def create_dotenv(target_dir, machine_id, api_key, webhook_secret, server, gpu_device):
    env_path = os.path.join(target_dir, ".env")
    content = textwrap.dedent(f"""\
    MAIN_SERVER_URL={server}
    EXTERNAL_TRAINING_API_KEY={api_key}
    EXTERNAL_TRAINING_WEBHOOK_SECRET={webhook_secret}
    MACHINE_ID={machine_id}
    GPU_DEVICE={gpu_device}
    POLL_INTERVAL=30
    COMMAND_POLL_INTERVAL=30
    MODEL_OUTPUT_DIR=./models
    """)
    with open(env_path, "w") as f:
        f.write(content)
    os.chmod(env_path, 0o600)
    ok(f".env created ({env_path})")


def create_systemd_service(target_dir, port):
    if platform.system() != "Linux":
        return
    python = get_python_path(os.path.join(target_dir, "venv"))
    service = textwrap.dedent(f"""\
    [Unit]
    Description=Good Road GPU Training Client
    After=network-online.target
    Wants=network-online.target

    [Service]
    Type=simple
    User=root
    WorkingDirectory={target_dir}
    ExecStart={python} main.py
    Restart=always
    RestartSec=10
    StandardOutput=journal
    StandardError=journal
    Environment=PYTHONUNBUFFERED=1

    [Install]
    WantedBy=multi-user.target
    """)
    service_path = "/etc/systemd/system/goodroad-gpu.service"
    try:
        with open(service_path, "w") as f:
            f.write(service)
        _run("systemctl daemon-reload", check=False)
        _run(f"systemctl enable goodroad-gpu.service", check=False)
        ok(f"systemd service created: {service_path}")
    except PermissionError:
        log("systemd service requires root — skipping")


def create_startup_script(target_dir, venv_path, port):
    python = get_python_path(venv_path)
    main_py = os.path.join(target_dir, "main.py")
    log_path = os.path.join(target_dir, "gpu_server.log")
    pid_path = os.path.join(target_dir, "gpu_server.pid")

    if platform.system() == "Windows":
        ps1 = os.path.join(target_dir, "start_gpu_server.ps1")
        content = textwrap.dedent(f"""\
        $log = "{log_path}"
        $pidfile = "{pid_path}"
        $python = "{python}"
        $main = "{main_py}"
        $proc = Start-Process -FilePath $python -ArgumentList $main -WindowStyle Hidden -PassThru -RedirectStandardOutput $log -RedirectStandardError $log
        $proc.Id | Out-File -FilePath $pidfile
        Write-Host "GPU server started (PID $($proc.Id))"
        """)
        with open(ps1, "w") as f:
            f.write(content)
        bat = os.path.join(target_dir, "start_gpu_server.bat")
        with open(bat, "w") as f:
            f.write(f'@echo off\nstart /B "" "{python}" "{main_py}" > "{log_path}" 2>&1\n')
        ok(f"Startup scripts created: {ps1}, {bat}")
    else:
        sh_path = os.path.join(target_dir, "start_gpu_server.sh")
        content = textwrap.dedent(f"""\
        #!/bin/bash
        cd {target_dir}
        nohup "{python}" "{main_py}" >> "{log_path}" 2>&1 &
        echo $! > "{pid_path}"
        echo "GPU server started (PID $(cat {pid_path}))"
        """)
        with open(sh_path, "w") as f:
            f.write(content)
        os.chmod(sh_path, 0o755)
        ok(f"Startup script created: {sh_path}")


def start_server(target_dir, venv_path, port):
    python = get_python_path(venv_path)
    main_py = os.path.join(target_dir, "main.py")
    log_path = os.path.join(target_dir, "gpu_server.log")
    pid_path = os.path.join(target_dir, "gpu_server.pid")
    log_path_t = os.path.join(target_dir, "gpu_server_start.log")

    log("Starting GPU server...")
    if platform.system() == "Windows":
        proc = subprocess.Popen(
            [python, main_py],
            cwd=target_dir,
            stdout=open(log_path, "a"),
            stderr=open(log_path, "a"),
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        with open(pid_path, "w") as f:
            f.write(str(proc.pid))
    else:
        proc = subprocess.Popen(
            [python, main_py],
            cwd=target_dir,
            stdout=open(log_path, "a"),
            stderr=open(log_path, "a"),
        )
        with open(pid_path, "w") as f:
            f.write(str(proc.pid))

    time.sleep(5)
    if proc.poll() is not None:
        with open(log_path) as f:
            tail = f.read()[-500:]
        fail(f"Server exited immediately (code {proc.returncode})\n{tail}")

    ok(f"GPU server started (PID {proc.pid})")
    return proc.pid


def verify_health(port):
    log("Verifying health endpoint...")
    for i in range(6):
        try:
            import urllib.request
            with urllib.request.urlopen(f"http://localhost:{port}/health", timeout=5) as r:
                data = json.loads(r.read().decode())
                ok(f"Server healthy: machine_id={data.get('machine_id','?')} gpu={data.get('gpu_name','?')}")
                return data
        except Exception:
            if i < 5:
                time.sleep(3)
    fail("Health check failed — server not responding")


# ─── main ─────────────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(
        description="Deploy & run Good Road GPU Client on any machine",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent("""\
        Examples:
          python deploy_gpu_client.py
          python deploy_gpu_client.py --name "RTX 3090" --gpu cuda
          python deploy_gpu_client.py --machine-id gpu_xxx --api-key gpu_xxx --no-start
          python deploy_gpu_client.py --dir /opt/goodroad-gpu --no-service
        """),
    )
    parser.add_argument("--server", default="", help=f"Main server URL (default: {MAIN_SERVER})")
    parser.add_argument("--name", default="", help="Human-readable machine name")
    parser.add_argument("--machine-id", default="", help="Existing machine ID (skip registration)")
    parser.add_argument("--api-key", default="", help="Existing API key")
    parser.add_argument("--webhook-secret", default="", help="Existing webhook secret")
    parser.add_argument("--gpu", default="auto", choices=["auto", "cpu", "cuda", "rocm"],
                        help="GPU target (auto-detect by default)")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"Server port (default: {DEFAULT_PORT})")
    parser.add_argument("--dir", default="", help="Installation directory (default: ~/goodroad-gpu)")
    parser.add_argument("--source", default="", help="Path to gpu_server source directory")
    parser.add_argument("--no-start", action="store_true", help="Don't start the server after install")
    parser.add_argument("--no-service", action="store_true", help="Don't create systemd service")
    parser.add_argument("--yes", "-y", action="store_true", help="Skip all prompts")
    args = parser.parse_args()

    banner()

    # ── resolve config ──
    server = args.server or MAIN_SERVER
    target = args.dir or os.path.expanduser("~/goodroad-gpu")
    source = resolve_source(args.source)
    machine_id = args.machine_id
    api_key = args.api_key
    webhook_secret = args.webhook_secret

    # ── interactive prompts ──
    if not args.yes and not args.server:
        server = prompt("Backend server URL", server)
    if not args.yes and not args.machine_id:
        name = args.name or prompt("Machine name (optional)")
    else:
        name = args.name
    if not args.yes and args.dir == "":
        target = prompt("Installation directory", target)

    # ── steps ──
    print()
    check_python()

    gpu_device = detect_gpu(args.gpu)
    print()

    if not machine_id:
        result = register_machine(server, name)
        machine_id = result["machine_id"]
        api_key = result["api_key"]
        webhook_secret = result["webhook_secret"]
        print()

    os.makedirs(target, exist_ok=True)
    target = os.path.abspath(target)

    copy_gpu_server(source, target)
    print()

    venv_path = create_venv(target)
    print()

    install_deps(venv_path, gpu_device)
    print()

    create_dotenv(target, machine_id, api_key, webhook_secret, server, gpu_device)
    print()

    if not args.no_service:
        create_systemd_service(target, args.port)
        print()

    create_startup_script(target, venv_path, args.port)
    print()

    if not args.no_start:
        pid = start_server(target, venv_path, args.port)
        health = verify_health(args.port)
        print()

    # ── summary ──
    print("=" * 60)
    ok("GPU client deployed successfully!")
    print(f"  Machine ID:    {machine_id}")
    print(f"  API Key:       {api_key[:16]}...{api_key[-8:]}")
    print(f"  Directory:     {target}")
    print(f"  Backend:       {server}")
    print(f"  GPU mode:      {gpu_device}")
    print(f"  Port:          {args.port}")
    if not args.no_start:
        print(f"  PID:           {pid}")
        print(f"  Log:           {target}/gpu_server.log")
        print(f"  Health:        http://localhost:{args.port}/health")
    print()
    print("  Next steps:")
    print(f"    1. Monitor:  http://localhost:{args.port}/api/status")
    print(f"    2. Admin:    {server}/api/admin/dashboard/v3")
    print(f"    3. Stop:     {'Stop-Process -Id ' + str(pid) if platform.system() == 'Windows' and not args.no_start else 'kill ' + str(pid) if not args.no_start else f'python {target}/stop_gpu_server.py'}")
    print("=" * 60)

    if not args.no_start:
        print(f"\n  Tip: run `tail -f {target}/gpu_server.log` to watch training progress")


def banner():
    print()
    print("  ┌────────────────────────────────────────────┐")
    print("  │  Good Road GPU Client — Deploy Script      │")
    print("  │  https://goodroad.su                       │")
    print("  └────────────────────────────────────────────┘")
    print()


if __name__ == "__main__":
    main()
