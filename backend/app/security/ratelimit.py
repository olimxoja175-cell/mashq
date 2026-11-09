"""Sliding-window rate limiter + single-use nonce store (anti-replay).
Uses Redis when WV_REDIS_URL is configured (required for multi-instance
deployments); otherwise an in-process store suitable for a single node."""
from __future__ import annotations

import time
from collections import defaultdict, deque

from ..config import get_settings


class _MemoryStore:
    def __init__(self) -> None:
        self.hits: dict[str, deque[float]] = defaultdict(deque)
        self.nonces: dict[str, float] = {}

    async def hit(self, key: str, limit: int, window: float) -> bool:
        now = time.monotonic()
        q = self.hits[key]
        while q and q[0] <= now - window:
            q.popleft()
        if len(q) >= limit:
            return False
        q.append(now)
        return True

    async def use_nonce(self, nonce: str, ttl: float) -> bool:
        now = time.monotonic()
        if len(self.nonces) > 50_000:
            self.nonces = {k: v for k, v in self.nonces.items() if v > now}
        exp = self.nonces.get(nonce)
        if exp and exp > now:
            return False
        self.nonces[nonce] = now + ttl
        return True

    def reset(self) -> None:
        self.hits.clear()
        self.nonces.clear()


class _RedisStore:
    def __init__(self, url: str) -> None:
        import redis.asyncio as redis

        self.r = redis.from_url(url)

    async def hit(self, key: str, limit: int, window: float) -> bool:
        k = f"wv:rl:{key}:{int(time.time() // window)}"
        n = await self.r.incr(k)
        if n == 1:
            await self.r.expire(k, int(window) + 1)
        return n <= limit

    async def use_nonce(self, nonce: str, ttl: float) -> bool:
        return bool(await self.r.set(f"wv:nonce:{nonce}", 1, nx=True, ex=int(ttl) + 1))

    def reset(self) -> None:  # pragma: no cover
        pass


_url = get_settings().redis_url
store = _RedisStore(_url) if _url else _MemoryStore()


async def allow(key: str, limit: int, window: float) -> bool:
    return await store.hit(key, limit, window)


async def use_nonce_once(nonce: str, ttl: float) -> bool:
    return await store.use_nonce(nonce, ttl)
