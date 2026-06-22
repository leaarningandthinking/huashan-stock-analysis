"""诊断流程主入口。

POST /api/diagnosis/start  — 创建会话 + 把 LLM 配置临时存内存（用完丢）
GET  /api/diagnosis/{id}/stream  — SSE 流式输出
GET  /api/diagnosis/{id}  — 拿最终报告（结束后用）
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from secrets import token_urlsafe

from fastapi import APIRouter, Depends, HTTPException, Request
from redis.asyncio import Redis
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.api.deps import get_anon, get_database, get_redis_dep
from app.config import get_settings
from app.core.sse import EventQueue, SSEEvent
from app.db import SessionLocal
from app.models.anonymous import AnonymousSession
from app.models.diagnosis import Diagnosis, Portfolio, ShareLink
from app.schemas.diagnosis import (
    DiagnosisReportResponse,
    DiagnosisStartRequest,
    DiagnosisStartResponse,
    DiagnosisTaskSummary,
    ShareCreateRequest,
    ShareCreateResponse,
    ShareReportResponse,
)
from app.services.orchestrator import run_diagnosis_w5a
from app.api.profile import get_diagnosis_preview as _get_personalization_preview

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/diagnosis", tags=["diagnosis"])
share_router = APIRouter(prefix="/api/share", tags=["share"])
settings = get_settings()

# 后台任务仍在内存中，因为 LLM API Key 不落库。
# 事件和最终报告会落库，所以浏览器刷新 / SSE 重连可以恢复。
_RUNNING: dict[str, asyncio.Task] = {}

VALID_STATUSES = {"pending", "running", "done", "failed"}
MODE_ALIASES = {
    "single": "single",
    "single_stock": "single",
    "batch": "batch",
    "batch_stocks": "batch",
    "portfolio": "portfolio",
}


def _event_to_record(ev: SSEEvent) -> dict:
    return {"id": ev.id, "event": ev.event, "data": ev.data}


def _next_event_id(events: list | None) -> int:
    max_id = 0
    for rec in events or []:
        try:
            max_id = max(max_id, int(rec.get("id") or 0))
        except (AttributeError, TypeError, ValueError):
            continue
    return max_id + 1


def _bootstrap_events(*, mode: str, holdings: list[dict]) -> list[dict]:
    valid_holdings = [h for h in holdings if h.get("valid")]
    stocks = [
        {"code": h.get("code"), "name": h.get("name")}
        for h in valid_holdings
        if h.get("code")
    ]
    events = [
        {
            "id": "1",
            "event": "diagnosis.context",
            "data": {"mode": mode, "stocks": stocks},
        }
    ]
    first_step = 2 if mode == "single" else 1
    first_name = "分析师团队" if first_step == 2 else "持仓概览"
    events.append(
        {
            "id": "2",
            "event": "step.start",
            "data": {"step": first_step, "name": first_name},
        }
    )
    return events


def _normalize_status(status: str | None) -> str:
    return status if status in VALID_STATUSES else "failed"


def _normalize_mode(mode: str | None) -> str | None:
    if mode is None:
        return None
    return MODE_ALIASES.get(mode, None)


def _portfolio_payload(portfolio: Portfolio | None) -> dict:
    payload = portfolio.holdings_json if portfolio else {}
    return payload if isinstance(payload, dict) else {}


def _valid_stock_summaries(portfolio: Portfolio | None) -> list[dict]:
    payload = _portfolio_payload(portfolio)
    holdings = payload.get("holdings", [])
    if not isinstance(holdings, list):
        return []

    stocks: list[dict] = []
    for holding in holdings:
        if not isinstance(holding, dict) or not holding.get("valid"):
            continue
        code = str(holding.get("code") or "").strip()
        name = str(holding.get("name") or code or "未知标的").strip()
        if code:
            stocks.append({"code": code, "name": name})
    return stocks


async def _append_event(diagnosis_id: str, ev: SSEEvent) -> None:
    diag_uuid = uuid.UUID(diagnosis_id)
    async with SessionLocal() as db:
        diag = await db.get(Diagnosis, diag_uuid)
        if diag is None:
            return
        events = list(diag.events_jsonb or [])
        events.append(_event_to_record(ev))
        diag.events_jsonb = events
        await db.commit()


async def _run_and_persist(diagnosis_id: str, pending: dict) -> None:
    diag_uuid = uuid.UUID(diagnosis_id)
    start_id = 1
    try:
        async with SessionLocal() as db:
            diag = await db.get(Diagnosis, diag_uuid)
            if diag:
                diag.status = "running"
                start_id = _next_event_id(list(diag.events_jsonb or []))
                await db.commit()

        queue = EventQueue(
            on_emit=lambda ev: _append_event(diagnosis_id, ev),
            start_id=start_id,
        )

        anon_id_str = pending.get("anon_id")
        anon_id_uuid = uuid.UUID(anon_id_str) if anon_id_str else None
        report = await run_diagnosis_w5a(
            queue=queue,
            holdings=pending["holdings"],
            masters=pending["masters"],
            llm_config=pending["llm"],
            mode=pending.get("mode", "portfolio"),
            anon_id=anon_id_uuid,
        )

        async with SessionLocal() as db:
            diag2 = await db.get(Diagnosis, diag_uuid)
            if diag2:
                diag2.status = report.get("status", "done")
                diag2.report_json = report
                diag2.finished_at = datetime.now(timezone.utc)
                await db.commit()
                # Phase 6: 生成 L1 诊股卡片(失败不阻塞)
                try:
                    from app.services.memory.card_builder import build_and_save_card
                    await build_and_save_card(db, diag2)
                except Exception:
                    logger.exception("build_and_save_card failed; not critical")
                # 记录 diagnosis_completed 信号
                try:
                    from app.services.memory.signals import record_signal
                    if diag2.anon_id:
                        await record_signal(
                            db, diag2.anon_id, "diagnosis_completed",
                            payload={"status": diag2.status, "mode": diag2.mode},
                            diagnosis_id=diag2.id,
                        )
                except Exception:
                    logger.exception("record_signal diagnosis_completed failed")
    except Exception as e:
        logger.exception("diagnosis producer failed")
        try:
            queue = locals().get("queue")
            if queue is None:
                queue = EventQueue(on_emit=lambda ev: _append_event(diagnosis_id, ev))
            await queue.emit("error", code="PRODUCER_FAILED",
                             message=f"{type(e).__name__}: {str(e)[:200]}")
        finally:
            async with SessionLocal() as db:
                diag3 = await db.get(Diagnosis, diag_uuid)
                if diag3:
                    diag3.status = "failed"
                    diag3.error_message = f"{type(e).__name__}: {str(e)[:500]}"
                    diag3.finished_at = datetime.now(timezone.utc)
                    await db.commit()
    finally:
        _RUNNING.pop(diagnosis_id, None)


@router.post("/start", response_model=DiagnosisStartResponse)
async def start(
    req: DiagnosisStartRequest,
    anon: AnonymousSession = Depends(get_anon),
    db: AsyncSession = Depends(get_database),
    redis: Redis = Depends(get_redis_dep),
) -> DiagnosisStartResponse:
    # 校验 portfolio_id 存在且属于本会话
    try:
        pf_uuid = uuid.UUID(req.portfolio_id)
    except ValueError:
        raise HTTPException(400, "portfolio_id 不是合法 UUID")

    pf = (await db.execute(select(Portfolio).where(Portfolio.id == pf_uuid))).scalar_one_or_none()
    if pf is None:
        raise HTTPException(404, "持仓不存在")
    # 简单的会话归属检查（W5a 不强制，先记 warning）
    if pf.anon_id and pf.anon_id != anon.id:
        logger.warning("diagnosis start cross-session: pf.anon=%s vs req.anon=%s",
                       pf.anon_id, anon.id)

    holdings = pf.holdings_json.get("holdings", [])
    if not holdings:
        raise HTTPException(400, "持仓为空")

    await _check_daily_limit(redis, anon)

    mode = pf.holdings_json.get("mode", "portfolio")

    diag = Diagnosis(
        portfolio_id=pf.id,
        anon_id=anon.id,
        mode=mode,
        masters=req.masters,
        status="pending",
        events_jsonb=_bootstrap_events(mode=mode, holdings=holdings),
    )
    db.add(diag)
    await db.commit()
    await db.refresh(diag)

    diagnosis_id = str(diag.id)
    pending = {
        "holdings": holdings,
        "masters": req.masters,
        "llm": req.llm.model_dump(),
        "mode": mode,
        "anon_id": str(anon.id),
    }
    _RUNNING[diagnosis_id] = asyncio.create_task(_run_and_persist(diagnosis_id, pending))

    # Phase 8:启动接口附带 personalization 预告(失败不阻塞)
    personalization = None
    try:
        personalization = await _get_personalization_preview(db=db, anon=anon)
    except Exception:
        logger.exception("personalization preview failed; omit from start response")

    return DiagnosisStartResponse(
        diagnosis_id=diagnosis_id,
        stream_url=f"/api/diagnosis/{diagnosis_id}/stream",
        personalization=personalization,
    )


async def _check_daily_limit(redis: Redis, anon: AnonymousSession) -> None:
    key = f"ratelimit:diagnosis:{date.today().isoformat()}:{anon.id}"
    try:
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, 60 * 60 * 30)
    except Exception:
        logger.exception("rate limit redis failed; allowing request")
        return
    if count > settings.rate_limit_per_day:
        raise HTTPException(
            429,
            f"今日诊断次数已达上限（{settings.rate_limit_per_day} 次），请明天再试",
        )


@router.get("", response_model=list[DiagnosisTaskSummary])
async def list_tasks(
    anon: AnonymousSession = Depends(get_anon),
    db: AsyncSession = Depends(get_database),
) -> list[DiagnosisTaskSummary]:
    """按时间倒序返回当前匿名会话的分析任务。"""
    rows = (
        await db.execute(
            select(Diagnosis, Portfolio)
            .join(Portfolio, Portfolio.id == Diagnosis.portfolio_id)
            .where(Diagnosis.anon_id == anon.id)
            .order_by(desc(Diagnosis.created_at))
            .limit(100)
        )
    ).all()

    items: list[DiagnosisTaskSummary] = []
    for diag, portfolio in rows:
        payload = _portfolio_payload(portfolio)
        items.append(
            DiagnosisTaskSummary(
                diagnosis_id=str(diag.id),
                status=_normalize_status(diag.status),
                mode=_normalize_mode(str(payload.get("mode") or diag.mode or "")),
                stocks=_valid_stock_summaries(portfolio),
                masters=list(diag.masters or []),
                created_at=(diag.created_at or datetime.now(timezone.utc)).isoformat(),
                finished_at=diag.finished_at.isoformat() if diag.finished_at else None,
                error=diag.error_message,
            )
        )
    return items


@router.get("/{diagnosis_id}/stream")
async def stream(diagnosis_id: str, request: Request):
    """SSE 流式输出：先回放已落库事件，再轮询追新事件。"""
    try:
        diag_uuid = uuid.UUID(diagnosis_id)
    except ValueError:
        raise HTTPException(400, "id 不是 UUID")

    async with SessionLocal() as db:
        diag = await db.get(Diagnosis, diag_uuid)
        if diag is None:
            raise HTTPException(404, "诊断不存在")

    raw_last_id = request.headers.get("last-event-id") or request.headers.get("Last-Event-ID")
    try:
        last_sent_id = int(raw_last_id) if raw_last_id else 0
    except ValueError:
        last_sent_id = 0

    async def event_gen():
        nonlocal last_sent_id
        while True:
            if await request.is_disconnected():
                break

            async with SessionLocal() as db:
                current = await db.get(Diagnosis, diag_uuid)
                if current is None:
                    break
                events = list(current.events_jsonb or [])
                status = current.status

            new_events = []
            for rec in events:
                try:
                    rec_id = int(rec.get("id") or 0)
                except (TypeError, ValueError):
                    rec_id = 0
                if rec_id > last_sent_id:
                    new_events.append((rec_id, rec))

            for rec_id, rec in new_events:
                last_sent_id = max(last_sent_id, rec_id)
                yield {
                    "id": str(rec.get("id") or rec_id),
                    "event": rec.get("event", "message"),
                    "data": json.dumps(rec.get("data", {}), ensure_ascii=False),
                }

            if status in {"done", "failed"} and not new_events:
                break

            await asyncio.sleep(0.75)

    return EventSourceResponse(event_gen())


@router.get("/{diagnosis_id}", response_model=DiagnosisReportResponse)
async def get_report(
    diagnosis_id: str,
    db: AsyncSession = Depends(get_database),
) -> DiagnosisReportResponse:
    try:
        diag_uuid = uuid.UUID(diagnosis_id)
    except ValueError:
        raise HTTPException(400, "id 不是 UUID")

    diag = await db.get(Diagnosis, diag_uuid)
    if diag is None:
        raise HTTPException(404, "诊断不存在")
    portfolio = await db.get(Portfolio, diag.portfolio_id)
    payload = _portfolio_payload(portfolio)

    return DiagnosisReportResponse(
        diagnosis_id=str(diag.id),
        status=_normalize_status(diag.status),
        report=diag.report_json,
        error=diag.error_message,
        mode=_normalize_mode(str(payload.get("mode") or diag.mode or "")),
        stocks=_valid_stock_summaries(portfolio),
        events=list(diag.events_jsonb or []),
    )


@router.post("/{diagnosis_id}/share", response_model=ShareCreateResponse)
async def create_share(
    diagnosis_id: str,
    req: ShareCreateRequest | None = None,
    anon: AnonymousSession = Depends(get_anon),
    db: AsyncSession = Depends(get_database),
) -> ShareCreateResponse:
    try:
        diag_uuid = uuid.UUID(diagnosis_id)
    except ValueError:
        raise HTTPException(400, "id 不是 UUID")

    diag = await db.get(Diagnosis, diag_uuid)
    if diag is None:
        raise HTTPException(404, "诊断不存在")
    if diag.anon_id and diag.anon_id != anon.id:
        raise HTTPException(403, "不能分享其他会话的诊断")
    if diag.status != "done" or not diag.report_json:
        raise HTTPException(400, "诊断完成后才能分享")

    existing = (
        await db.execute(select(ShareLink).where(ShareLink.diagnosis_id == diag_uuid))
    ).scalar_one_or_none()
    if existing is not None:
        return ShareCreateResponse(code=existing.code, url=f"/share/{existing.code}")

    expires_at = None
    if req and req.expires_days:
        expires_at = datetime.now(timezone.utc) + timedelta(days=req.expires_days)

    for _ in range(5):
        code = token_urlsafe(8).replace("-", "").replace("_", "")[:10]
        if not await db.get(ShareLink, code):
            link = ShareLink(code=code, diagnosis_id=diag_uuid, expires_at=expires_at)
            db.add(link)
            await db.commit()
            return ShareCreateResponse(code=code, url=f"/share/{code}")

    raise HTTPException(500, "生成分享链接失败")


@share_router.get("/{code}", response_model=ShareReportResponse)
async def get_shared_report(
    code: str,
    db: AsyncSession = Depends(get_database),
) -> ShareReportResponse:
    link = await db.get(ShareLink, code)
    if link is None:
        raise HTTPException(404, "分享链接不存在")
    if link.expires_at and link.expires_at < datetime.now(timezone.utc):
        raise HTTPException(410, "分享链接已过期")

    diag = await db.get(Diagnosis, link.diagnosis_id)
    if diag is None:
        raise HTTPException(404, "诊断不存在")
    portfolio = await db.get(Portfolio, diag.portfolio_id)
    payload = _portfolio_payload(portfolio)

    link.visit_count += 1
    await db.commit()

    return ShareReportResponse(
        share_code=link.code,
        visit_count=link.visit_count,
        diagnosis_id=str(diag.id),
        status=_normalize_status(diag.status),
        report=diag.report_json,
        error=diag.error_message,
        mode=_normalize_mode(str(payload.get("mode") or diag.mode or "")),
        stocks=_valid_stock_summaries(portfolio),
    )
