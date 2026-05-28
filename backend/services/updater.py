import asyncio
import hashlib
import hmac
import json
import logging
import os
import subprocess
import sys
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

LOCK_FILE = "/tmp/backend-update.lock"
DEPLOY_LOG_FILE = "/tmp/backend-deploy-log.json"
REPO_DIR = Path(__file__).resolve().parent.parent


class DeployError(Exception):
    pass


class BackendUpdater:
    def __init__(self, repo_dir: Optional[Path] = None):
        self.repo_dir = repo_dir or REPO_DIR
        self._load_deploy_log()

    # --- Lock ---

    def acquire_lock(self) -> bool:
        try:
            with open(LOCK_FILE, "x") as f:
                f.write(str(os.getpid()))
            return True
        except FileExistsError:
            return False

    def release_lock(self):
        try:
            if os.path.exists(LOCK_FILE):
                with open(LOCK_FILE) as f:
                    pid = f.read().strip()
                if pid == str(os.getpid()) or not pid:
                    os.remove(LOCK_FILE)
        except Exception as e:
            logger.warning("Failed to release lock: %s", e)

    # --- Git ---

    def _git(self, *args: str) -> str:
        try:
            result = subprocess.run(
                ["git"] + list(args),
                cwd=self.repo_dir,
                capture_output=True,
                text=True,
                timeout=30,
            )
            if result.returncode != 0:
                raise DeployError(f"git {' '.join(args)} failed: {result.stderr.strip()}")
            return result.stdout.strip()
        except subprocess.TimeoutExpired:
            raise DeployError("git command timed out")

    def get_status(self) -> dict:
        branch = self._git("rev-parse", "--abbrev-ref", "HEAD")
        commit = self._git("rev-parse", "HEAD")
        short_commit = self._git("rev-parse", "--short", "HEAD")
        message = self._git("log", "-1", "--format=%s")

        self._git("fetch", "--quiet", "origin", branch)
        ahead_behind = self._git("rev-list", "--left-right", "--count",
                                 f"origin/{branch}...HEAD")
        ahead, behind = ahead_behind.split() if ahead_behind else ("0", "0")

        status = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=self.repo_dir, capture_output=True, text=True, timeout=10,
        )
        has_uncommitted = bool(status.stdout.strip())

        return {
            "branch": branch,
            "commit": commit,
            "short_commit": short_commit,
            "message": message,
            "ahead": int(ahead),
            "behind": int(behind),
            "has_uncommitted": has_uncommitted,
        }

    def git_pull(self) -> dict:
        status_before = self.get_status()
        if status_before["has_uncommitted"]:
            raise DeployError("Uncommitted changes. Commit or stash first.")

        if status_before["behind"] == 0:
            return {"message": "Already up to date", "changed": False}

        self._git("pull", "--ff-only", "origin", status_before["branch"])
        status_after = self.get_status()
        return {
            "message": f"Updated from {status_before['short_commit']} to {status_after['short_commit']}",
            "changed": True,
            "before": status_before["commit"],
            "after": status_after["commit"],
        }

    # --- Validation ---

    def validate_code(self) -> list:
        errors = []
        python_files = list(self.repo_dir.rglob("*.py"))
        for f in python_files:
            if ".venv" in str(f) or "__pycache__" in str(f):
                continue
            try:
                subprocess.run(
                    [sys.executable, "-c", f"import ast; ast.parse(open('{f}').read())"],
                    capture_output=True, text=True, timeout=10,
                )
            except subprocess.TimeoutExpired:
                errors.append(f"Timeout parsing {f.relative_to(self.repo_dir)}")
            except Exception as e:
                errors.append(f"{f.relative_to(self.repo_dir)}: {e}")
        return errors

    # --- Restart ---

    def restart_service(self) -> dict:
        try:
            result = subprocess.run(
                ["supervisorctl", "restart", "backend"],
                capture_output=True, text=True, timeout=30,
            )
            return {
                "success": result.returncode == 0,
                "output": result.stdout.strip() or result.stderr.strip(),
            }
        except FileNotFoundError:
            logger.warning("supervisorctl not found, trying systemctl...")
            try:
                result = subprocess.run(
                    ["systemctl", "restart", "goodroad-backend"],
                    capture_output=True, text=True, timeout=30,
                )
                return {
                    "success": result.returncode == 0,
                    "output": result.stdout.strip() or result.stderr.strip(),
                }
            except FileNotFoundError:
                raise DeployError("No process supervisor found (supervisorctl/systemctl)")

    # --- ZIP deploy ---

    def deploy_from_zip(self, zip_bytes: bytes) -> dict:
        with tempfile.TemporaryDirectory() as tmpdir:
            zip_path = Path(tmpdir) / "deploy.zip"
            zip_path.write_bytes(zip_bytes)

            extract_dir = Path(tmpdir) / "extracted"
            with zipfile.ZipFile(zip_path, "r") as zf:
                zf.extractall(extract_dir)

            python_files = list(extract_dir.rglob("*.py"))
            if not python_files:
                raise DeployError("No Python files found in archive")

            for f in python_files:
                try:
                    subprocess.run(
                        [sys.executable, "-c", f"import ast; ast.parse(open('{f}').read())"],
                        capture_output=True, text=True, timeout=10,
                    )
                except Exception as e:
                    raise DeployError(f"Validation failed: {f.relative_to(extract_dir)}: {e}")

            self._backup_current()
            self._replace_with(extract_dir)

        msg = f"Deployed from ZIP ({len(python_files)} files)"
        self._append_log("zip", msg)
        return {"message": msg, "files": len(python_files)}

    def _backup_current(self):
        backup_dir = Path("/tmp/backend-backup")
        if backup_dir.exists():
            import shutil
            shutil.rmtree(backup_dir)
        import shutil
        shutil.copytree(self.repo_dir / "backend", backup_dir / "backend")
        logger.info("Backup created at %s", backup_dir)

    def _replace_with(self, source: Path):
        import shutil
        for item in source.iterdir():
            dest = self.repo_dir / item.name
            if dest.exists():
                if dest.is_dir():
                    shutil.rmtree(dest)
                else:
                    dest.unlink()
            shutil.copytree(item, dest) if item.is_dir() else shutil.copy2(item, dest)

    # --- Log ---

    def _load_deploy_log(self):
        self._deploy_log: list = []
        if os.path.exists(DEPLOY_LOG_FILE):
            try:
                with open(DEPLOY_LOG_FILE) as f:
                    self._deploy_log = json.load(f)
            except (json.JSONDecodeError, Exception):
                self._deploy_log = []

    def _append_log(self, method: str, message: str, success: bool = True):
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "method": method,
            "message": message,
            "success": success,
        }
        self._deploy_log.insert(0, entry)
        self._deploy_log = self._deploy_log[:50]
        try:
            with open(DEPLOY_LOG_FILE, "w") as f:
                json.dump(self._deploy_log, f, indent=2)
        except Exception as e:
            logger.warning("Failed to write deploy log: %s", e)

    def get_deploy_log(self, limit: int = 20) -> list:
        return self._deploy_log[:limit]

    # --- Webhook ---

    def verify_webhook(self, payload_body: bytes, signature_header: Optional[str]) -> bool:
        secret = os.environ.get("GITHUB_WEBHOOK_SECRET", "")
        if not secret:
            logger.warning("GITHUB_WEBHOOK_SECRET not set, webhook verification disabled")
            return True
        if not signature_header:
            return False
        expected = hmac.new(secret.encode(), payload_body, hashlib.sha256).hexdigest()
        received = signature_header.removeprefix("sha256=")
        return hmac.compare_digest(expected, received)

    def handle_webhook(self, payload: dict, signature: Optional[str] = None,
                       raw_body: Optional[bytes] = None) -> dict:
        if raw_body:
            if not self.verify_webhook(raw_body, signature):
                raise DeployError("Invalid webhook signature")

        ref = payload.get("ref", "")
        if ref != "refs/heads/main":
            return {"message": f"Ignored push to {ref}, only main branch triggers deploy"}

        result = self.git_pull()
        if not result.get("changed"):
            return {"message": "No new changes"}

        errors = self.validate_code()
        if errors:
            self._append_log("webhook", f"Validation failed: {errors[0]}", success=False)
            raise DeployError(f"Code validation failed: {errors[0]}")

        restart = self.restart_service()
        self._append_log("webhook", f"Auto-deployed {result.get('message', '')}", success=True)
        return {
            "message": "Deployed successfully",
            "pull": result,
            "restart": restart,
        }
