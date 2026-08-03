import asyncio
import logging
import time
import uuid

logger = logging.getLogger(__name__)

_tasks = {}


def start(coro):
    tid = uuid.uuid4().hex
    _tasks[tid] = {"status": "running", "created": time.time(), "result": None, "error": None}
    asyncio.create_task(_run(tid, coro))
    _cleanup()
    return tid


async def _run(tid, coro):
    try:
        _tasks[tid]["result"] = await coro
        _tasks[tid]["status"] = "done"
    except Exception as e:
        logger.warning("LLM task %s failed: %s", tid, e)
        _tasks[tid]["error"] = str(e)
        _tasks[tid]["status"] = "error"


def get(tid):
    t = _tasks.get(tid)
    if not t:
        return None
    return {"status": t["status"], "result": t["result"], "error": t["error"],
            "created": t["created"]}


def _cleanup(max_age=3600):
    now = time.time()
    stale = [tid for tid, t in _tasks.items() if now - t.get("created", 0) > max_age]
    for tid in stale:
        _tasks.pop(tid, None)