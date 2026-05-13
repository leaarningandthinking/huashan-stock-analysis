from __future__ import annotations

import time

import httpx
from fastapi import APIRouter, HTTPException

from app.llm.base import Message
from app.llm.factory import UnknownProviderError, build_client
from app.llm.registry import PROVIDERS, get_provider
from app.schemas.llm import LLMTestRequest, LLMTestResponse, ProviderMeta

router = APIRouter(prefix="/api/llm", tags=["llm"])


@router.get("/providers", response_model=list[ProviderMeta])
async def list_providers() -> list[ProviderMeta]:
    return [ProviderMeta(**p) for p in PROVIDERS]


@router.get("/providers/{provider_id}", response_model=ProviderMeta)
async def get_provider_meta(provider_id: str) -> ProviderMeta:
    info = get_provider(provider_id)
    if info is None:
        raise HTTPException(404, f"Unknown provider: {provider_id}")
    return ProviderMeta(**info)


@router.post("/test", response_model=LLMTestResponse)
async def test_connectivity(req: LLMTestRequest) -> LLMTestResponse:
    """用用户填的 key 发一个最小 chat 来验证连通。

    安全：不持久化 api_key，只在本次请求生命周期内用。
    """
    try:
        client = build_client(req.provider, req.api_key, req.base_url)
    except UnknownProviderError as e:
        raise HTTPException(400, str(e))

    messages = [
        Message(role="system", content="你是一个测试助手，用尽量短的话回复。"),
        Message(role="user", content="请回复一个汉字：好"),
    ]

    t0 = time.perf_counter()
    try:
        result = await client.chat(messages, req.model, temperature=0.1, max_tokens=8)
    except httpx.HTTPStatusError as e:
        return LLMTestResponse(
            ok=False,
            latency_ms=int((time.perf_counter() - t0) * 1000),
            error=f"HTTP {e.response.status_code}: {e.response.text[:200]}",
        )
    except httpx.HTTPError as e:
        return LLMTestResponse(
            ok=False,
            latency_ms=int((time.perf_counter() - t0) * 1000),
            error=f"网络错误: {type(e).__name__}: {str(e)[:200]}",
        )
    except Exception as e:
        return LLMTestResponse(
            ok=False,
            latency_ms=int((time.perf_counter() - t0) * 1000),
            error=f"{type(e).__name__}: {str(e)[:200]}",
        )

    latency = int((time.perf_counter() - t0) * 1000)
    return LLMTestResponse(
        ok=True,
        latency_ms=latency,
        sample=result.content[:50],
        model=result.model,
    )
