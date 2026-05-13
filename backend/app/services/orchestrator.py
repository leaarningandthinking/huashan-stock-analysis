"""Orchestrator：编排整个 6-Step 诊断流程。

W5b：4 个 analyst 并行 + 单个失败隔离。
W6：扩到 大师圆桌观点 + 风控。
"""

from __future__ import annotations

import asyncio
import logging

from app.core.sse import EventQueue
from app.llm.factory import build_client
from app.prompts.analysts import ANALYST_LABELS
from app.services.analysts import run_analyst
from app.services.debate import run_debate
from app.services.investment_manager import run_investment_manager_decision
from app.services.report_summary import run_report_summary
from app.services.risk import run_risk_review
from app.services.structured_report import build_report_for_debate

logger = logging.getLogger(__name__)

ANALYST_ROLES = ["fundamental", "sentiment", "news", "technical"]


async def run_diagnosis_w5a(
    *,
    queue: EventQueue,
    holdings: list[dict],
    masters: list[str],
    llm_config: dict,
    mode: str = "portfolio",
) -> dict:
    """W5b：4 个 analyst 并行执行。单个 analyst 失败不影响其他。

    mode='single' 时跳过 Step 1（持仓概览）—— 单股没有概览意义。
    """
    try:
        valid_holdings = [h for h in holdings if h.get("valid")]
        if not valid_holdings:
            await queue.emit("error", code="NO_VALID_HOLDINGS",
                             message="没有有效股票")
            return {"status": "failed"}

        # 把股票元信息发给前端（用于动态页面标题）
        await queue.emit(
            "diagnosis.context",
            mode=mode,
            stocks=[{"code": h["code"], "name": h["name"]} for h in valid_holdings],
        )

        if mode != "single":
            await queue.emit("step.start", step=1, name="持仓概览")
            await queue.emit("step.done", step=1, count=len(valid_holdings))

        await queue.emit("step.start", step=2, name="分析师团队")

        # 每个 analyst 一个独立 LLMClient（共享底层 httpx.AsyncClient pool 也行，
        # 但 OpenAICompatClient 内部每次调用 new client，问题不大）
        model = llm_config["model"]

        async def safe_run(role: str) -> dict:
            try:
                client = build_client(
                    provider_id=llm_config["provider"],
                    api_key=llm_config["api_key"],
                    base_url=llm_config.get("base_url"),
                )
                return await run_analyst(
                    role,
                    holdings=valid_holdings,
                    queue=queue,
                    llm=client,
                    model=model,
                )
            except Exception as e:
                logger.exception("analyst %s failed", role)
                # 不抛出，让 gather 继续；前端通过 analyst.fail 事件知晓
                await queue.emit("analyst.fail", analyst=role,
                                 label=ANALYST_LABELS.get(role, role),
                                 error=f"{type(e).__name__}: {str(e)[:200]}")
                return {
                    "role": role,
                    "label": ANALYST_LABELS.get(role, role),
                    "text": "",
                    "failed": True,
                    "error": str(e),
                }

        # 4 个 analyst 真正并行
        results = await asyncio.gather(*(safe_run(r) for r in ANALYST_ROLES))
        analysts_map = {r["role"]: r for r in results}
        ok_roles = [r["role"] for r in results if not r.get("failed")]

        await queue.emit("step.done", step=2, analysts=ok_roles,
                         failed=[r["role"] for r in results if r.get("failed")])

        # ========== Step 3: 结构化报告 ==========
        await queue.emit("step.start", step=3, name="结构化报告")
        report_card = build_report_for_debate(valid_holdings, analysts_map)
        await queue.emit("step.done", step=3, length=len(report_card))

        # ========== Step 4: 大师圆桌观点 ==========
        debate_result: dict = {"transcript": []}
        if masters:
            await queue.emit("step.start", step=4, name="大师圆桌观点")
            try:
                debate_client = build_client(
                    provider_id=llm_config["provider"],
                    api_key=llm_config["api_key"],
                    base_url=llm_config.get("base_url"),
                )
                debate_result = await run_debate(
                    masters=masters,
                    report_card=report_card,
                    queue=queue,
                    llm=debate_client,
                    model=model,
                    rounds=2,
                )
                await queue.emit("step.done", step=4,
                                 turns=len(debate_result["transcript"]))
            except Exception as e:
                logger.exception("debate failed")
                await queue.emit("error", code="DEBATE_FAILED",
                                 message=f"{type(e).__name__}: {str(e)[:200]}")
        else:
            await queue.emit("step.skip", step=4, name="大师圆桌观点（未选大师）")

        # ========== Step 5: 风控审核 ==========
        risk_results: dict = {}
        await queue.emit("step.start", step=5, name="风控审核")
        try:
            risk_client = build_client(
                provider_id=llm_config["provider"],
                api_key=llm_config["api_key"],
                base_url=llm_config.get("base_url"),
            )
            risk_results = await run_risk_review(
                report_card=report_card,
                transcript=debate_result["transcript"],
                queue=queue,
                llm=risk_client,
                model=model,
            )
            await queue.emit("step.done", step=5,
                             schools=list(risk_results.keys()))
        except Exception as e:
            logger.exception("risk review failed")
            await queue.emit("error", code="RISK_FAILED",
                             message=f"{type(e).__name__}: {str(e)[:200]}")

        # ========== Step 6: 投资经理决策 ==========
        manager_decision: dict = {}
        await queue.emit("step.start", step=6, name="投资经理决策")
        try:
            manager_client = build_client(
                provider_id=llm_config["provider"],
                api_key=llm_config["api_key"],
                base_url=llm_config.get("base_url"),
            )
            manager_decision = await run_investment_manager_decision(
                report_card=report_card,
                transcript=debate_result["transcript"],
                risk_results=risk_results,
                queue=queue,
                llm=manager_client,
                model=model,
                mode=mode,
            )
            await queue.emit("step.done", step=6,
                             failed=manager_decision.get("failed", False))
        except Exception as e:
            logger.exception("investment manager failed")
            await queue.emit("error", code="MANAGER_FAILED",
                             message=f"{type(e).__name__}: {str(e)[:200]}")

        # ========== Step 7: 报告摘要 ==========
        report_summary: dict = {}
        await queue.emit("step.start", step=7, name="报告摘要")
        try:
            summary_client = build_client(
                provider_id=llm_config["provider"],
                api_key=llm_config["api_key"],
                base_url=llm_config.get("base_url"),
            )
            report_summary = await run_report_summary(
                report_card=report_card,
                transcript=debate_result["transcript"],
                risk_results=risk_results,
                manager_decision=manager_decision,
                queue=queue,
                llm=summary_client,
                model=model,
            )
            await queue.emit("step.done", step=7,
                             failed=report_summary.get("failed", False))
        except Exception as e:
            logger.exception("report summary failed")
            await queue.emit("error", code="SUMMARY_FAILED",
                             message=f"{type(e).__name__}: {str(e)[:200]}")

        report = {
            "status": "done" if ok_roles else "failed",
            "report_summary": report_summary,
            "analysts": analysts_map,
            "report_card": report_card,
            "debate": debate_result,
            "risk": risk_results,
            "investment_manager": manager_decision,
            "masters_selected": masters,
        }
        await queue.emit("report.ready", status=report["status"],
                         master_count=len(debate_result["transcript"]),
                         risk_count=len(risk_results),
                         has_manager=bool(manager_decision))
        return report

    except Exception as e:
        logger.exception("orchestrator failed")
        await queue.emit("error", code="ORCHESTRATOR_FAILED",
                         message=f"{type(e).__name__}: {str(e)[:200]}")
        return {"status": "failed", "error": str(e)}
    finally:
        await queue.close()
