#!/usr/bin/env python3
"""Root-only, host-side maintenance for the production Compose project."""

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time


BASE = Path("/opt/goodroad/docker-compose.yaml")
OVERRIDE = Path("/opt/goodroad/docker-compose.logging.yaml")
TAIL_DIR = Path("/dev/shm/goodroad-log-tails")
SERVICES = ("backend", "mongodb")
TAIL_BYTES = 64 * 1024
LOGGING = {"driver": "json-file", "options": {"max-size": "10m", "max-file": "3"}}


class MaintenanceError(Exception):
    pass


def run(args, timeout=120):
    try:
        result = subprocess.run(args, capture_output=True, text=True, errors="replace",
                                timeout=timeout, cwd=BASE.parent)
    except subprocess.TimeoutExpired:
        raise MaintenanceError("Command timed out: " + " ".join(args[:2])) from None
    if result.returncode:
        # Docker/config output can contain credentials. Never relay it to Actions.
        raise MaintenanceError(
            "Command failed (exit %s): %s" % (result.returncode, " ".join(args[:2]))
        )
    return result.stdout


def compose(*args, rotation=False, timeout=120):
    command = ["docker", "compose", "-f", str(BASE)]
    if rotation:
        command += ["-f", str(OVERRIDE)]
    return run(command + list(args), timeout=timeout)


def configuration():
    config = json.loads(compose("config", "--format", "json"))
    if not isinstance(config.get("services"), dict) or not config.get("name"):
        raise MaintenanceError("Compose config has no services/project name")
    return config


def inspect_container(container_id, service, project):
    if not re.fullmatch(r"[0-9a-f]{12,64}", container_id):
        raise MaintenanceError("Invalid container ID from Compose")
    items = json.loads(run(["docker", "inspect", container_id]))
    if not isinstance(items, list) or len(items) != 1:
        raise MaintenanceError("Expected exactly one Docker inspect result")
    item = items[0]
    full_id = item.get("Id", "")
    labels = item.get("Config", {}).get("Labels") or {}
    if (
        not re.fullmatch(r"[0-9a-f]{64}", full_id)
        or not full_id.startswith(container_id)
        or labels.get("com.docker.compose.service") != service
        or labels.get("com.docker.compose.project") != project
        or labels.get("com.docker.compose.oneoff", "false").lower() != "false"
    ):
        raise MaintenanceError("Container identity does not match the Compose service")
    return item


def containers(service, config):
    if service not in SERVICES or service not in config["services"]:
        raise MaintenanceError("Selected service is not present in production Compose")
    ids = compose("ps", "-a", "-q", service).split()
    return [inspect_container(cid, service, config["name"]) for cid in ids]


def log_path(item):
    if item.get("HostConfig", {}).get("LogConfig", {}).get("Type") != "json-file":
        raise MaintenanceError("Selected container does not use json-file logging")
    cid = item["Id"]
    path = Path(item.get("LogPath", ""))
    if (
        not path.is_absolute()
        or path.name != cid + "-json.log"
        or path.parent.name != cid
        or path.resolve(strict=True) != path
    ):
        raise MaintenanceError("LogPath is not the selected container's canonical JSON log")
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise MaintenanceError("LogPath must be a regular, non-hardlinked file")
    return path


def report_disk(path):
    usage = shutil.disk_usage(path)
    print(json.dumps({"filesystem_path": str(path), "total_bytes": usage.total,
                      "used_bytes": usage.used, "free_bytes": usage.free}))


def report(items, service):
    report_disk(BASE.parent)
    report_disk(TAIL_DIR.parent)
    if not items:
        print(json.dumps({"service": service, "containers": 0}))
    for item in items:
        logging = item.get("HostConfig", {}).get("LogConfig", {})
        options = logging.get("Config") or {}
        data = {"service": service, "id": item["Id"],
                "running": item["State"]["Running"], "driver": logging.get("Type"),
                "max-size": options.get("max-size"), "max-file": options.get("max-file")}
        try:
            path = log_path(item)
            data["log_bytes"] = path.stat().st_size
            report_disk(path)
        except (MaintenanceError, OSError) as exc:
            data["log_unavailable"] = str(exc)
        print(json.dumps(data))


def clear_logs(item, service, project):
    path = log_path(item)
    cid = item["Id"]
    was_running = item["State"]["Running"]
    errors = []
    try:
        if was_running:
            run(["docker", "stop", "--time", "30", cid], timeout=60)
        stopped = inspect_container(cid, service, project)
        if stopped["State"]["Running"] or log_path(stopped) != path:
            raise MaintenanceError("Container did not stop or its LogPath changed")
        TAIL_DIR.mkdir(mode=0o700, exist_ok=True)
        directory = TAIL_DIR.lstat()
        if (not stat.S_ISDIR(directory.st_mode) or directory.st_uid != os.geteuid()
                or stat.S_IMODE(directory.st_mode) != 0o700):
            raise MaintenanceError("Tail directory must be owned by root with mode 0700")
        # Open without truncation and reject links/replacements before touching bytes.
        before = path.lstat()
        fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, "r+b") as log:
            opened = os.fstat(log.fileno())
            if (not stat.S_ISREG(opened.st_mode) or opened.st_nlink != 1
                    or (before.st_dev, before.st_ino) != (opened.st_dev, opened.st_ino)):
                raise MaintenanceError("Log file changed during validation")
            log.seek(max(0, opened.st_size - TAIL_BYTES))
            tail = log.read(TAIL_BYTES)
            backup_fd, backup_path = tempfile.mkstemp(prefix=cid + "-", suffix=".tail", dir=TAIL_DIR)
            with os.fdopen(backup_fd, "wb") as backup:
                os.fchmod(backup.fileno(), 0o600)
                backup.write(tail)
                backup.flush()
                os.fsync(backup.fileno())
            print("Saved bounded tail on host: " + backup_path)
            log.truncate(0)
            log.flush()
            os.fsync(log.fileno())
            print("Cleared selected container log: " + cid)
    except Exception as exc:
        errors.append("Clear failed: " + str(exc))
    finally:
        if was_running:
            try:
                run(["docker", "start", cid])
            except Exception as exc:
                errors.append("Restart failed: " + str(exc))
    if errors:
        raise MaintenanceError("; ".join(errors))


