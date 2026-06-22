from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone
from secrets import token_urlsafe

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_anon, get_database
from app.data.akshare_client import DataSourceError
from app.db import SessionLocal
from app.models.anonymous import AnonymousSession
from app.models.diagnosis import ShortTermAnalysisTask, ShortTermShareLink
from app.schemas.short_term import (
    ShortTermAnalyzeRequest,
    ShortTermAnalyzeResponse,
    ShortTermShareCreateResponse,
    ShortTermShareReportResponse,
    ShortTermStartResponse,
    ShortTermTaskReportResponse,
    ShortTermTaskSummary,
)
from app.services.short_term import analyze_short_term

router = APIRouter(prefix="/api/short-term", tags=["short-term"])
logger = logging.getLogger(__name__)
_RUNNING: dict[str, asyncio.Task] = {}


async def _run_and_persist(task_id: str, req: ShortTermAnalyzeRequest) -> None:
    task_uuid = uuid.UUID(task_id)
    try:
        report = await analyze_short_term(code=req.code, name=req.name, llm=req.llm)
        report.task_id = task_id
        async with SessionLocal() as db:
            task = await db.get(ShortTermAnalysisTask, task_uuid)
            if task is None:
                return
            task.code = report.code
            task.name = report.name
            task.status = "done"
            task.report_json = report.model_dump(mode="json")
            task.finished_at = datetime.now(timezone.utc)
            await db.commit()
    except (ValueError, DataSourceError) as e:
        async with SessionLocal() as db:
            task = await db.get(ShortTermAnalysisTask, task_uuid)
            if task:
                task.status = "failed"
                task.error_message = f"数据源暂不可用：{e}" if isinstance(e, DataSourceError) else str(e)
                task.finished_at = datetime.now(timezone.utc)
                await db.commit()
    except Exception as e:
        logger.exception("Short-term analysis failed for code=%s", req.code)
        async with SessionLocal() as db:
            task = await db.get(ShortTermAnalysisTask, task_uuid)
            if task:
                task.status = "failed"
                task.error_message = f"{type(e).__name__}: {str(e)[:500]}"
                task.finished_at = datetime.now(timezone.utc)
                await db.commit()
    finally:
        _RUNNING.pop(task_id, None)


@router.post("/analyze", response_model=ShortTermAnalyzeResponse)
async def analyze(
    req: ShortTermAnalyzeRequest,
    anon: AnonymousSession = Depends(get_anon),
    db: AsyncSession = Depends(get_database),
) -> ShortTermAnalyzeResponse:
    task = ShortTermAnalysisTask(
        anon_id=anon.id,
        code=req.code,
        name=req.name or req.code,
        status="running",
    )
    db.add(task)
    await db.flush()

    try:
        report = await analyze_short_term(code=req.code, name=req.name, llm=req.llm)
        report.task_id = str(task.id)
        task.code = report.code
        task.name = report.name
        task.status = "done"
        task.report_json = report.model_dump(mode="json")
        task.finished_at = datetime.now(timezone.utc)
        await db.commit()
        return report
    except ValueError as e:
        task.status = "failed"
        task.error_message = str(e)
        task.finished_at = datetime.now(timezone.utc)
        await db.commit()
        raise HTTPException(400, str(e)) from e
    except DataSourceError as e:
        task.status = "failed"
        task.error_message = f"数据源暂不可用：{e}"
        task.finished_at = datetime.now(timezone.utc)
        await db.commit()
        raise HTTPException(502, f"数据源暂不可用：{e}") from e
    except Exception as e:
        logger.exception("Short-term analysis failed for code=%s", req.code)
        task.status = "failed"
        task.error_message = f"{type(e).__name__}: {str(e)[:500]}"
        task.finished_at = datetime.now(timezone.utc)
        await db.commit()
        raise HTTPException(500, f"短线分析失败：{e}") from e


