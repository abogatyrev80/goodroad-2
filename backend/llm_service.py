import os
import logging
import httpx
from typing import Optional

logger = logging.getLogger(__name__)

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwopus3.5-tools")


async def generate(prompt: str, system: str = "", temperature: float = 0.3,
                   max_tokens: int = 2048, model: str = None) -> Optional[str]:
    model = model or OLLAMA_MODEL
    body = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": temperature,
            "num_predict": max_tokens,
        },
    }
    if system:
        body["system"] = system
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(f"{OLLAMA_URL}/api/generate", json=body)
            if resp.status_code == 200:
                return resp.json().get("response", "")
            logger.warning("Ollama error: %d %s", resp.status_code, resp.text[:200])
    except httpx.ConnectError:
        logger.warning("Ollama not reachable at %s", OLLAMA_URL)
    except Exception as e:
        logger.warning("Ollama request failed: %s", e)
    return None


async def generate_json(prompt: str, system: str = "", model: str = None) -> Optional[dict]:
    import json
    raw = await generate(
        prompt + "\n\nReturn ONLY valid JSON, no markdown, no commentary.",
        system=system, temperature=0.1, model=model,
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


async def generate_json_list(prompt: str, system: str = "", model: str = None) -> Optional[list]:
    import json
    raw = await generate(
        prompt + "\n\nReturn ONLY a valid JSON array, no markdown, no commentary.",
        system=system, temperature=0.1, model=model,
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
