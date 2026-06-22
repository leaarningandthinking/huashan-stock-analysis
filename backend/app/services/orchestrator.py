"""Orchestrator：用 StateGraph 编排完整诊断流程。"""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from app.core.sse import EventQueue
from app.llm.factory import build_client
from app.prompts.analysts import ANALYST_LABELS
from app.services.analysts import run_analyst
from app.services.debate import run_debate
from app.services.investment_manager import run_investment_manager_decision
from app.services.report_summary import run_report_summary
from app.services.research_manager import run_research_manager
from app.services.risk import run_risk_review
from app.services.structured_report import build_report_for_debate

logger = logging.getLogger(__name__)

ANALYST_ROLES = ["fundamental", "sentiment", "news", "technical"]


class DiagnosisState(TypedDict, total=False):
    queue: EventQueue
    holdings: list[dict]
    valid_holdings: list[dict]
    masters: list[str]
    llm_config: dict
    mode: str
    model: str
    anon_id: uuid.UUID | None
    ok_roles: list[str]
    analyst_results: dict[str, dict]
    report_card: str
    research_manager_result: dict
    debate_result: dict
    risk_results: dict
    manager_decision: dict
    summary_result: dict
    report: dict


def _build_llm(llm_config: dict):
    return build_client(
        provider_id=llm_config["provider"],
        api_key=llm_config["api_key"],
        base_url=llm_config.get("base_url"),
    )


async def _analysts_node(state: DiagnosisState) -> dict[str, Any]:
    queue = state["queue"]
    valid_holdings = state["valid_holdings"]
    llm_config = state["llm_config"]
    model = state["model"]

    await queue.emit("step.start", step=2, name="分析师团队")

    anon_id = state.get("anon_id")

    async def safe_run(role: str) -> dict:
        try:
            return await run_analyst(
                role,
                holdings=valid_holdings,
                queue=queue,
                llm=_build_llm(llm_config),
                model=model,
                anon_id=anon_id,
            )
        except Exception as e:
            logger.exception("analyst %s failed", role)
            await queue.emit(
                "analyst.fail",
                analyst=role,
                label=ANALYST_LABELS.get(role, role),
                error=f"{type(e).__name__}: {str(e)[:200]}",
            )
            return {
                "role": role,
                "label": ANALYST_LABELS.get(role, role),
                "text": "",
                "failed": True,
                "error": str(e),
            }

    results = await asyncio.gather(*(safe_run(role) for role in ANALYST_ROLES))
    analysts_map = {result["role"]: result for result in results}
    ok_roles = [result["role"] for result in results if not result.get("failed")]
    report_card = build_report_for_debate(
        valid_holdings,
        analysts_map,
        mode=state.get("mode", "portfolio"),
    )

    await queue.emit(
        "step.done",
        step=2,
        analysts=ok_roles,
        failed=[result["role"] for result in results if result.get("failed")],
    )
    return {
        "analyst_results": analysts_map,
        "ok_roles": ok_roles,
        "report_card": report_card,
    }


async def _research_manager_node(state: DiagnosisState) -> dict[str, Any]:
    queue = state["queue"]
    await queue.emit("step.start", step=3, name="投研经理分析")
    result: dict = {}
    try:
        result = await run_research_manager(
            holdings=state["valid_holdings"],
            analyst_results=state["analyst_results"],
            queue=queue,
            llm=_build_llm(state["llm_config"]),
            model=state["model"],
            mode=state.get("mode", "portfolio"),
        )
        await queue.emit("step.done", step=3, failed=result.get("failed", False))
    except Exception as e:
        logger.exception("research manager failed")
        result = {"label": "研究经理", "text": "", "failed": True, "error": str(e)}
        await queue.emit(
            "error",
            code="RESEARCH_MANAGER_FAILED",
            message=f"{type(e).__name__}: {str(e)[:200]}",
        )
    return {"research_manager_result": result}


async def _master_debate_node(state: DiagnosisState) -> dict[str, Any]:
    queue = state["queue"]
    masters = state["masters"]
    debate_result: dict = {"transcript": []}

    if not masters:
        await queue.emit("step.skip", step=4, name="大师圆桌观点（未选大师）")
        return {"debate_result": debate_result}

    await queue.emit("step.start", step=4, name="大师圆桌观点")
    try:
        debate_result = await run_debate(
            masters=masters,
            report_card=state["report_card"],
            research_manager=state.get("research_manager_result"),
            queue=queue,
            llm=_build_llm(state["llm_config"]),
            model=state["model"],
            rounds=2,
            anon_id=state.get("anon_id"),
        )
        await queue.emit("step.done", step=4, turns=len(debate_result["transcript"]))
    except Exception as e:
        logger.exception("debate failed")
        await queue.emit(
            "error",
            code="DEBATE_FAILED",
            message=f"{type(e).__name__}: {str(e)[:200]}",
        )
    return {"debate_result": debate_result}


async def _risk_review_node(state: DiagnosisState) -> dict[str, Any]:
    queue = state["queue"]
    risk_results: dict = {}
    await queue.emit("step.start", step=5, name="风控审核")
    try:
        risk_results = await run_risk_review(
            report_card=state["report_card"],
            research_manager=state.get("research_manager_result"),
            transcript=state["debate_result"]["transcript"],
            queue=queue,
            llm=_build_llm(state["llm_config"]),
            model=state["model"],
            mode=state.get("mode", "portfolio"),
            anon_id=state.get("anon_id"),
        )
        await queue.emit("step.done", step=5, schools=list(risk_results.keys()))
    except Exception as e:
        logger.exception("risk review failed")
        await queue.emit(
            "error",
            code="RISK_FAILED",
            message=f"{type(e).__name__}: {str(e)[:200]}",
        )
    return {"risk_results": risk_results}


