from datetime import datetime
import uuid

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Portfolio(Base):
    """持仓快照（每次诊断存一份）。也用于单股 / 批量场景，holdings_json 内含 mode 标记。"""

    __tablename__ = "portfolios"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    anon_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("anonymous_sessions.id"), nullable=True, index=True
    )
    holdings_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    raw_input: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Diagnosis(Base):
    __tablename__ = "diagnoses"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    portfolio_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("portfolios.id"), nullable=False
    )
    anon_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("anonymous_sessions.id"), nullable=True, index=True
    )
    # mode: 'single_stock' | 'batch_stocks' | 'portfolio'
    mode: Mapped[str] = mapped_column(String(32), nullable=False)
    masters: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False)
    # status: 'pending' | 'running' | 'done' | 'failed'
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    events_jsonb: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    report_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ShareLink(Base):
    __tablename__ = "share_links"

    code: Mapped[str] = mapped_column(String(16), primary_key=True)
    diagnosis_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("diagnoses.id"), nullable=False
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    visit_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
