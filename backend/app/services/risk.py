"""风控团队两派审核。

2 个角色独立运行（无相互对话），可以并发。
输入：analyst 报告 + 大师圆桌观点 transcript。
"""

from __future__ import annotations

import asyncio
import logging
import uuid

from app.core.sse import EventQueue
from app.db import SessionLocal
from app.llm.base import LLMClient, Message
from app.prompts.risk import RISK_LABELS, RISK_PROMPTS
from app.services.memory.profile_injector import (
    inject_memory_into_prompt,
    mark_preferences_applied,
)

logger = logging.getLogger(__name__)

RISK_SCHOOLS = ["aggressive", "conservative"]


def _build_user_input(
    report_card: str,
    transcript: list[dict],
    research_manager: dict | None,
    mode: str = "portfolio",
) -> str:
    intro = (
        "以下是单股研究标的、4 位分析师报告、投研经理分析和大师圆桌观点。用户未提供当前持仓，请按候选标的研究口径作风控陈述。"
        if mode == "single"
        else "以下是用户持仓、4 位分析师报告、投研经理分析和大师圆桌观点。请据此作风控陈述。"
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
    return "\n".join(parts)


async def run_risk_review(
    *,
    report_card: str,
    transcript: list[dict],
    research_manager: dict | None = None,
    queue: EventQueue,
    llm: LLMClient,
    model: str,
    mode: str = "portfolio",
    anon_id: uuid.UUID | None = None,
) -> dict:
    user_input = _build_user_input(report_card, transcript, research_manager, mode=mode)

    async def safe_run(school: str) -> dict:
        label = RISK_LABELS[school]
        await queue.emit("risk.start", school=school, label=label)

        # 注入 L3 偏好 + L4 画像(每个 school 独立 session,避免并发冲突)
        system_prompt = RISK_PROMPTS[school]
        applied_pref_ids: list[uuid.UUID] = []
        if anon_id is not None:
            try:
                async with SessionLocal() as db:
                    system_prompt, applied_pref_ids = await inject_memory_into_prompt(
                        db, anon_id, f"risk:{school}", RISK_PROMPTS[school]
                    )
            except Exception:
                logger.exception("risk %s inject memory failed; fall back", school)
                system_prompt = RISK_PROMPTS[school]
                applied_pref_ids = []

        chunks: list[str] = []
        try:
            messages = [
                Message(role="system", content=system_prompt),
                Message(role="user", content=user_input),
            ]
            async for delta in llm.stream(
                messages, model, temperature=0.5, max_tokens=900,
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

        # LLM 成功才回写偏好使用统计
        if applied_pref_ids:
            try:
                async with SessionLocal() as db:
                    await mark_preferences_applied(db, applied_pref_ids)
            except Exception:
                logger.exception("risk %s mark_preferences_applied failed", school)

        full = "".join(chunks).strip()
        await queue.emit("risk.done", school=school, label=label,
                         length=len(full))
        return {"school": school, "label": label, "text": full}

    results = await asyncio.gather(*(safe_run(s) for s in RISK_SCHOOLS))
    return {r["school"]: r for r in results}
