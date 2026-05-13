"""风控团队两派审核。

2 个角色独立运行（无相互对话），可以并发。
输入：analyst 报告 + 大师圆桌观点 transcript。
"""

from __future__ import annotations

import asyncio
import logging

from app.core.sse import EventQueue
from app.llm.base import LLMClient, Message
from app.prompts.risk import RISK_LABELS, RISK_PROMPTS

logger = logging.getLogger(__name__)

RISK_SCHOOLS = ["aggressive", "conservative"]


def _build_user_input(report_card: str, transcript: list[dict]) -> str:
    parts = [
        "以下是用户持仓 + 4 位分析师报告 + 大师圆桌观点。请据此作风控陈述。",
        "",
        report_card,
        "---",
        "",
        "## 大师圆桌观点",
        "",
    ]
    for entry in transcript:
        parts.append(f"### {entry.get('name', entry['master'])}（第 {entry['round']} 轮）")
        parts.append(entry["text"])
        parts.append("")
    return "\n".join(parts)


async def run_risk_review(
    *,
    report_card: str,
    transcript: list[dict],
    queue: EventQueue,
    llm: LLMClient,
    model: str,
) -> dict:
    user_input = _build_user_input(report_card, transcript)

    async def safe_run(school: str) -> dict:
        label = RISK_LABELS[school]
        await queue.emit("risk.start", school=school, label=label)
        chunks: list[str] = []
        try:
            messages = [
                Message(role="system", content=RISK_PROMPTS[school]),
                Message(role="user", content=user_input),
            ]
            async for delta in llm.stream(
                messages, model, temperature=0.5, max_tokens=600,
            ):
                chunks.append(delta)
                await queue.emit("risk.delta", school=school, text=delta)
        except Exception as e:
            logger.exception("risk %s failed", school)
            err = f"\n\n⚠️ 调用失败：{type(e).__name__}: {str(e)[:120]}"
            chunks.append(err)
            await queue.emit("risk.delta", school=school, text=err)
            await queue.emit("risk.done", school=school, label=label, failed=True)
            return {"school": school, "label": label, "text": "".join(chunks),
                    "failed": True}

        full = "".join(chunks).strip()
        await queue.emit("risk.done", school=school, label=label,
                         length=len(full))
        return {"school": school, "label": label, "text": full}

    results = await asyncio.gather(*(safe_run(s) for s in RISK_SCHOOLS))
    return {r["school"]: r for r in results}
