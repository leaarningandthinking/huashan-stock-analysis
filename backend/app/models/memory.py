"""L1~L4 四层记忆数据模型。

- L1 诊股卡片(DiagnosisCard):每次诊股结束自动生成的符号化压缩卡片
- L2 行为信号(UserSignal):前端埋点 + 后端事件累计
- L3 显式偏好(UserPreference) + 审计日志(PreferenceChangelog)
- L4 用户画像(UserProfile):LLM 反思 L1~L3 后产出
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


# ============================================================
# L3 显式偏好层
# ============================================================
class UserPreference(Base):
    """用户主动说出的诊股偏好,通过对话产出,可编辑可停用。

    一条偏好 = 一条会被原文拼到 system prompt 末尾的祈使句。
    """

    __tablename__ = "user_preferences"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    anon_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("anonymous_sessions.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    # scope 取值见 docs/MEMORY.md:global / analyst:<role> / risk:<school> /
    # master:* / master:<slug> / analyst:* / risk:*
    scope: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    instruction: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    # 'conversation' | 'manual' | 'promoted_from_profile'
    source: Mapped[str] = mapped_column(String(32), default="conversation")

    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    applied_count: Mapped[int] = mapped_column(Integer, default=0)
    last_applied_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    origin_diagnosis_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("diagnoses.id", ondelete="SET NULL"),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("ix_user_pref_anon_scope_active", "anon_id", "scope", "active"),
    )


class PreferenceChangelog(Base):
    """金融场景的审计日志,永不删除。"""

    __tablename__ = "preference_changelog"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    anon_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("anonymous_sessions.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    diagnosis_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("diagnoses.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # create | update | remove | disable | enable | rerun | promote
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    preference_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    before: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    after: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    user_utterance: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    rerun_plan: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


# ============================================================
# L2 行为信号层
# ============================================================
class UserSignal(Base):
    """用户行为信号,作为 L4 反思任务的输入。"""

    __tablename__ = "user_signals"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    anon_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("anonymous_sessions.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    diagnosis_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("diagnoses.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # signal_type:report_viewed / master_endorsed / risk_school_followed /
    # revision_made / revision_reverted / stock_action / session_engagement
    signal_type: Mapped[str] = mapped_column(String(48), index=True, nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )

    __table_args__ = (
        Index("ix_signal_anon_type_time", "anon_id", "signal_type", "created_at"),
    )


# ============================================================
# L1 诊股卡片层
# ============================================================
class DiagnosisCard(Base):
    """每次诊股结束后自动生成的符号化压缩卡片。

    用途:
    1. 反思任务的输入(比直接喂原始报告省 80%+ token)
    2. 前端"诊股历史时间线"的数据源
    """

    __tablename__ = "diagnosis_cards"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    anon_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("anonymous_sessions.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    diagnosis_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("diagnoses.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    # 卡片正文,结构详见 services/memory/card_builder.py 注释
    card: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


# ============================================================
# L4 用户画像层
# ============================================================
class UserProfile(Base):
    """LLM 反思 L1+L2+L3 后产出的用户画像,每次诊股自动注入到所有 prompt 顶部。"""

    __tablename__ = "user_profile"

    anon_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("anonymous_sessions.id", ondelete="CASCADE"),
        primary_key=True,
    )

    # ---------- LLM 生成的核心画像 ----------
    narrative: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    risk_appetite: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    preferred_horizon: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    decision_speed: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    focus_themes: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
    avoided_styles: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)

    # ---------- 元数据 ----------
    confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    reflection_version: Mapped[int] = mapped_column(Integer, default=0)
    source_signal_count: Mapped[int] = mapped_column(Integer, default=0)
    source_card_count: Mapped[int] = mapped_column(Integer, default=0)

    contradictions: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)

    last_reflected_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
