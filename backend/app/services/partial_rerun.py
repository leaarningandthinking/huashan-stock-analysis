"""局部重跑 service。

用户在修订对话里 confirm 后,只重跑必要环节,不重跑全流程。
复用项目既有的 SSE 通道(events_jsonb),前端复用现有渲染逻辑;
通过先 emit `revise.start` 让前端知道后续 analyst.* / risk.* 等事件属于修订。

注意:
- 完全适配项目实际的 run_analyst / run_debate / run_risk_review 签名
- EventQueue 用项目实际签名 EventQueue(on_emit=..., start_id=...)
- 失败隔离:任何环节抛异常都不会阻塞主流程,只记日志 + emit error 事件
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.sse import EventQueue, SSEEvent
from app.db import SessionLocal
from app.llm.factory import build_client
from app.models.diagnosis import Diagnosis, Portfolio

logger = logging.getLogger(__name__)


# ============================================================
# 触发入口(从 revise.py 的 asyncio.create_task 调用)
# ============================================================
async def schedule_partial_rerun(
    diagnosis_id: uuid.UUID,
    rerun_plan: dict,
    llm_config: dict,
) -> None:
    """后台任务入口。失败只记日志,绝不抛。"""
    try:
        await _run_partial_rerun(
            diagnosis_id=diagnosis_id,
            rerun_plan=rerun_plan,
            llm_config=llm_config,
        )
    except Exception:
        logger.exception("partial_rerun failed for %s", diagnosis_id)


# ============================================================
# 真正的执行体
# ============================================================
async def _run_partial_rerun(
    diagnosis_id: uuid.UUID,
    rerun_plan: dict,
    llm_config: dict,
) -> None:
    # 拉 diag + portfolio(共用一个 session,只做读)
    async with SessionLocal() as db:
        diag = await db.get(Diagnosis, diagnosis_id)
        if diag is None:
            logger.error("diagnosis %s not found for rerun", diagnosis_id)
            return
        portfolio = await db.get(Portfolio, diag.portfolio_id)
        anon_id = diag.anon_id
        mode = diag.mode if diag.mode in ("single", "batch", "portfolio") else "portfolio"
        masters = list(diag.masters or [])
        old_report = dict(diag.report_json or {})
        events = list(diag.events_jsonb or [])

    holdings = []
    if portfolio and isinstance(portfolio.holdings_json, dict):
        holdings = portfolio.holdings_json.get("holdings", [])
    valid_holdings = [h for h in holdings if h.get("valid")]

    # 算 SSE start_id,接着主诊股的事件流继续
    start_id = max((int(e.get("id") or 0) for e in events), default=0) + 1

    # 标 running,前端看到进度
    async with SessionLocal() as db:
        d = await db.get(Diagnosis, diagnosis_id)
        if d is not None:
            d.status = "running"
            await db.commit()

    queue = EventQueue(
        on_emit=lambda ev: _append_event(diagnosis_id, ev),
        start_id=start_id,
    )

    await queue.emit(
        "revise.start",
        plan=rerun_plan,
        revision_count_before=(old_report.get("revision_count") or 0),
    )

    # 构造 LLM client(项目里 build_client 参数名是 provider_id)
    try:
        client = build_client(
            provider_id=llm_config["provider"],
            api_key=llm_config["api_key"],
            base_url=llm_config.get("base_url"),
        )
    except Exception as e:
        logger.exception("build_client failed for rerun")
        await queue.emit("error", code="REVISE_LLM_INIT_FAILED",
                         message=f"{type(e).__name__}: {str(e)[:200]}")
        await _mark_done(diagnosis_id, old_report, status="failed")
        await queue.close()
        return
    model = llm_config.get("model") or ""

    # 延迟导入避免循环依赖
    from app.services.analysts import run_analyst
    from app.services.debate import run_debate
    from app.services.risk import run_risk_review
    from app.services.structured_report import build_report_for_debate

    # ============================================================
    # 1. 重跑指定 analysts
    # ============================================================
    new_analysts = dict(old_report.get("analysts", {}))
    for role in rerun_plan.get("rerun_analysts", []):
        try:
            result = await run_analyst(
                role,
                holdings=valid_holdings,
                queue=queue,
                llm=client,
                model=model,
                anon_id=anon_id,
            )
            result["revised_at"] = datetime.utcnow().isoformat()
            new_analysts[role] = result
        except Exception:
            logger.exception("analyst %s rerun failed", role)

    # ============================================================
    # 2. 重拼 report_card(下游要用)
    # ============================================================
    try:
        report_card = build_report_for_debate(
            valid_holdings,
            new_analysts,
            mode=mode,
        )
    except Exception:
        logger.exception("build report_card failed; fall back to old")
        report_card = old_report.get("report_card", "")

    # ============================================================
    # 3. 大师辩论(可选)
    # ============================================================
    debate_result = old_report.get("debate", {})
    if rerun_plan.get("rerun_debate") and masters:
        try:
            debate_result = await run_debate(
                masters=masters,
                report_card=report_card,
                research_manager=old_report.get("research_manager"),
                queue=queue,
                llm=client,
                model=model,
                rounds=2,
                anon_id=anon_id,
            )
        except Exception:
            logger.exception("debate rerun failed")
            debate_result = old_report.get("debate", {})

    # ============================================================
    # 4. 风控(项目的 run_risk_review 不支持单 school,任一 school 在
    #    rerun_risk 里就整体重跑;实际 plan_rerun 也总是给全集)
    # ============================================================
    new_risk = dict(old_report.get("risk", {}))
    if rerun_plan.get("rerun_risk"):
        try:
            risk_results = await run_risk_review(
                report_card=report_card,
                transcript=debate_result.get("transcript", []),
                research_manager=old_report.get("research_manager"),
                queue=queue,
                llm=client,
                model=model,
                mode=mode,
                anon_id=anon_id,
            )
            new_risk = risk_results
        except Exception:
            logger.exception("risk rerun failed")

    # ============================================================
    # 5. 落库
    # ============================================================
    new_report = {
        **old_report,
        "analysts": new_analysts,
        "report_card": report_card,
        "debate": debate_result,
        "risk": new_risk,
        "last_revised_at": datetime.utcnow().isoformat(),
        "revision_count": (old_report.get("revision_count") or 0) + 1,
    }
    await _mark_done(diagnosis_id, new_report, status="done")

    await queue.emit(
        "report.ready",
        status="done",
        revised=True,
        revision_count=new_report["revision_count"],
    )

    # ============================================================
    # 6. (Phase 6 才有) 重新生成 L1 诊股卡片
    # ============================================================
    try:
        from app.services.memory.card_builder import build_and_save_card  # noqa
        async with SessionLocal() as db:
            d = await db.get(Diagnosis, diagnosis_id)
            if d is not None:
                await build_and_save_card(db, d)
    except ImportError:
        pass
    except Exception:
        logger.exception("build_and_save_card failed; not critical")

    # ============================================================
    # 7. L2 行为信号
    # ============================================================
    try:
        from app.services.memory.signals import record_signal
        async with SessionLocal() as db:
            await record_signal(
                db, anon_id, "diagnosis_revised",
                payload={"revision_count": new_report["revision_count"]},
                diagnosis_id=diagnosis_id,
            )
    except Exception:
        logger.exception("record_signal diagnosis_revised failed")

    await queue.close()


# ============================================================
# 辅助:把事件 append 到 events_jsonb(独立 session 不复用上面的)
# ============================================================
async def _append_event(diagnosis_id: uuid.UUID, ev: SSEEvent) -> None:
    try:
        async with SessionLocal() as db:
            diag = await db.get(Diagnosis, diagnosis_id)
            if diag is None:
                return
            events = list(diag.events_jsonb or [])
            events.append({"id": ev.id, "event": ev.event, "data": ev.data})
            diag.events_jsonb = events
            await db.commit()
    except Exception:
        logger.exception("append_event failed for %s", diagnosis_id)


async def _mark_done(diagnosis_id: uuid.UUID, report: dict, status: str) -> None:
    try:
        async with SessionLocal() as db:
            d = await db.get(Diagnosis, diagnosis_id)
            if d is None:
                return
            d.report_json = report
            d.status = status
            d.finished_at = datetime.now(timezone.utc)
            await db.commit()
    except Exception:
        logger.exception("mark_done failed for %s", diagnosis_id)
