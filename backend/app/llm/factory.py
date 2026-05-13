"""根据前端传入的 LLMConfig 构造 LLMClient 实例。"""

from __future__ import annotations

from app.llm.base import LLMClient
from app.llm.openai_compat import OpenAICompatClient
from app.llm.registry import get_provider


class UnknownProviderError(Exception):
    pass


def build_client(
    provider_id: str,
    api_key: str,
    base_url: str | None = None,
) -> LLMClient:
    """目前 DeepSeek / 讯飞 MaaS 都走 OpenAI 兼容协议。

    如果未来要接非 OpenAI 兼容的 provider（如某些原生 API），在这里加分支。
    """
    info = get_provider(provider_id)
    if info is None:
        raise UnknownProviderError(f"Unknown provider: {provider_id}")
    effective_base_url = base_url or info["default_base_url"]
    return OpenAICompatClient(
        provider_id=provider_id,
        base_url=effective_base_url,
        api_key=api_key,
    )