@router.post("/start", response_model=ShortTermStartResponse)
async def start(
    req: ShortTermAnalyzeRequest,
    anon: AnonymousSession = Depends(get_anon),
    db: AsyncSession = Depends(get_database),
) -> ShortTermStartResponse:
    task = ShortTermAnalysisTask(
        anon_id=anon.id,
        code=req.code,
        name=req.name or req.code,
        status="running",
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    task_id = str(task.id)
    _RUNNING[task_id] = asyncio.create_task(_run_and_persist(task_id, req))
    return ShortTermStartResponse(task_id=task_id, status=task.status)


@router.get("", response_model=list[ShortTermTaskSummary])
async def list_tasks(
    anon: AnonymousSession = Depends(get_anon),
    db: AsyncSession = Depends(get_database),
) -> list[ShortTermTaskSummary]:
    rows = (
        await db.execute(
            select(ShortTermAnalysisTask)
            .where(ShortTermAnalysisTask.anon_id == anon.id)
            .order_by(desc(ShortTermAnalysisTask.created_at))
            .limit(100)
        )
    ).scalars().all()

    return [
        ShortTermTaskSummary(
            task_id=str(task.id),
            status=task.status,
            code=task.code,
            name=task.name,
            created_at=(task.created_at or datetime.now(timezone.utc)).isoformat(),
            finished_at=task.finished_at.isoformat() if task.finished_at else None,
            error=task.error_message,
        )
        for task in rows
    ]


@router.get("/{task_id}", response_model=ShortTermTaskReportResponse)
async def get_task_report(
    task_id: str,
    anon: AnonymousSession = Depends(get_anon),
    db: AsyncSession = Depends(get_database),
) -> ShortTermTaskReportResponse:
    try:
        task_uuid = uuid.UUID(task_id)
    except ValueError:
        raise HTTPException(400, "id 不是 UUID")

    task = await db.get(ShortTermAnalysisTask, task_uuid)
    if task is None:
        raise HTTPException(404, "短线分析任务不存在")
    if task.anon_id and task.anon_id != anon.id:
        raise HTTPException(403, "不能查看其他会话的短线分析任务")

    return ShortTermTaskReportResponse(
        task_id=str(task.id),
        status=task.status,
        report=ShortTermAnalyzeResponse.model_validate(task.report_json) if task.report_json else None,
        error=task.error_message,
    )


@router.post("/{task_id}/share", response_model=ShortTermShareCreateResponse)
async def create_share(
    task_id: str,
    anon: AnonymousSession = Depends(get_anon),
    db: AsyncSession = Depends(get_database),
) -> ShortTermShareCreateResponse:
    try:
        task_uuid = uuid.UUID(task_id)
    except ValueError:
        raise HTTPException(400, "id 不是 UUID")

    task = await db.get(ShortTermAnalysisTask, task_uuid)
    if task is None:
        raise HTTPException(404, "短线分析任务不存在")
    if task.anon_id and task.anon_id != anon.id:
        raise HTTPException(403, "不能分享其他会话的短线分析任务")
    if task.status != "done" or not task.report_json:
        raise HTTPException(400, "分析完成后才能分享")

    existing = (
        await db.execute(select(ShortTermShareLink).where(ShortTermShareLink.task_id == task_uuid))
    ).scalar_one_or_none()
    if existing is not None:
        return ShortTermShareCreateResponse(code=existing.code, url=f"/share/short-term/{existing.code}")

    expires_at = datetime.now(timezone.utc) + timedelta(days=365)
    for _ in range(5):
        code = token_urlsafe(8).replace("-", "").replace("_", "")[:10]
        if not await db.get(ShortTermShareLink, code):
            link = ShortTermShareLink(code=code, task_id=task_uuid, expires_at=expires_at)
            db.add(link)
            await db.commit()
            return ShortTermShareCreateResponse(code=code, url=f"/share/short-term/{code}")

    raise HTTPException(500, "生成分享链接失败")


@router.get("/share/{code}", response_model=ShortTermShareReportResponse)
async def get_shared_report(
    code: str,
    db: AsyncSession = Depends(get_database),
) -> ShortTermShareReportResponse:
    link = await db.get(ShortTermShareLink, code)
    if link is None:
        raise HTTPException(404, "分享链接不存在")
    if link.expires_at and link.expires_at < datetime.now(timezone.utc):
        raise HTTPException(410, "分享链接已过期")

    task = await db.get(ShortTermAnalysisTask, link.task_id)
    if task is None:
        raise HTTPException(404, "短线分析任务不存在")

    link.visit_count += 1
    await db.commit()

    return ShortTermShareReportResponse(
        share_code=link.code,
        visit_count=link.visit_count,
        task_id=str(task.id),
        status=task.status,
        report=ShortTermAnalyzeResponse.model_validate(task.report_json) if task.report_json else None,
        error=task.error_message,
    )
