"""通用 OpenAI 兼容客户端。DeepSeek / 讯飞 MaaS 都走这个。

仅依赖 httpx，不引入 openai SDK 以减小镜像 + 自定义 base_url 更灵活。
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator

import httpx

from app.llm.base import ChatResult, LLMClient, Message


class OpenAICompatClient(LLMClient):
    def __init__(
        self,
        *,
        provider_id: str,
        base_url: str,
        api_key: str,
        timeout: float = 60.0,
    ):
        self.provider_id = provider_id
        # 兼容用户填了带尾斜杠的 URL
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def _payload(
        self,
        messages: list[Message],
        model: str,
        *,
        temperature: float,
        max_tokens: int | None,
        stream: bool,
        response_format: dict | None = None,
    ) -> dict:
        payload: dict = {
            "model": model,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "temperature": temperature,
            "stream": stream,
        }
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
        if response_format is not None:
            payload["response_format"] = response_format
        return payload

    async def chat(
        self,
        messages: list[Message],
        model: str,
        *,
        temperature: float = 0.7,
        max_tokens: int | None = None,
        response_format: dict | None = None,
    ) -> ChatResult:
        url = f"{self.base_url}/chat/completions"
        payload = self._payload(
            messages, model,
            temperature=temperature, max_tokens=max_tokens,
            stream=False, response_format=response_format,
        )
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(url, headers=self._headers(), json=payload)
            r.raise_for_status()
            data = r.json()

        choice = data["choices"][0]
        content = choice["message"]["content"] or ""
        usage = data.get("usage") or {}
        return ChatResult(
            content=content,
            model=data.get("model", model),
            prompt_tokens=usage.get("prompt_tokens", 0),
            completion_tokens=usage.get("completion_tokens", 0),
        )

    async def stream(
        self,
        messages: list[Message],
        model: str,
        *,
        temperature: float = 0.7,
        max_tokens: int | None = None,
    ) -> AsyncIterator[str]:
        url = f"{self.base_url}/chat/completions"
        payload = self._payload(
            messages, model,
            temperature=temperature, max_tokens=max_tokens,
            stream=True,
        )
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            async with client.stream("POST", url, headers=self._headers(), json=payload) as r:
                r.raise_for_status()
                async for line in r.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data_str = line[5:].strip()
                    if data_str == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue
                    delta = chunk.get("choices", [{}])[0].get("delta", {})
                    content = delta.get("content")
                    if content:
                        yield content
