"""L2 行为信号 service。

被前端埋点(/api/signals)和后端流程(revision_made / diagnosis_completed 等)共用。
失败不抛错,绝不阻塞主流程。
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.memory import UserSignal

logger = logging.getLogger(__name__)


ALLOWED_SIGNAL_TYPES = {
    # 前端埋点
    "report_viewed",
    "master_endorsed",
    "risk_school_followed",
    "stock_action",
    "session_engagement",
    "revision_clicked",
    # 后端流程
    "revision_made",
    "revision_reverted",
    "diagnosis_completed",
    "diagnosis_revised",
}


async def record_signal(
    db: AsyncSession,
    anon_id: uuid.UUID,
    signal_type: str,
    payload: Optional[dict] = None,
    diagnosis_id: Optional[uuid.UUID] = None,
) -> Optional[UserSignal]:
    """记录一条用户行为信号。失败只记日志,绝不抛。"""
    if signal_type not in ALLOWED_SIGNAL_TYPES:
        logger.warning("rejected unknown signal_type: %s", signal_type)
        return None

    payload = payload or {}
    if len(json.dumps(payload)) > 8000:
        logger.warning("signal payload too large for %s, truncated", signal_type)
        payload = {"_truncated": True, "_original_keys": list(payload.keys())}

    try:
        signal = UserSignal(
            anon_id=anon_id,
            diagnosis_id=diagnosis_id,
            signal_type=signal_type,
            payload=payload,
        )
        db.add(signal)
        await db.commit()
        return signal
    except Exception:
        logger.exception("record_signal failed: type=%s", signal_type)
        await db.rollback()
        return None
