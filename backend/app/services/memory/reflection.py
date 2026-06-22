"""L4 用户画像反思 —— 自进化引擎。

工作流程:
1. 拉取该用户最近 30 天的 L1 诊股卡片 + L2 行为信号 + L3 显式偏好
2. 加上【上一版画像】作为对比基准
3. 调用 LLM 生成新画像(JSON 结构化输出)
4. 落库 UserProfile
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.base import LLMClient, Message
from app.models.memory import (
    DiagnosisCard,
    UserPreference,
    UserProfile,
    UserSignal,
)

logger = logging.getLogger(__name__)


REFLECTION_SYSTEM_PROMPT = """你是华山论股的用户洞察分析师。

你的任务:基于一个用户最近一段时间在平台上的所有交互数据,
生成或更新这个用户的【投资画像】。这个画像会被注入到他未来每次诊股的
LLM prompt 中,影响所有大师/分析师/风控的输出风格。

你看到的数据有 4 类:
1. **诊股卡片(L1)**:这个用户最近做过哪些诊股,信号是什么,共识如何
2. **行为信号(L2)**:他在报告页停留多久、采纳了哪派建议、撤销了哪些机器人提议
3. **显式偏好(L3)**:他主动说出过的诊股偏好
4. **上一版画像**:你或前一个反思任务为这个用户生成的画像

## 核心原则

**只发现"用户没说出口的偏好"**:
画像的价值是发现 L3 没有的、但 L2 行为里反复出现的模式。
不要重复 L3 已经说过的偏好 —— 那些已经被注入 prompt 了。

**用行为佐证判断,而非空谈**:
不要写"该用户比较保守"这种笼统话。
要写"该用户在最近 12 次诊股中,有 10 次采纳保守派风控建议 → 风险偏好为 0.25"。

**主动发现矛盾**:
如果发现某条 L3 显式偏好与 L2 行为矛盾(用户说要谨慎但实际追高),
在 `contradictions` 字段标注。

**保守输出,标注置信度**:
数据少时 confidence < 0.5,数据多且模式清晰时 confidence > 0.8。
不确定的字段直接留空,绝不编造。

## 输出格式

严格按以下 JSON 输出,**不要任何额外文字、不要 markdown 代码块包裹**:

{
  "narrative": "3-5 句话的自然语言画像,会被原文注入未来 prompt",
  "risk_appetite": 0.0~1.0 或 null,
  "preferred_horizon": "short"|"mid"|"long" 或 null,
  "decision_speed": "fast"|"deliberate" 或 null,
  "focus_themes": ["主题1", "主题2"] 或 [],
  "avoided_styles": ["要避免的风格1", ...] 或 [],
  "confidence": 0.0~1.0,
  "contradictions": [
    {
      "explicit_pref_id": "L3 偏好的 UUID",
      "behavior_evidence": "L2 里观察到的矛盾证据",
      "suggestion": "向用户反向提问的建议"
    }
  ],
  "change_vs_previous": "可选,描述与上一版画像相比哪些方面变化了"
}
"""


async def reflect_user_profile(
    db: AsyncSession,
    anon_id: uuid.UUID,
    llm_client: LLMClient,
    llm_model: Optional[str] = None,
    lookback_days: int = 30,
) -> Optional[UserProfile]:
    """跑一次反思,产出/更新用户画像。

    failure mode:
    - 数据极少 → 返回 None,不更新画像
    - LLM 调用失败 / 返回非合法 JSON → 返回 None,保留旧画像
    """
    cards = await _load_recent_cards(db, anon_id, lookback_days)
    signals = await _load_recent_signals(db, anon_id, lookback_days)
    prefs = await _load_active_prefs(db, anon_id)
    old_profile = await db.get(UserProfile, anon_id)

    # 数据量护栏
    if len(cards) < 3 and len(signals) < 5 and len(prefs) == 0:
        logger.info(
            "reflect skipped for %s: insufficient data (cards=%d, signals=%d, prefs=%d)",
            anon_id, len(cards), len(signals), len(prefs),
        )
        return None

    user_prompt = _build_user_prompt(cards, signals, prefs, old_profile)

    try:
        # 项目的 chat 用 Message dataclass + 返回 ChatResult.content
        result = await llm_client.chat(
            messages=[
                Message(role="system", content=REFLECTION_SYSTEM_PROMPT),
                Message(role="user", content=user_prompt),
            ],
            model=llm_model or "",
            temperature=0.4,
            max_tokens=2000,
        )
        text = result.content
    except Exception:
        logger.exception("reflect LLM call failed for %s", anon_id)
        return None

    parsed = _parse_llm_output(text)
    if not parsed:
        logger.warning("reflect LLM output unparseable for %s: %s", anon_id, text[:200])
        return None

    # 更新或创建画像
    is_new = old_profile is None
    if is_new:
        profile = UserProfile(anon_id=anon_id)
        db.add(profile)
    else:
        profile = old_profile

    profile.narrative = parsed.get("narrative")
    profile.risk_appetite = _coerce_float(parsed.get("risk_appetite"))
    profile.preferred_horizon = parsed.get("preferred_horizon")
    profile.decision_speed = parsed.get("decision_speed")
    profile.focus_themes = parsed.get("focus_themes") or []
    profile.avoided_styles = parsed.get("avoided_styles") or []
    profile.confidence = _coerce_float(parsed.get("confidence"))
    profile.contradictions = parsed.get("contradictions") or []
    profile.reflection_version = (
        1 if is_new else (old_profile.reflection_version + 1)
    )
    profile.source_signal_count = len(signals)
    profile.source_card_count = len(cards)
    profile.last_reflected_at = datetime.utcnow()

    await db.commit()
    logger.info(
        "reflect updated profile %s (v%d, conf=%.2f)",
        anon_id, profile.reflection_version, profile.confidence or 0,
    )
    return profile


def _coerce_float(v) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# ============================================================
# 数据加载
# ============================================================
async def _load_recent_cards(
    db: AsyncSession, anon_id: uuid.UUID, days: int
) -> list[DiagnosisCard]:
    since = datetime.utcnow() - timedelta(days=days)
    stmt = (
        select(DiagnosisCard)
        .where(DiagnosisCard.anon_id == anon_id)
        .where(DiagnosisCard.created_at >= since)
        .order_by(DiagnosisCard.created_at.desc())
        .limit(30)
    )
    return list((await db.execute(stmt)).scalars().all())


async def _load_recent_signals(
    db: AsyncSession, anon_id: uuid.UUID, days: int
) -> list[UserSignal]:
    since = datetime.utcnow() - timedelta(days=days)
    stmt = (
        select(UserSignal)
        .where(UserSignal.anon_id == anon_id)
        .where(UserSignal.created_at >= since)
        .order_by(UserSignal.created_at.desc())
        .limit(200)
    )
    return list((await db.execute(stmt)).scalars().all())


async def _load_active_prefs(
    db: AsyncSession, anon_id: uuid.UUID
) -> list[UserPreference]:
    stmt = (
        select(UserPreference)
        .where(UserPreference.anon_id == anon_id)
        .where(UserPreference.active.is_(True))
    )
    return list((await db.execute(stmt)).scalars().all())


# ============================================================
# Prompt 构造
# ============================================================
def _build_user_prompt(
    cards: list[DiagnosisCard],
    signals: list[UserSignal],
    prefs: list[UserPreference],
    old_profile: Optional[UserProfile],
) -> str:
    parts = []

    parts.append("# 上一版画像")
    if old_profile and old_profile.narrative:
        parts.append(
            f"版本:v{old_profile.reflection_version}, "
            f"置信度:{old_profile.confidence or 0:.2f}, "
            f"更新于:{old_profile.last_reflected_at}\n"
            f"{old_profile.narrative}"
        )
    else:
        parts.append("(无,这是首次为该用户生成画像)")
    parts.append("")

    parts.append(f"# 用户主动说出的偏好(L3,共 {len(prefs)} 条)")
    if prefs:
        for p in prefs:
            parts.append(
                f"- [{p.scope}] {p.instruction} "
                f"(应用 {p.applied_count} 次, id={str(p.id)[:8]})"
            )
    else:
        parts.append("(无)")
    parts.append("")

    parts.append(f"# 最近的诊股卡片(L1,共 {len(cards)} 张)")
    for c in cards[:15]:
        parts.append(f"## 诊股 {c.created_at.strftime('%m-%d %H:%M')}")
        parts.append(json.dumps(c.card, ensure_ascii=False, indent=2))
        parts.append("")

    parts.append(f"# 行为信号(L2,共 {len(signals)} 条)")
    stats = _aggregate_signals(signals)
    parts.append("## 聚合统计")
    parts.append(json.dumps(stats, ensure_ascii=False, indent=2))
    parts.append("")
    parts.append("## 近期原始事件(取最新 20 条)")
    for s in signals[:20]:
        parts.append(
            f"- [{s.created_at.strftime('%m-%d %H:%M')}] {s.signal_type}: "
            f"{json.dumps(s.payload, ensure_ascii=False)}"
        )

    return "\n".join(parts)


def _aggregate_signals(signals: list[UserSignal]) -> dict:
    by_type: dict[str, int] = {}
    risk_followed = {"took_advice": 0, "ignored": 0}
    risk_school_taken: dict[str, int] = {}
    reverts = 0
    avg_view_duration: list[float] = []

    for s in signals:
        by_type[s.signal_type] = by_type.get(s.signal_type, 0) + 1
        payload = s.payload or {}

        if s.signal_type == "risk_school_followed":
            action = payload.get("action")
            if action in risk_followed:
                risk_followed[action] += 1
            school = payload.get("school")
            if action == "took_advice" and school:
                risk_school_taken[school] = risk_school_taken.get(school, 0) + 1

        if s.signal_type == "revision_reverted":
            reverts += 1

        if s.signal_type == "report_viewed":
            d = payload.get("view_duration_sec")
            if isinstance(d, (int, float)):
                avg_view_duration.append(d)

    return {
        "type_counts": by_type,
        "risk_school_adoption": risk_school_taken,
        "risk_advice_taken_vs_ignored": risk_followed,
        "revisions_reverted_count": reverts,
        "avg_view_duration_sec": (
            sum(avg_view_duration) / len(avg_view_duration)
            if avg_view_duration else None
        ),
    }


# ============================================================
# LLM 输出解析(容错)
# ============================================================
def _parse_llm_output(text: str) -> Optional[dict]:
    if not text:
        return None
    text = text.strip()

    # 剥 markdown 代码块
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text
        if text.endswith("```"):
            text = text.rsplit("```", 1)[0]
        text = text.strip()

    try:
        data = json.loads(text)
        if not isinstance(data, dict):
            return None
        return data
    except json.JSONDecodeError:
        # 第二次尝试:抽取最外层的 {} 块
        match = re.search(r"\{[\s\S]*\}", text)
        if match:
            try:
                data = json.loads(match.group(0))
                if isinstance(data, dict):
                    return data
            except json.JSONDecodeError:
                return None
    return None
