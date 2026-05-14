"""完整报告摘要生成。"""

from __future__ import annotations

import logging

from app.core.sse import EventQueue
from app.llm.base import LLMClient, Message
from app.prompts.report_summary import REPORT_SUMMARY

logger = logging.getLogger(__name__)


def _build_user_input(
    *,
    report_card: str,
    research_manager: dict | None,
    transcript: list[dict],
    risk_results: dict,
    manager_decision: dict,
) -> str:
    parts = [
        "以下是完整诊断材料，请生成报告摘要。",
        "",
        "## 分析师报告与结构化材料",
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
        parts.append(f"### {item.get('label') or item.get('school') or '风控'}")
        parts.append(str(item.get("text") or item.get("error") or ""))
        parts.append("")

    parts.extend([
        "---",
        "",
        "## 投资经理决策",
        str(manager_decision.get("text") or manager_decision.get("error") or ""),
    ])
    return "\n".join(parts)


async def run_report_summary(
    *,
    report_card: str,
    research_manager: dict | None = None,
    transcript: list[dict],
    risk_results: dict,
    manager_decision: dict,
    queue: EventQueue,
    llm: LLMClient,
    model: str,
) -> dict:
    label = "报告摘要"
    await queue.emit("summary.start", label=label)
    chunks: list[str] = []
    try:
        messages = [
            Message(role="system", content=REPORT_SUMMARY),
            Message(
                role="user",
                content=_build_user_input(
                    report_card=report_card,
                    research_manager=research_manager,
                    transcript=transcript,
                    risk_results=risk_results,
                    manager_decision=manager_decision,
                ),
            ),
        ]
        async for delta in llm.stream(messages, model, temperature=0.25, max_tokens=1200):
            chunks.append(delta)
            await queue.emit("summary.delta", text=delta)
    except Exception as e:
        logger.exception("report summary failed")
        err = f"\n\n调用失败：{type(e).__name__}: {str(e)[:120]}"
        chunks.append(err)
        await queue.emit("summary.delta", text=err)
        await queue.emit("summary.done", label=label, failed=True)
        return {"label": label, "text": "".join(chunks), "failed": True, "error": str(e)}

    full = "".join(chunks).strip()
    await queue.emit("summary.done", label=label, length=len(full))
    return {"label": label, "text": full}
