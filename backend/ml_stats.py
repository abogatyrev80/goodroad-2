"""
Учёт и агрегация предсказаний нейросетевой модели для админ-дашборда.
"""

from __future__ import annotations

import asyncio
import time
from collections import Counter, deque
from datetime import datetime, timedelta
from typing import Any, Deque, Dict, List, Optional

_ml_stats_tracker: Optional["MLStatsTracker"] = None


class MLStatsTracker:
    def __init__(self, db=None, persist: bool = True):
        self.db = db
        self.persist = persist
        self.recent: Deque[Dict[str, Any]] = deque(maxlen=500)
        self.total_inferences = 0
        self.total_used = 0
        self.total_agreements = 0
        self.total_comparisons = 0
        self.by_predicted: Counter = Counter()
        self.by_used_method: Counter = Counter()
        self.confidence_sum = 0.0
        self.latency_sum_ms = 0.0
        self.started_at = datetime.utcnow()

    def record_sync(
        self,
        *,
        device_id: str,
        neural_type: Optional[str],
        neural_confidence: Optional[float],
        heuristic_type: Optional[str],
        final_type: Optional[str],
        final_method: str,
        speed: float,
        sample_count: int,
        latency_ms: float,
    ) -> None:
        agreement = None
        if neural_type and heuristic_type:
            self.total_comparisons += 1
            agreement = neural_type == heuristic_type
            if agreement:
                self.total_agreements += 1

        if neural_type:
            self.total_inferences += 1
            self.by_predicted[neural_type] += 1
            if neural_confidence is not None:
                self.confidence_sum += float(neural_confidence)

        if final_method == "neural_network":
            self.total_used += 1
        self.by_used_method[final_method] += 1
        self.latency_sum_ms += latency_ms

        entry = {
            "timestamp": datetime.utcnow(),
            "deviceId": device_id,
            "neuralType": neural_type,
            "neuralConfidence": neural_confidence,
            "heuristicType": heuristic_type,
            "finalType": final_type,
            "finalMethod": final_method,
            "agreement": agreement,
            "speed": speed,
            "sampleCount": sample_count,
            "latencyMs": round(latency_ms, 2),
        }
        self.recent.appendleft(entry)

        if self.persist and self.db is not None:
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(self._persist(entry))
            except RuntimeError:
                pass

    async def record(self, **kwargs) -> None:
        self.record_sync(**kwargs)

    async def _persist(self, entry: Dict[str, Any]) -> None:
        try:
            doc = {**entry, "timestamp": entry["timestamp"]}
            await self.db.ml_inference_logs.insert_one(doc)
        except Exception:
            pass

    def snapshot(self) -> Dict[str, Any]:
        uptime = (datetime.utcnow() - self.started_at).total_seconds()
        avg_conf = (
            self.confidence_sum / self.total_inferences if self.total_inferences else 0.0
        )
        avg_latency = (
            self.latency_sum_ms / max(self.total_inferences, 1)
            if self.total_inferences
            else 0.0
        )
        agreement_rate = (
            self.total_agreements / self.total_comparisons
            if self.total_comparisons
            else None
        )
        return {
            "uptime_seconds": int(uptime),
            "total_inferences": self.total_inferences,
            "total_used_as_result": self.total_used,
            "total_comparisons": self.total_comparisons,
            "agreement_rate": agreement_rate,
            "avg_confidence": round(avg_conf, 4),
            "avg_latency_ms": round(avg_latency, 2),
            "by_predicted": dict(self.by_predicted),
            "by_method": dict(self.by_used_method),
        }

    def recent_list(self, limit: int = 50) -> List[Dict[str, Any]]:
        out = []
        for item in list(self.recent)[:limit]:
            row = {**item}
            if isinstance(row.get("timestamp"), datetime):
                row["timestamp"] = row["timestamp"].isoformat()
            out.append(row)
        return out

    async def load_history_from_db(self, hours: int = 24) -> None:
        if self.db is None:
            return
        since = datetime.utcnow() - timedelta(hours=hours)
        cursor = self.db.ml_inference_logs.find({"timestamp": {"$gte": since}}).sort(
            "timestamp", -1
        ).limit(500)
        docs = await cursor.to_list(length=500)
        for doc in reversed(docs):
            self.recent.append(doc)
            nt = doc.get("neuralType")
            if nt:
                self.total_inferences += 1
                self.by_predicted[nt] += 1
                if doc.get("neuralConfidence") is not None:
                    self.confidence_sum += float(doc["neuralConfidence"])
            fm = doc.get("finalMethod", "unknown")
            self.by_used_method[fm] += 1
            if fm == "neural_network":
                self.total_used += 1
            if doc.get("agreement") is True:
                self.total_agreements += 1
            if doc.get("neuralType") and doc.get("heuristicType"):
                self.total_comparisons += 1


def get_ml_stats_tracker() -> Optional[MLStatsTracker]:
    return _ml_stats_tracker


def init_ml_stats_tracker(db=None, persist: bool = True) -> MLStatsTracker:
    global _ml_stats_tracker
    _ml_stats_tracker = MLStatsTracker(db=db, persist=persist)
    return _ml_stats_tracker
