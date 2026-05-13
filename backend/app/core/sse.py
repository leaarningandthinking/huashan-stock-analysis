"""SSE 事件协议与工具。

事件类型按 Skill 文档约定：
  step.start / step.done       — 6 步主流程
  analyst.start/delta/done     — 4 分析师
  master.start/delta/done      — 大师圆桌观点（W6）
  risk.start/delta/done        — 风控审核（W6）
  manager.start/delta/done     — 投资经理决策
  summary.start/delta/done     — 报告摘要
  report.ready                 — 最终报告就绪
  error                        — 出错
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class SSEEvent:
    """sse-starlette 期望的字段：event / data / id（可选）"""
    event: str
    data: dict[str, Any]
    id: str | None = None

    def to_starlette(self) -> dict:
        return {
            "event": self.event,
            "data": json.dumps(self.data, ensure_ascii=False),
            **({"id": self.id} if self.id else {}),
        }


class EventQueue:
    """orchestrator 内部用的事件队列。多个并发 analyst 共享一个 queue，
    最终汇集到一个 SSE 通道。"""

    def __init__(
        self,
        on_emit: Callable[[SSEEvent], Awaitable[None]] | None = None,
        start_id: int = 1,
    ) -> None:
        self._q: asyncio.Queue[SSEEvent | None] = asyncio.Queue()
        self._on_emit = on_emit
        self._next_id = start_id
        self._emit_lock = asyncio.Lock()

    async def emit(self, event: str, **data: Any) -> None:
        async with self._emit_lock:
            ev = SSEEvent(event=event, data=data, id=str(self._next_id))
            self._next_id += 1
            if self._on_emit is not None:
                await self._on_emit(ev)
            await self._q.put(ev)

    async def close(self) -> None:
        await self._q.put(None)

    async def stream(self) -> AsyncIterator[SSEEvent]:
        while True:
            ev = await self._q.get()
            if ev is None:
                break
            yield ev


def make_error_event(code: str, message: str, **extra: Any) -> SSEEvent:
    return SSEEvent(event="error", data={"code": code, "message": message, **extra})
