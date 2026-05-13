"""LLM 客户端抽象。所有 provider 实现这个接口。"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Literal


Role = Literal["system", "user", "assistant"]


@dataclass
class Message:
    role: Role
    content: str


@dataclass
class ChatResult:
    content: str
    model: str
    prompt_tokens: int = 0
    completion_tokens: int = 0


class LLMClient(ABC):
    """LLM 客户端基类。"""

    provider_id: str = ""

    @abstractmethod
    async def chat(
        self,
        messages: list[Message],
        model: str,
        *,
        temperature: float = 0.7,
        max_tokens: int | None = None,
        response_format: dict | None = None,
    ) -> ChatResult:
        """非流式 chat。返回完整结果。"""
        raise NotImplementedError

    @abstractmethod
    async def stream(
        self,
        messages: list[Message],
        model: str,
        *,
        temperature: float = 0.7,
        max_tokens: int | None = None,
    ) -> AsyncIterator[str]:
        """流式 chat。逐 token yield。"""
        raise NotImplementedError
        yield  # type: ignore[unreachable]
