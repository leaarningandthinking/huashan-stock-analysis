"""匿名会话中间件：每个请求带上 hs_anon cookie，没有就建一个。"""

import uuid
from datetime import datetime, timezone

from fastapi import Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.anonymous import AnonymousSession

settings = get_settings()


async def ensure_anon_session(
    request: Request, response: Response, db: AsyncSession
) -> AnonymousSession:
    """从 cookie 读 anon_id，不存在或失效就新建。返回 AnonymousSession 实体。"""
    cookie_val = request.cookies.get(settings.anon_cookie_name)
    session: AnonymousSession | None = None

    if cookie_val:
        try:
            anon_uuid = uuid.UUID(cookie_val)
            stmt = select(AnonymousSession).where(AnonymousSession.id == anon_uuid)
            result = await db.execute(stmt)
            session = result.scalar_one_or_none()
        except ValueError:
            session = None

    if session is None:
        session = AnonymousSession(id=uuid.uuid4())
        db.add(session)
        await db.flush()
        response.set_cookie(
            key=settings.anon_cookie_name,
            value=str(session.id),
            max_age=settings.anon_cookie_max_age,
            httponly=True,
            samesite="lax",
        )
    else:
        session.last_seen_at = datetime.now(timezone.utc)

    await db.commit()
    return session
