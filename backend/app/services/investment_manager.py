"""投资经理决策生成。"""

from __future__ import annotations

import logging

from app.core.sse import EventQueue
from app.llm.base import LLMClient, Message
from app.prompts.investment_manager import get_investment_manager_prompt

logger = logging.getLogger(__name__)


def _build_user_input(
    *,
    report_card: str,
    research_manager: dict | None,
    transcript: list[dict],
    risk_results: dict,
    mode: str = "portfolio",
) -> str:
    intro = (
        "以下是单股研究标的、分析师报告、投研经理分析、大师圆桌观点与风控审核。用户未提供当前持仓，请据此在试探性建仓、加入观察、暂不介入三类动作中做出投资经理决策；不要假设已有仓位，也不要把无持仓默认等同于观望。"
        if mode in ("single", "single_stock")
        else "以下是用户持仓、分析师报告、投研经理分析、大师圆桌观点与风控审核。请据此给出投资经理最终决策。"
    )
    parts = [
        intro,
        "",
        report_card,
        "---",
        "",
        "## 投研经理分析",
        "",
        str((research_manager or {}).get("text") or "（缺失）"),
        "---",
        "",
        "## 大师圆桌观点",
        "",
    ]
    for entry in transcript:
        parts.append(f"### {entry.get('name', entry['master'])}（第 {entry['round']} 轮）")
        parts.append(entry["text"])
        parts.append("")

    parts.extend(["---", "", "## 风控审核", ""])
    for item in risk_results.values():
        if not isinstance(item, dict):
            continue
        label = item.get("label") or item.get("school") or "风控"
        text = item.get("text") or item.get("error") or ""
        parts.append(f"### {label}")
        parts.append(str(text))
        parts.append("")

    return "\n".join(parts)


async def run_investment_manager_decision(
    *,
    report_card: str,
    research_manager: dict | None = None,
    transcript: list[dict],
    risk_results: dict,
    queue: EventQueue,
    llm: LLMClient,
    model: str,
    mode: str,
) -> dict:
    label = "投资经理决策"
    await queue.emit("manager.start", label=label)
    chunks: list[str] = []
    try:
        messages = [
            Message(role="system", content=get_investment_manager_prompt(mode)),
            Message(
                role="user",
                content=_build_user_input(
                    report_card=report_card,
                    research_manager=research_manager,
                    transcript=transcript,
                    risk_results=risk_results,
                    mode=mode,
                ),
            ),
        ]
        async for delta in llm.stream(messages, model, temperature=0.35, max_tokens=1300):
            chunks.append(delta)
            await queue.emit("manager.delta", text=delta)
    except Exception as e:
        logger.exception("investment manager decision failed")
        err = f"\n\n调用失败：{type(e).__name__}: {str(e)[:120]}"
        chunks.append(err)
        await queue.emit("manager.delta", text=err)
        await queue.emit("manager.done", label=label, failed=True)
        return {"label": label, "text": "".join(chunks), "failed": True, "error": str(e)}

    full = "".join(chunks).strip()
    await queue.emit("manager.done", label=label, length=len(full))
    return {"label": label, "text": full}
