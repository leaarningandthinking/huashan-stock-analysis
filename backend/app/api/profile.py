"""「我的诊股 Agent」页面的所有数据接口。

- GET  /api/profile              - 画像信息
- POST /api/profile/reflect      - 手动触发反思生成画像
- GET  /api/profile/preferences  - 列偏好
- PATCH/DELETE /api/profile/preferences/{id}
- GET  /api/profile/timeline     - 诊股历史时间线
- GET  /api/profile/changelog    - 审计日志
- GET  /api/profile/diagnosis_preview - 启动页预告
"""

from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_anon, get_database
from app.llm.factory import build_client
from app.models.memory import (
    DiagnosisCard,
    PreferenceChangelog,
    UserPreference,
    UserProfile,
)

router = APIRouter(prefix="/api/profile", tags=["profile"])


# ============================================================
# GET /api/profile
# ============================================================
@router.get("")
async def get_profile(
    db: AsyncSession = Depends(get_database),
    anon=Depends(get_anon),
):
    profile = await db.get(UserProfile, anon.id)

    pref_count_stmt = select(UserPreference).where(
        UserPreference.anon_id == anon.id,
        UserPreference.active.is_(True),
    )
    pref_count = len((await db.execute(pref_count_stmt)).scalars().all())

    diag_count_stmt = select(DiagnosisCard).where(
        DiagnosisCard.anon_id == anon.id
    )
    diag_count = len((await db.execute(diag_count_stmt)).scalars().all())

    if profile is None:
        return {
            "exists": False,
            "diagnosis_count": diag_count,
            "preference_count": pref_count,
            "needs_more_data": diag_count < 3,
            "hint": (
                "完成 3 次诊股后将自动生成你的画像 v1"
                if diag_count < 3
                else "数据已足够,可手动触发反思生成画像"
            ),
        }

    return {
        "exists": True,
        "version": profile.reflection_version,
        "narrative": profile.narrative,
        "risk_appetite": profile.risk_appetite,
        "preferred_horizon": profile.preferred_horizon,
        "decision_speed": profile.decision_speed,
        "focus_themes": profile.focus_themes or [],
        "avoided_styles": profile.avoided_styles or [],
        "confidence": profile.confidence,
        "contradictions": profile.contradictions or [],
        "source_signal_count": profile.source_signal_count,
        "source_card_count": profile.source_card_count,
        "last_reflected_at": (
            profile.last_reflected_at.isoformat() if profile.last_reflected_at else None
        ),
        "preference_count": pref_count,
        "diagnosis_count": diag_count,
    }


# ============================================================
# POST /api/profile/reflect  (Phase 7 才真正生效)
# ============================================================
class ReflectRequest(BaseModel):
    provider: str
    api_key: str
    base_url: Optional[str] = None
    model: Optional[str] = None


@router.post("/reflect")
async def trigger_reflection(
    payload: ReflectRequest,
    db: AsyncSession = Depends(get_database),
    anon=Depends(get_anon),
):
    """手动触发用户画像反思。Phase 7 才上线 reflection 实现。"""
    try:
        # 延迟导入:Phase 7 之前 reflection.py 不存在
        from app.services.memory.reflection import reflect_user_profile
    except ImportError:
        raise HTTPException(
            503, "反思功能尚未上线(等待 Phase 7 实施)"
        )

    client = build_client(
        provider_id=payload.provider,
        api_key=payload.api_key,
        base_url=payload.base_url,
    )
    profile = await reflect_user_profile(
        db=db,
        anon_id=anon.id,
        llm_client=client,
        llm_model=payload.model,
    )
    if profile is None:
        raise HTTPException(
            422, "反思失败:可能数据太少或 LLM 调用异常,请稍后再试"
        )
    return {
        "ok": True,
        "version": profile.reflection_version,
        "narrative": profile.narrative,
    }


