import asyncio
import os
import logging
import time
from collections import deque
from datetime import datetime
from typing import List, Optional

import httpx

logger = logging.getLogger(__name__)

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwopus3.5-tools")

_tracker_db = None
_recent_requests: deque = deque(maxlen=200)


def init_llm_tracker(db=None):
    global _tracker_db
    _tracker_db = db


def get_tracker_db():
    return _tracker_db


def recent_requests(max_len: int = 50) -> List[dict]:
    return list(_recent_requests)[-max_len:]


async def _track(tag: str, model: str, url: str, success: bool,
                 duration_ms: int, prompt_len: int, response_len: int,
                 error: str = ""):
    entry = {
        "ts": datetime.utcnow().isoformat(),
        "tag": tag,
        "model": model,
        "url": url,
        "success": success,
        "error": error or "",
        "duration_ms": duration_ms,
        "prompt_len": prompt_len,
        "response_len": response_len,
    }
    _recent_requests.append(entry)
    if _tracker_db is not None:
        try:
            await _tracker_db.llm_requests.insert_one(entry)
        except Exception:
            pass


async def generate(prompt: str, system: str = "", temperature: float = 0.3,
                   max_tokens: int = 8192, model: str = None,
                   ollama_url: str = None, tag: str = "generate") -> Optional[str]:
    model = model or OLLAMA_MODEL
    url = ollama_url or OLLAMA_URL
    body = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": temperature,
            "num_predict": max_tokens,
            "think": False,
        },
    }
    if system:
        body["system"] = system
    start = time.monotonic()
    error = ""
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(f"{url}/api/generate", json=body)
                if resp.status_code == 200:
                    data = resp.json()
                    content = data.get("response", "")
                    await _track(tag, model, url, True, int((time.monotonic() - start) * 1000),
                                 len(prompt), len(content))
                    return content
                error = f"HTTP {resp.status_code}"
                logger.warning("Ollama error: %d %s", resp.status_code, resp.text[:200])
        except httpx.ConnectError:
            error = "connect_error"
            logger.warning("Ollama not reachable at %s (attempt %d/3)", url, attempt + 1)
        except Exception as e:
            error = str(e)
            logger.warning("Ollama request failed: %s (attempt %d/3)", e, attempt + 1)
        await asyncio.sleep(2 * (attempt + 1))
    await _track(tag, model, url, False, int((time.monotonic() - start) * 1000),
                 len(prompt), 0, error)
    return None


async def generate_json(prompt: str, system: str = "", model: str = None,
                        tag: str = "generate") -> Optional[dict]:
    import json
    raw = await generate(
        prompt + "\n\nReturn ONLY valid JSON, no markdown, no commentary.",
        system=system, temperature=0.1, model=model, tag=tag,
    )
    if not raw:
        return None
    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
        text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            try:
                return json.loads(text[start:end])
            except json.JSONDecodeError:
                pass
        logger.warning("Failed to parse Ollama JSON: %s", text[:200])
        return None


async def generate_json_list(prompt: str, system: str = "", model: str = None,
                             tag: str = "generate") -> Optional[list]:
    import json
    raw = await generate(
        prompt + "\n\nReturn ONLY a valid JSON array, no markdown, no commentary.",
        system=system, temperature=0.1, model=model, tag=tag,
    )
    if not raw:
        return None
    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
        text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("[")
        end = text.rfind("]") + 1
        if start >= 0 and end > start:
            try:
                return json.loads(text[start:end])
            except json.JSONDecodeError:
                pass
        logger.warning("Failed to parse Ollama JSON list: %s", text[:200])
        return None
