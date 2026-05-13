"""大师辩论调度。

设计：轮询发言（不真并发，因为后发言的大师要"看到"前面发言的内容）。
- Round 1：每位大师按选定顺序各发言 1 次（基于 analyst 报告 + 持仓）
- Round 2：每位大师再发言 1 次（这次能看到 round 1 所有人的发言，要回应）

每位大师的发言全程流式吐字。
"""

from __future__ import annotations

import logging

from app.core.sse import EventQueue
from app.llm.base import LLMClient, Message
from app.prompts.loader import get_master_section
from app.prompts.masters_persona import build_master_system_prompt

logger = logging.getLogger(__name__)


async def run_debate(
    *,
    masters: list[str],
    report_card: str,
    queue: EventQueue,
    llm: LLMClient,
    model: str,
    rounds: int = 2,
) -> dict:
    """运行 N 轮辩论。

    返回 {transcript: [{round, master, text}, ...]}
    """
    transcript: list[dict] = []

    # 给前端发一个开场，含本场参辩大师
    masters_meta: list[dict] = []
    for slug in masters:
        sec = get_master_section(slug)
        if sec is None:
            continue
        masters_meta.append({
            "slug": slug,
            "name": sec.name,
            "tagline": sec.tagline,
        })
    await queue.emit("debate.lineup", masters=masters_meta)

    for round_idx in range(1, rounds + 1):
        await queue.emit("debate.round_start", round=round_idx, total=rounds)

        for slug in masters:
            sec = get_master_section(slug)
            if sec is None:
                continue
            try:
                system_prompt = build_master_system_prompt(slug)
            except Exception as e:
                logger.warning("build prompt failed for %s: %s", slug, e)
                continue

            await queue.emit(
                "master.start",
                master=slug, name=sec.name, round=round_idx,
            )

            # 上下文：报告卡片 + 之前所有发言
            user_parts = [
                "下面是用户持仓和 4 位分析师的报告。请基于此发言。",
                "",
                report_card,
            ]
            if transcript:
                user_parts.append("---")
                user_parts.append("")
                user_parts.append(f"## 已有的辩论实录（你必须针对性回应你认同/反对的具体观点）")
                user_parts.append("")
                for entry in transcript:
                    other_sec = get_master_section(entry["master"])
                    other_name = other_sec.name if other_sec else entry["master"]
                    user_parts.append(f"### {other_name}（第 {entry['round']} 轮）")
                    user_parts.append(entry["text"])
                    user_parts.append("")
                user_parts.append("---")
                user_parts.append("")
                if round_idx == 1:
                    user_parts.append(f"现在轮到你（{sec.name}）发言。")
                else:
                    user_parts.append(
                        f"现在第 {round_idx} 轮，轮到你（{sec.name}）。"
                        f"必须**针对其他大师的具体观点做回应**，不要重复自己第一轮说过的话。"
                    )
            else:
                user_parts.append("---")
                user_parts.append(f"现在轮到你（{sec.name}）作为开场发言。")

            messages = [
                Message(role="system", content=system_prompt),
                Message(role="user", content="\n".join(user_parts)),
            ]

            chunks: list[str] = []
            try:
                async for delta in llm.stream(
                    messages, model, temperature=0.7, max_tokens=900,
                ):
                    chunks.append(delta)
                    await queue.emit(
                        "master.delta",
                        master=slug, round=round_idx, text=delta,
                    )
            except Exception as e:
                logger.warning("master %s round %d failed: %s", slug, round_idx, e)
                err = f"\n\n⚠️ 调用失败：{type(e).__name__}: {str(e)[:120]}"
                chunks.append(err)
                await queue.emit(
                    "master.delta",
                    master=slug, round=round_idx, text=err,
                )

            full_text = "".join(chunks).strip()
            transcript.append({
                "round": round_idx,
                "master": slug,
                "name": sec.name,
                "text": full_text,
            })
            await queue.emit(
                "master.done",
                master=slug, round=round_idx,
                length=len(full_text),
            )

        await queue.emit("debate.round_done", round=round_idx)

    return {"transcript": transcript}
