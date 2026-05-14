from __future__ import annotations

from datetime import UTC, datetime, timedelta
import base64
import hashlib
import hmac
import os
import re
import secrets
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_database
from app.config import get_settings
from app.models.user import CreditAccount, User, UserSession

router = APIRouter(prefix="/api/auth", tags=["auth"])
settings = get_settings()

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
HASH_ITERATIONS = 260_000


class RegisterRequest(BaseModel):
    email: str
    password: str
    accepted_disclaimer: bool = False


class LoginRequest(BaseModel):
    email: str
    password: str


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or os.urandom(16)
    peppered = f"{password}{settings.password_hash_pepper}".encode("utf-8")
    digest = hashlib.pbkdf2_hmac("sha256", peppered, salt, HASH_ITERATIONS)
    salt_text = base64.urlsafe_b64encode(salt).decode("ascii").rstrip("=")
    digest_text = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    return f"pbkdf2_sha256${HASH_ITERATIONS}${salt_text}${digest_text}"


def _verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, iterations_text, salt_text, digest_text = stored_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = base64.urlsafe_b64decode(salt_text + "=" * (-len(salt_text) % 4))
        expected = _hash_password(password, salt).split("$", 3)[3]
        return hmac.compare_digest(expected, digest_text)
    except Exception:
        return False


def _hash_session_token(token: str) -> str:
    return hashlib.sha256(f"{token}{settings.auth_secret}".encode("utf-8")).hexdigest()


def _public_user(user: User, credit: CreditAccount | None = None) -> dict[str, Any]:
    return {
        "id": str(user.id),
        "email": user.email,
        "plan": credit.plan if credit else "free",
        "trial_credits": credit.trial_credits if credit else 0,
        "paid_credits": credit.paid_credits if credit else 0,
        "daily_free_used": credit.daily_free_used if credit else 0,
    }


async def _create_session(
    *,
    request: Request,
    response: Response,
    db: AsyncSession,
    user: User,
) -> None:
    raw_token = secrets.token_urlsafe(32)
    max_age = settings.auth_session_max_age
    expires_at = datetime.now(UTC) + timedelta(seconds=max_age)
    session = UserSession(
        user_id=user.id,
        token_hash=_hash_session_token(raw_token),
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
        expires_at=expires_at,
    )
    db.add(session)
    await db.flush()
    response.set_cookie(
        settings.auth_cookie_name,
        raw_token,
        max_age=max_age,
        expires=expires_at,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite="lax",
        path="/",
    )


@router.post("/register")
async def register(payload: RegisterRequest, request: Request, response: Response, db: AsyncSession = Depends(get_database)) -> dict:
    email = _normalize_email(payload.email)
    if not EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="邮箱格式不正确")
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="密码至少需要 8 位")
    if not payload.accepted_disclaimer:
        raise HTTPException(status_code=400, detail="注册前必须确认免责声明")

    user = User(
        email=email,
        password_hash=_hash_password(payload.password),
        accepted_disclaimer_at=datetime.now(UTC),
    )
    db.add(user)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="该邮箱已注册，请直接登录") from exc

    credit = CreditAccount(user_id=user.id, plan="free")
    db.add(credit)
    await _create_session(request=request, response=response, db=db, user=user)
    await db.commit()
    return {"status": "ok", "user": _public_user(user, credit)}


@router.post("/login")
async def login(payload: LoginRequest, request: Request, response: Response, db: AsyncSession = Depends(get_database)) -> dict:
    email = _normalize_email(payload.email)
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active or not _verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="邮箱或密码不正确")

    await db.execute(update(User).where(User.id == user.id).values(last_login_at=datetime.now(UTC)))
    credit_result = await db.execute(select(CreditAccount).where(CreditAccount.user_id == user.id))
    credit = credit_result.scalar_one_or_none()
    if credit is None:
        credit = CreditAccount(user_id=user.id, plan="free")
        db.add(credit)
    await _create_session(request=request, response=response, db=db, user=user)
    await db.commit()
    return {"status": "ok", "user": _public_user(user, credit)}


@router.post("/logout")
async def logout(request: Request, response: Response, db: AsyncSession = Depends(get_database)) -> dict:
    token = request.cookies.get(settings.auth_cookie_name)
    if token:
        await db.execute(
            update(UserSession)
            .where(UserSession.token_hash == _hash_session_token(token), UserSession.revoked_at.is_(None))
            .values(revoked_at=datetime.now(UTC))
        )
        await db.commit()
    response.delete_cookie(settings.auth_cookie_name, path="/")
    return {"status": "ok"}


@router.get("/me")
async def me(request: Request, db: AsyncSession = Depends(get_database)) -> dict:
    token = request.cookies.get(settings.auth_cookie_name)
    if not token:
        raise HTTPException(status_code=401, detail="未登录")

    now = datetime.now(UTC)
    result = await db.execute(
        select(User, CreditAccount)
        .join(UserSession, UserSession.user_id == User.id)
        .outerjoin(CreditAccount, CreditAccount.user_id == User.id)
        .where(
            UserSession.token_hash == _hash_session_token(token),
            UserSession.revoked_at.is_(None),
            UserSession.expires_at > now,
            User.is_active.is_(True),
        )
    )
    row = result.first()
    if row is None:
        raise HTTPException(status_code=401, detail="登录已失效")
    user, credit = row
    return {"status": "ok", "user": _public_user(user, credit)}