def write_rotation(config):
    services = {name: {"logging": LOGGING} for name in SERVICES if name in config["services"]}
    if not services:
        raise MaintenanceError("No supported services in production Compose")
    if OVERRIDE.is_symlink():
        raise MaintenanceError("Logging override must not be a symlink")
    fd, temporary = tempfile.mkstemp(prefix=".logging-", dir=OVERRIDE.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            os.fchmod(output.fileno(), 0o600)
            json.dump({"services": services}, output, indent=2)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, OVERRIDE)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print("Wrote logging-only override: " + str(OVERRIDE))


def validate_mongodb_mount(item, config):
    mounts = [m for m in item.get("Mounts", []) if m.get("Destination") == "/data/db"]
    declared = [m for m in config["services"]["mongodb"].get("volumes", [])
                if m.get("target") == "/data/db"]
    if len(mounts) != 1 or len(declared) != 1:
        raise MaintenanceError("MongoDB requires an existing persistent /data/db mount")
    mount, spec = mounts[0], declared[0]
    kind, source = spec.get("type"), spec.get("source")
    valid = (source and mount.get("Type") == kind and mount.get("RW") is True
             and not spec.get("read_only") and mount.get("Source"))
    if kind == "volume":
        name = config.get("volumes", {}).get(source, {}).get("name")
        valid = valid and name and mount.get("Name") == name
    elif kind == "bind":
        valid = (valid and Path(source).is_absolute() and source == mount.get("Source")
                 and Path(source).is_dir())
    else:
        valid = False
    if not valid:
        raise MaintenanceError("MongoDB /data/db must match the configured named volume or persistent bind")


def wait_ready(timeout=120):
    deadline = time.monotonic() + timeout
    probe = (
        "import json,urllib.request; "
        "r=urllib.request.urlopen('http://localhost:8001/ready',timeout=3); "
        "d=json.load(r); "
        "raise SystemExit(0 if r.status == 200 and isinstance(d,dict) "
        "and d.get('status') == 'ready' else 1)"
    )
    while time.monotonic() < deadline:
        try:
            compose("exec", "-T", "backend", "python3", "-c", probe, rotation=True,
                    timeout=min(10, max(0.1, deadline - time.monotonic())))
            print("Backend /ready returned status ready")
            return
        except MaintenanceError:
            time.sleep(min(2, max(0, deadline - time.monotonic())))
    raise MaintenanceError("Backend /ready did not return status ready within %ss" % timeout)


def wait_mongodb(config, timeout=120):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        items = containers("mongodb", config)
        if len(items) != 1:
            raise MaintenanceError("Expected one MongoDB container after recreation")
        state = items[0]["State"]
        if not state.get("Running") and not state.get("Restarting"):
            raise MaintenanceError("MongoDB container stopped after recreation")
        try:
            compose("exec", "-T", "mongodb", "mongosh", "--quiet", "--eval",
                    "quit(db.adminCommand({ping: 1}).ok === 1 ? 0 : 1)",
                    rotation=True, timeout=min(10, max(0.1, deadline - time.monotonic())))
            print("MongoDB ping succeeded")
            return
        except MaintenanceError:
            time.sleep(min(2, max(0, deadline - time.monotonic())))
    raise MaintenanceError("MongoDB did not respond to ping within %ss" % timeout)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", nargs="?", default="inspect",
                        choices=("inspect", "clear", "apply-rotation", "write-rotation", "wait-ready"))
    parser.add_argument("--service", choices=SERVICES, default="backend")
    parser.add_argument("--confirm", default="")
    args = parser.parse_args(argv)
    if args.action == "clear" and args.confirm != "CLEAR_LOGS":
        parser.error("clear requires --confirm CLEAR_LOGS")
    if args.action != "clear" and args.confirm:
        parser.error("confirmation is only valid for clear")
    try:
        if os.geteuid() != 0:
            raise MaintenanceError("Run this script on the Docker host as root")
        if args.action == "wait-ready":
            wait_ready()
            return 0
        config = configuration()
        if args.action == "write-rotation":
            write_rotation(config)
            return 0
        items = containers(args.service, config)
        if args.action == "inspect":
            report(items, args.service)
            return 0
        if len(items) != 1:
            raise MaintenanceError("Mutation requires exactly one existing selected service container")
        item = items[0]
        if args.action == "clear":
            clear_logs(item, args.service, config["name"])
        else:
            if args.service == "mongodb":
                validate_mongodb_mount(item, config)
            write_rotation(config)
            compose("up", "-d", "--force-recreate", "--no-deps", "--no-build", "--pull", "never",
                    args.service, rotation=True, timeout=180)
            if args.service == "backend":
                wait_ready()
            else:
                wait_mongodb(config)
        report(containers(args.service, config), args.service)
        return 0
    except (MaintenanceError, OSError, ValueError, KeyError, TypeError) as exc:
        print("Maintenance failed: " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    def interrupted(signum, frame):
        raise MaintenanceError("Interrupted by signal %s" % signum)

    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    sys.exit(main())