# ============================================================
# 偏好管理
# ============================================================
@router.get("/preferences")
async def list_preferences(
    db: AsyncSession = Depends(get_database),
    anon=Depends(get_anon),
):
    """列出所有偏好(含已停用)。"""
    stmt = (
        select(UserPreference)
        .where(UserPreference.anon_id == anon.id)
        .order_by(desc(UserPreference.created_at))
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [
        {
            "id": str(p.id),
            "scope": p.scope,
            "instruction": p.instruction,
            "summary": p.summary,
            "active": p.active,
            "source": p.source,
            "applied_count": p.applied_count,
            "last_applied_at": p.last_applied_at.isoformat() if p.last_applied_at else None,
            "created_at": p.created_at.isoformat(),
            "origin_diagnosis_id": (
                str(p.origin_diagnosis_id) if p.origin_diagnosis_id else None
            ),
        }
        for p in rows
    ]


class PreferencePatch(BaseModel):
    active: Optional[bool] = None
    instruction: Optional[str] = None
    summary: Optional[str] = None


@router.patch("/preferences/{pref_id}")
async def update_preference(
    pref_id: str,
    patch: PreferencePatch,
    db: AsyncSession = Depends(get_database),
    anon=Depends(get_anon),
):
    try:
        pid = uuid.UUID(pref_id)
    except ValueError:
        raise HTTPException(400)

    pref = await db.get(UserPreference, pid)
    if not pref or pref.anon_id != anon.id:
        raise HTTPException(404)

    before = {
        "active": pref.active,
        "instruction": pref.instruction,
        "summary": pref.summary,
    }

    if patch.active is not None:
        pref.active = patch.active
    if patch.instruction is not None:
        pref.instruction = patch.instruction
    if patch.summary is not None:
        pref.summary = patch.summary

    db.add(PreferenceChangelog(
        anon_id=anon.id,
        action="update" if patch.active is None else (
            "enable" if patch.active else "disable"
        ),
        preference_id=pid,
        before=before,
        after={
            "active": pref.active,
            "instruction": pref.instruction,
            "summary": pref.summary,
        },
    ))
    await db.commit()
    return {"ok": True}


@router.delete("/preferences/{pref_id}")
async def delete_preference(
    pref_id: str,
    db: AsyncSession = Depends(get_database),
    anon=Depends(get_anon),
):
    try:
        pid = uuid.UUID(pref_id)
    except ValueError:
        raise HTTPException(400)
    pref = await db.get(UserPreference, pid)
    if pref and pref.anon_id == anon.id:
        db.add(PreferenceChangelog(
            anon_id=anon.id,
            action="remove",
            preference_id=pid,
            before={
                "scope": pref.scope,
                "instruction": pref.instruction,
                "active": pref.active,
            },
        ))
        await db.delete(pref)
        await db.commit()
    return {"ok": True}


# ============================================================
# GET /api/profile/timeline
# ============================================================
@router.get("/timeline")
async def get_timeline(
    limit: int = 20,
    db: AsyncSession = Depends(get_database),
    anon=Depends(get_anon),
):
    """返回最近 N 张诊股卡片,用于前端时间线展示。"""
    stmt = (
        select(DiagnosisCard)
        .where(DiagnosisCard.anon_id == anon.id)
        .order_by(desc(DiagnosisCard.created_at))
        .limit(min(limit, 50))
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [
        {
            "diagnosis_id": str(c.diagnosis_id),
            "created_at": c.created_at.isoformat(),
            "stocks": c.card.get("stocks", []),
            "mode": c.card.get("mode"),
            "consensus": c.card.get("consensus"),
            "risk_lean": c.card.get("risk_lean"),
            "revision_count": c.card.get("revision_count", 0),
        }
        for c in rows
    ]


# ============================================================
# GET /api/profile/changelog
# ============================================================
@router.get("/changelog")
async def get_changelog(
    limit: int = 50,
    db: AsyncSession = Depends(get_database),
    anon=Depends(get_anon),
):
    stmt = (
        select(PreferenceChangelog)
        .where(PreferenceChangelog.anon_id == anon.id)
        .order_by(desc(PreferenceChangelog.created_at))
        .limit(min(limit, 200))
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [
        {
            "id": str(r.id),
            "action": r.action,
            "preference_id": str(r.preference_id) if r.preference_id else None,
            "diagnosis_id": str(r.diagnosis_id) if r.diagnosis_id else None,
            "before": r.before,
            "after": r.after,
            "rerun_plan": r.rerun_plan,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


# ============================================================
# GET /api/profile/diagnosis_preview
# ============================================================
@router.get("/diagnosis_preview")
async def get_diagnosis_preview(
    db: AsyncSession = Depends(get_database),
    anon=Depends(get_anon),
):
    """给诊股启动页(Phase F6)提供预告数据。"""
    profile = await db.get(UserProfile, anon.id)
    pref_stmt = select(UserPreference).where(
        UserPreference.anon_id == anon.id,
        UserPreference.active.is_(True),
    )
    prefs = (await db.execute(pref_stmt)).scalars().all()

    by_scope = {"global": 0, "analyst": 0, "master": 0, "risk": 0}
    for p in prefs:
        if p.scope == "global":
            by_scope["global"] += 1
        elif p.scope.startswith("analyst:"):
            by_scope["analyst"] += 1
        elif p.scope.startswith("master:"):
            by_scope["master"] += 1
        elif p.scope.startswith("risk:"):
            by_scope["risk"] += 1

    return {
        "preference_count": len(prefs),
        "preference_by_scope": by_scope,
        "profile_version": profile.reflection_version if profile else 0,
        "profile_summary": _short_profile_summary(profile) if profile else None,
        "is_first_diagnosis": profile is None and len(prefs) == 0,
    }


def _short_profile_summary(profile: UserProfile) -> str:
    if not profile:
        return ""
    parts = []
    if profile.risk_appetite is not None:
        ra = profile.risk_appetite
        parts.append(
            "极保守" if ra < 0.2 else
            "偏保守" if ra < 0.4 else
            "中性" if ra < 0.6 else
            "偏激进" if ra < 0.8 else "激进"
        )
    if profile.preferred_horizon:
        parts.append({"short": "短线", "mid": "中线", "long": "长线"}.get(
            profile.preferred_horizon, ""
        ))
    if profile.focus_themes:
        parts.append("关注 " + "/".join(profile.focus_themes[:2]))
    return " · ".join(p for p in parts if p)