async def _investment_manager_node(state: DiagnosisState) -> dict[str, Any]:
    queue = state["queue"]
    manager_decision: dict = {}
    await queue.emit("step.start", step=6, name="投资经理决策")
    try:
        manager_decision = await run_investment_manager_decision(
            report_card=state["report_card"],
            research_manager=state.get("research_manager_result"),
            transcript=state["debate_result"]["transcript"],
            risk_results=state["risk_results"],
            queue=queue,
            llm=_build_llm(state["llm_config"]),
            model=state["model"],
            mode=state["mode"],
        )
        await queue.emit("step.done", step=6, failed=manager_decision.get("failed", False))
    except Exception as e:
        logger.exception("investment manager failed")
        await queue.emit(
            "error",
            code="MANAGER_FAILED",
            message=f"{type(e).__name__}: {str(e)[:200]}",
        )
    return {"manager_decision": manager_decision}


async def _report_summary_node(state: DiagnosisState) -> dict[str, Any]:
    queue = state["queue"]
    summary: dict = {}
    await queue.emit("step.start", step=7, name="报告摘要")
    try:
        summary = await run_report_summary(
            report_card=state["report_card"],
            research_manager=state.get("research_manager_result"),
            transcript=state["debate_result"]["transcript"],
            risk_results=state["risk_results"],
            manager_decision=state["manager_decision"],
            queue=queue,
            llm=_build_llm(state["llm_config"]),
            model=state["model"],
        )
        await queue.emit("step.done", step=7, failed=summary.get("failed", False))
    except Exception as e:
        logger.exception("report summary failed")
        await queue.emit(
            "error",
            code="SUMMARY_FAILED",
            message=f"{type(e).__name__}: {str(e)[:200]}",
        )
    return {"summary_result": summary}


async def _finalize_node(state: DiagnosisState) -> dict[str, Any]:
    queue = state["queue"]
    report = {
        "status": "done" if state.get("ok_roles") else "failed",
        "report_summary": state.get("summary_result", {}),
        "analysts": state.get("analyst_results", {}),
        "report_card": state.get("report_card", ""),
        "research_manager": state.get("research_manager_result", {}),
        "debate": state.get("debate_result", {"transcript": []}),
        "risk": state.get("risk_results", {}),
        "investment_manager": state.get("manager_decision", {}),
        "masters_selected": state.get("masters", []),
    }
    await queue.emit(
        "report.ready",
        status=report["status"],
        master_count=len(report["debate"]["transcript"]),
        risk_count=len(report["risk"]),
        has_manager=bool(report["investment_manager"]),
        has_research_manager=bool(report["research_manager"]),
    )
    return {"report": report}


def _build_diagnosis_graph():
    graph = StateGraph(DiagnosisState)
    graph.add_node("analysts", _analysts_node)
    graph.add_node("research_manager", _research_manager_node)
    graph.add_node("master_debate", _master_debate_node)
    graph.add_node("risk_review", _risk_review_node)
    graph.add_node("investment_manager", _investment_manager_node)
    graph.add_node("report_summary", _report_summary_node)
    graph.add_node("finalize", _finalize_node)

    graph.add_edge(START, "analysts")
    graph.add_edge("analysts", "research_manager")
    graph.add_edge("research_manager", "master_debate")
    graph.add_edge("master_debate", "risk_review")
    graph.add_edge("risk_review", "investment_manager")
    graph.add_edge("investment_manager", "report_summary")
    graph.add_edge("report_summary", "finalize")
    graph.add_edge("finalize", END)
    return graph.compile()


async def run_diagnosis_w5a(
    *,
    queue: EventQueue,
    holdings: list[dict],
    masters: list[str],
    llm_config: dict,
    mode: str = "portfolio",
    anon_id: uuid.UUID | None = None,
) -> dict:
    """运行诊断 StateGraph。

    Graph:
    analysts -> research_manager -> master_debate -> risk_review ->
    investment_manager -> report_summary -> finalize

    anon_id 用于 L3 偏好 + L4 画像注入到 analysts / risk / debate 的 system prompt。
    传 None 时行为与改造前完全一致。
    """
    try:
        valid_holdings = [holding for holding in holdings if holding.get("valid")]
        if not valid_holdings:
            await queue.emit("error", code="NO_VALID_HOLDINGS", message="没有有效股票")
            return {"status": "failed"}

        await queue.emit(
            "diagnosis.context",
            mode=mode,
            stocks=[{"code": h["code"], "name": h["name"]} for h in valid_holdings],
        )

        if mode != "single":
            await queue.emit("step.start", step=1, name="持仓概览")
            await queue.emit("step.done", step=1, count=len(valid_holdings))

        graph = _build_diagnosis_graph()
        final_state = await graph.ainvoke(
            {
                "queue": queue,
                "holdings": holdings,
                "valid_holdings": valid_holdings,
                "masters": masters,
                "llm_config": llm_config,
                "mode": mode,
                "model": llm_config["model"],
                "anon_id": anon_id,
            }
        )
        return final_state.get("report", {"status": "failed"})

    except Exception as e:
        logger.exception("orchestrator failed")
        await queue.emit(
            "error",
            code="ORCHESTRATOR_FAILED",
            message=f"{type(e).__name__}: {str(e)[:200]}",
        )
        return {"status": "failed", "error": str(e)}
    finally:
        await queue.close()
