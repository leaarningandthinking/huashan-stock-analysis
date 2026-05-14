"""研究经理：把分析师报告整理成多空中立与核心分歧地图。"""

from __future__ import annotations

import logging

from app.core.sse import EventQueue
from app.llm.base import LLMClient, Message
from app.prompts.analysts import ANALYST_LABELS
from app.prompts.research_manager import RESEARCH_MANAGER_SYSTEM
from app.services.structured_report import build_report_for_debate

logger = logging.getLogger(__name__)


def build_research_manager_input(
    holdings: list[dict],
    analyst_results: dict[str, dict],
    mode: str = "portfolio",
) -> str:
    report_card = build_report_for_debate(holdings, analyst_results, mode=mode)
    context = (
        "以下是单股研究标的和 4 位分析师报告。请只做观点归类、冲突显性化和去噪；不要假设用户已有仓位。"
        if mode == "single"
        else "以下是用户持仓和 4 位分析师报告。请只做观点归类、冲突显性化和去噪。"
    )
    return "\n".join(
        [
            context,
            "",
            report_card,
            "---",
            "",
            "分析师角色映射：",
            *[
                f"- {role}: {ANALYST_LABELS.get(role, role)}"
                for role in ("fundamental", "sentiment", "news", "technical")
            ],
        ]
    )


async def run_research_manager(
    *,
    holdings: list[dict],
    analyst_results: dict[str, dict],
    queue: EventQueue,
    llm: LLMClient,
    model: str,
    mode: str = "portfolio",
) -> dict:
    """生成研究经理分歧地图。"""
    label = "研究经理"
    await queue.emit("research_manager.start", label=label)
    chunks: list[str] = []

    try:
        messages = [
            Message(role="system", content=RESEARCH_MANAGER_SYSTEM),
            Message(
                role="user",
                content=build_research_manager_input(holdings, analyst_results, mode=mode),
            ),
        ]
        async for delta in llm.stream(messages, model, temperature=0.25, max_tokens=1400):
            chunks.append(delta)
            await queue.emit("research_manager.delta", text=delta)
    except Exception as e:
        logger.exception("research manager failed")
        err = f"\n\n调用失败：{type(e).__name__}: {str(e)[:120]}"
        chunks.append(err)
        await queue.emit("research_manager.delta", text=err)
        await queue.emit("research_manager.done", label=label, failed=True)
        return {
            "label": label,
            "text": "".join(chunks),
            "failed": True,
            "error": str(e),
        }

    full = "".join(chunks).strip()
    await queue.emit("research_manager.done", label=label, length=len(full))
    return {"label": label, "text": full}
