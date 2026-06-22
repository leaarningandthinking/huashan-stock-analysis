"""统一的记忆注入入口:L3 偏好 + L4 画像 一起拼到 base prompt。"""

from __future__ import annotations

import uuid
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.memory import UserProfile
from app.services.memory.preferences import (
    apply_prefs_to_prompt,
    mark_preferences_applied,
)


def render_profile_block(profile: Optional[UserProfile]) -> str:
    """把 UserProfile 渲染成 prompt 片段。

    设计原则:
    - 仅高置信度时才渲染(confidence < 0.4 不注入)
    - 用第二人称,让 LLM 像了解一个老客户一样了解 ta
    - 明确标注信息来源是【行为推断】
    """
    if profile is None:
        return ""
    if profile.confidence is not None and profile.confidence < 0.4:
        return ""
    if not profile.narrative:
        return ""

    lines = [
        "## 用户画像(基于历史行为推断,优先级低于明确的用户个性化偏好)",
        "",
        profile.narrative.strip(),
        "",
    ]

    extras = []
    if profile.risk_appetite is not None:
        ra = profile.risk_appetite
        label = (
            "极保守" if ra < 0.2 else
            "偏保守" if ra < 0.4 else
            "中性" if ra < 0.6 else
            "偏激进" if ra < 0.8 else "极激进"
        )
        extras.append(f"- 风险偏好: {label}(评分 {ra:.2f})")
    if profile.preferred_horizon:
        horizon_label = {
            "short": "短线(数日到数周)",
            "mid": "中线(数周到数月)",
            "long": "长线(半年以上)",
        }.get(profile.preferred_horizon, profile.preferred_horizon)
        extras.append(f"- 偏好持有周期: {horizon_label}")
    if profile.focus_themes:
        extras.append(f"- 关注主题: {', '.join(profile.focus_themes)}")
    if profile.avoided_styles:
        extras.append(f"- 避免的风格: {', '.join(profile.avoided_styles)}")

    if extras:
        lines.extend(extras)
        lines.append("")

    lines.append(
        "请在分析中体现对该用户的理解,但**不要直接复述画像内容**,"
        "而是让你的判断尺度自然贴合他的风格。"
    )
    return "\n".join(lines)


async def inject_memory_into_prompt(
    db: AsyncSession,
    anon_id: Optional[uuid.UUID],
    target_scope: str,
    base_prompt: str,
) -> tuple[str, list[uuid.UUID]]:
    """把 L3 偏好 + L4 画像注入到 base_prompt。

    结构:
        [L4 画像]      ← 顶部
        [base_prompt]  ← 中间
        [L3 偏好附加]  ← 底部强调

    返回 (注入后 prompt, 被应用的 pref id 列表)。
    """
    if anon_id is None:
        return base_prompt, []

    profile = await db.get(UserProfile, anon_id)
    profile_block = render_profile_block(profile)

    prompt_with_prefs, pref_ids = await apply_prefs_to_prompt(
        db, anon_id, target_scope, base_prompt
    )

    if not profile_block:
        return prompt_with_prefs, pref_ids
    return profile_block + "\n\n" + prompt_with_prefs, pref_ids


__all__ = [
    "inject_memory_into_prompt",
    "mark_preferences_applied",
    "render_profile_block",
]
