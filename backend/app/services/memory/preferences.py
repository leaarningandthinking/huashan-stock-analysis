"""L3 显式偏好的核心 service,被 4 分析师 / 2 风控 / 大师辩论调用。"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Iterable

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.memory import UserPreference


def _matching_scopes(target_scope: str) -> list[str]:
    """注入 analyst:technical 时拉取 [global, analyst:technical, analyst:*]。

    不拉取其他 analyst 的偏好,避免污染。
    """
    scopes = ["global"]
    if target_scope == "global":
        return scopes
    scopes.append(target_scope)
    category = target_scope.split(":", 1)[0]
    scopes.append(f"{category}:*")
    return scopes


async def load_active_preferences(
    db: AsyncSession,
    anon_id: uuid.UUID,
    target_scope: str,
) -> list[UserPreference]:
    """拉取作用于 target_scope 的全部生效偏好。"""
    scopes = _matching_scopes(target_scope)
    stmt = (
        select(UserPreference)
        .where(UserPreference.anon_id == anon_id)
        .where(UserPreference.scope.in_(scopes))
        .where(UserPreference.active.is_(True))
        .order_by(UserPreference.created_at)
    )
    return list((await db.execute(stmt)).scalars().all())


def render_preferences_block(prefs: Iterable[UserPreference]) -> str:
    """把偏好渲染成可拼到 system prompt 末尾的一段文本。"""
    prefs = list(prefs)
    if not prefs:
        return ""
    lines = ["", "## 用户个性化偏好(优先级高于上述方法论)"]
    for i, p in enumerate(prefs, 1):
        lines.append(f"{i}. {p.instruction}")
    lines.append(
        "请严格遵守以上偏好。若偏好与你的常规判断冲突,"
        "应在结论中明确说明你是依据用户偏好做出的调整。"
    )
    return "\n".join(lines)


async def apply_prefs_to_prompt(
    db: AsyncSession,
    anon_id: uuid.UUID | None,
    target_scope: str,
    base_prompt: str,
) -> tuple[str, list[uuid.UUID]]:
    """给 base_prompt 末尾拼上用户偏好。返回 (注入后 prompt, 被应用的 pref id 列表)。"""
    if anon_id is None:
        return base_prompt, []
    prefs = await load_active_preferences(db, anon_id, target_scope)
    if not prefs:
        return base_prompt, []
    block = render_preferences_block(prefs)
    return base_prompt + "\n" + block, [p.id for p in prefs]


async def mark_preferences_applied(
    db: AsyncSession,
    pref_ids: list[uuid.UUID],
) -> None:
    """LLM 实际跑完后回写使用统计。失败不计数。"""
    if not pref_ids:
        return
    stmt = (
        update(UserPreference)
        .where(UserPreference.id.in_(pref_ids))
        .values(
            applied_count=UserPreference.applied_count + 1,
            last_applied_at=datetime.utcnow(),
        )
    )
    await db.execute(stmt)
    await db.commit()
