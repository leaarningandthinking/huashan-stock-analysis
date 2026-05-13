from fastapi import APIRouter, Depends
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_database, get_redis_dep

router = APIRouter(tags=["system"])


@router.get("/health")
async def health(
    db: AsyncSession = Depends(get_database),
    redis: Redis = Depends(get_redis_dep),
) -> dict:
    db_ok = False
    redis_ok = False
    try:
        await db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        pass
    try:
        pong = await redis.ping()
        redis_ok = bool(pong)
    except Exception:
        pass
    return {
        "status": "ok" if (db_ok and redis_ok) else "degraded",
        "db": db_ok,
        "redis": redis_ok,
    }
