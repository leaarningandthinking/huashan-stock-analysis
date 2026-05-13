"""Redis 缓存工具。所有 akshare 数据都过这一层，避免重复请求易碎接口。"""

from __future__ import annotations

import json
from typing import Any

from app.redis_client import get_redis


KEY_PREFIX = "hs:data:"


async def cache_get(key: str) -> Any:
    redis = await get_redis()
    raw = await redis.get(KEY_PREFIX + key)
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


async def cache_set(key: str, value: Any, ttl_seconds: int) -> None:
    redis = await get_redis()
    await redis.setex(KEY_PREFIX + key, ttl_seconds, json.dumps(value, ensure_ascii=False))


async def cache_delete(key: str) -> None:
    redis = await get_redis()
    await redis.delete(KEY_PREFIX + key)
