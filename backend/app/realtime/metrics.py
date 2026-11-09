"""In-process latency and error metrics for the System Monitoring page."""
from __future__ import annotations

import statistics
import time
from collections import deque


class Metrics:
    def __init__(self) -> None:
        self.samples: deque[dict] = deque(maxlen=2000)
        self.errors: deque[dict] = deque(maxlen=200)
        self.counters: dict[str, int] = {}

    def inc(self, name: str, n: int = 1) -> None:
        self.counters[name] = self.counters.get(name, 0) + n

    def record(self, **sample) -> None:
        sample["t"] = time.time()
        self.samples.append(sample)

    def error(self, kind: str, message: str) -> None:
        self.inc(f"error.{kind}")
        self.errors.append({"t": time.time(), "kind": kind, "message": message[:300]})

    def summary(self, window_s: int = 3600) -> dict:
        cutoff = time.time() - window_s
        recent = [s for s in self.samples if s["t"] >= cutoff]

        def pct(key: str) -> dict:
            vals = sorted(s[key] for s in recent if s.get(key) is not None)
            if not vals:
                return {"count": 0, "avg": None, "p50": None, "p95": None}
            return {
                "count": len(vals),
                "avg": round(statistics.fmean(vals)),
                "p50": vals[len(vals) // 2],
                "p95": vals[min(len(vals) - 1, int(len(vals) * 0.95))],
            }

        return {
            "window_s": window_s,
            "stt_ms": pct("stt_ms"),
            "mt_ms": pct("mt_ms"),
            "tts_ms": pct("tts_ms"),
            "total_ms": pct("total_ms"),
            "uncertain_rate": (
                round(sum(1 for s in recent if s.get("uncertain")) / len(recent), 3) if recent else None
            ),
            "counters": dict(self.counters),
            "recent_errors": list(self.errors)[-20:],
        }


metrics = Metrics()
