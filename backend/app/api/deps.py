"""FastAPI 依赖注入。"""

from collections.abc import AsyncGenerator

from fastapi import Depends, Request, Response
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.anon import ensure_anon_session
from app.db import get_db
from app.models.anonymous import AnonymousSession
from app.redis_client import get_redis as _get_redis


async def get_database() -> AsyncGenerator[AsyncSession, None]:
    async for s in get_db():
        yield s


async def get_anon(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_database),
) -> AnonymousSession:
    return await ensure_anon_session(request, response, db)


async def get_redis_dep() -> Redis:
    return await _get_redis()
