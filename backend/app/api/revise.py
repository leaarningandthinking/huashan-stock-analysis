"""修订对话 API。SSE 流式 + LLM ReAct loop。

POST /api/diagnosis/{sid}/revise  - 单轮对话,流式返回
GET  /api/diagnosis/{sid}/quick_actions  - 给前端调整按钮提供 3 个 quick action
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import AsyncIterator, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.api.deps import get_anon, get_database
from app.llm.factory import build_client
from app.models.diagnosis import Diagnosis
from app.services.memory.revise_tools import (
    REVISE_SYSTEM_PROMPT,
    ReviseToolExecutor,
    TOOL_SCHEMAS,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/diagnosis", tags=["revise"])


class LLMConfig(BaseModel):
    provider: str
    api_key: str
    base_url: Optional[str] = None
    model: Optional[str] = None


class ReviseRequest(BaseModel):
    message: str
    history: list[dict] = []
    llm_config: LLMConfig
    context: Optional[dict] = None  # e.g. {"section": "analyst.technical", "stock": "600519"}


@router.post("/{sid}/revise")
async def revise_conversation(
    sid: str,
    payload: ReviseRequest,
    db: AsyncSession = Depends(get_database),
    anon=Depends(get_anon),
):
    """单轮对话入口(SSE)。

    每次发一句话,后端跑一轮 ReAct loop:
        LLM → tool_call → execute → LLM → ... → final answer
    """
    try:
        diag_id = uuid.UUID(sid)
    except ValueError:
        raise HTTPException(400, "invalid sid")

    diag = await db.get(Diagnosis, diag_id)
    if not diag or diag.anon_id != anon.id:
        raise HTTPException(404, "diagnosis not found")
    if diag.status != "done":
        raise HTTPException(400, "diagnosis not ready for revision")

    user_message = payload.message.strip()
    if not user_message:
        raise HTTPException(400, "empty message")

    llm_cfg = payload.llm_config
    # 项目里 build_client 的参数名是 provider_id,不是 provider
    client = build_client(
        provider_id=llm_cfg.provider,
        api_key=llm_cfg.api_key,
        base_url=llm_cfg.base_url,
    )
    executor = ReviseToolExecutor(
        db=db,
        anon_id=anon.id,
        diagnosis_id=diag_id,
        report_json=diag.report_json or {},
    )

    system_prompt = REVISE_SYSTEM_PROMPT
    if payload.context:
        system_prompt += (
            f"\n\n## 当前会话上下文\n"
            f"用户正在查看:{json.dumps(payload.context, ensure_ascii=False)}\n"
            f"你的回复应聚焦在这个上下文上。"
        )

    async def stream() -> AsyncIterator[dict]:
        messages = [
            {"role": "system", "content": system_prompt},
            *payload.history,
            {"role": "user", "content": user_message},
        ]
        plan_to_execute: Optional[dict] = None

        # ReAct loop:最多 6 轮工具调用,防止失控
        for step in range(6):
            yield {"event": "thinking", "data": json.dumps({"step": step})}

            try:
                logger.warning(
                    "[REVISE step=%d] provider=%s model=%s msgs=%d",
                    step, llm_cfg.provider, llm_cfg.model, len(messages),
                )
                result = await client.chat_with_tools(
                    messages=messages,
                    tools=TOOL_SCHEMAS,
                    model=llm_cfg.model or "",
                    temperature=0.3,
                )
                logger.warning(
                    "[REVISE step=%d] result: has_content=%s tool_calls=%s content_preview=%r",
                    step,
                    bool(result.get("content")),
                    len(result.get("tool_calls") or []),
                    (result.get("content") or "")[:300],
                )
            except Exception as e:
                logger.exception("LLM chat_with_tools failed")
                yield {
                    "event": "error",
                    "data": json.dumps({"message": f"LLM 调用失败:{e}"})
                }
                return

            tool_calls = result.get("tool_calls") or []

            if tool_calls:
                messages.append({
                    "role": "assistant",
                    "content": result.get("content") or "",
                    "tool_calls": tool_calls,
                })

                for tc in tool_calls:
                    fn_name = tc["function"]["name"]
                    try:
                        fn_args = json.loads(tc["function"]["arguments"])
                    except json.JSONDecodeError:
                        fn_args = {}

                    yield {
                        "event": "tool_call",
                        "data": json.dumps({
                            "name": fn_name, "arguments": fn_args
                        }, ensure_ascii=False)
                    }

                    method = getattr(executor, fn_name, None)
                    if not method:
                        tool_result = {"error": f"unknown tool {fn_name}"}
                    else:
                        try:
                            tool_result = await method(**fn_args)
                        except TypeError as e:
                            tool_result = {"error": f"bad arguments: {e}"}
                        except Exception as e:
                            logger.exception("tool %s failed", fn_name)
                            tool_result = {"error": str(e)}

                    yield {
                        "event": "tool_result",
                        "data": json.dumps({
                            "name": fn_name, "result": tool_result
                        }, ensure_ascii=False)
                    }
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": json.dumps(tool_result, ensure_ascii=False),
                    })

                    if fn_name == "confirm_and_apply" and tool_result.get("ok"):
                        plan_to_execute = tool_result.get("rerun_plan")
                continue

            # 没有 tool_calls,这是最终回复
            final_text = result.get("content") or ""
            yield {
                "event": "message",
                "data": json.dumps({"text": final_text})
            }
            break

        # 触发局部重跑(Phase 4 启用 - 通过 lazy import 适配项目实际函数签名)
        if plan_to_execute:
            yield {
                "event": "rerun_triggered",
                "data": json.dumps({"plan": plan_to_execute}, ensure_ascii=False)
            }
            try:
                from app.services.partial_rerun import schedule_partial_rerun
                asyncio.create_task(schedule_partial_rerun(
                    diagnosis_id=diag_id,
                    rerun_plan=plan_to_execute,
                    llm_config=llm_cfg.model_dump(),
                ))
            except ImportError:
                # Phase 4 尚未上线时不应崩,只是不触发重跑
                logger.warning("partial_rerun not available; skip rerun trigger")

        yield {"event": "done", "data": "{}"}

    return EventSourceResponse(stream())


@router.get("/{sid}/quick_actions")
async def get_quick_actions(
    sid: str,
    section: str,
    stock: Optional[str] = None,
    db: AsyncSession = Depends(get_database),
    anon=Depends(get_anon),
):
    """给前端"调整"按钮提供 3 个 quick action 建议(Phase F1 用)。"""
    try:
        diag_id = uuid.UUID(sid)
    except ValueError:
        raise HTTPException(400)
    diag = await db.get(Diagnosis, diag_id)
    if not diag or diag.anon_id != anon.id:
        raise HTTPException(404)

    templates = {
        "analyst.technical": [
            "RSI 太高了,这种情况应该降级",
            "我看长期,别只看短期技术信号",
            "MACD 金叉如果成交量没放大,不要给买入信号",
        ],
        "analyst.fundamental": [
            "PE 高于 50 的股票直接排除",
            "更看重 ROE 而非 PEG",
            "我重视分红率,股息率低于 2% 的就别推荐",
        ],
        "analyst.sentiment": [
            "情绪过热(短期涨幅 > 30%)时应警示",
            "我不太关注情绪指标,降低它的权重",
        ],
        "analyst.news": [
            "近 7 天有负面新闻的股票优先标注",
            "纯炒作类的题材新闻别当真",
        ],
        "risk.aggressive": [
            "激进派的建议都降一档",
            "杠杆类建议直接屏蔽",
        ],
        "risk.conservative": [
            "保守派太保守了,适度放宽一点",
        ],
        "debate": [
            "巴菲特的发言太教科书,让他更接地气",
            "辩论里出现明显信息冲突时,应明确标注",
        ],
    }
    return {"actions": templates.get(section, [])}
