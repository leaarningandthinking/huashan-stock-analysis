"""L2 行为信号上报 API。

POST /api/signals  - 前端埋点上报
失败静默(record_signal 内部已经做了),绝不影响 UX。
"""

from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_anon, get_database
from app.services.memory.signals import record_signal

router = APIRouter(prefix="/api/signals", tags=["signals"])


class SignalRequest(BaseModel):
    type: str
    payload: dict = {}
    diagnosis_id: Optional[str] = None


@router.post("")
async def post_signal(
    req: SignalRequest,
    db: AsyncSession = Depends(get_database),
    anon=Depends(get_anon),
):
    diag_uuid = None
    if req.diagnosis_id:
        try:
            diag_uuid = uuid.UUID(req.diagnosis_id)
        except ValueError:
            diag_uuid = None
    await record_signal(
        db=db,
        anon_id=anon.id,
        signal_type=req.type,
        payload=req.payload,
        diagnosis_id=diag_uuid,
    )
    return {"ok": True}
