"""LLM Provider 元信息：用户在前端配置时看到的可选项。

只放静态信息（默认 base_url、可选模型列表）。
真实的 api_key / 自定义 base_url 由前端 localStorage 持有，请求时 body 携带。
"""

from typing import TypedDict


class ModelOption(TypedDict):
    id: str
    label: str
    notes: str


class ProviderInfo(TypedDict):
    id: str
    name: str
    description: str
    homepage: str
    default_base_url: str
    base_url_editable: bool  # 是否允许用户在 UI 改 base_url
    models: list[ModelOption]
    api_key_format_hint: str
    docs_url: str


PROVIDERS: list[ProviderInfo] = [
    {
        "id": "deepseek",
        "name": "DeepSeek",
        "description": "深度求索，主力 deepseek-chat（V3）+ deepseek-reasoner（R1）。",
        "homepage": "https://platform.deepseek.com/",
        "default_base_url": "https://api.deepseek.com",
        "base_url_editable": False,
        "models": [
            {"id": "deepseek-chat", "label": "DeepSeek Chat (V4)", "notes": "对话主力，alias 跟随最新版"},
            {"id": "deepseek-reasoner", "label": "DeepSeek Reasoner (V4)", "notes": "推理增强，适合大师辩论"},
        ],
        "api_key_format_hint": "sk-xxxxxxxx...（在 platform.deepseek.com 创建）",
        "docs_url": "https://api-docs.deepseek.com/zh-cn/",
    },
    {
        "id": "spark_maas",
        "name": "讯飞星火 MaaS",
        "description": "讯飞 MaaS 平台，OpenAI 兼容入口。可调用星火系列与多种第三方开源模型。",
        "homepage": "https://maas.xfyun.cn/",
        # 讯飞 MaaS 代码模型 OpenAI 兼容 endpoint
        "default_base_url": "https://maas-coding-api.cn-huabei-1.xf-yun.com/v2",
        "base_url_editable": True,
        "models": [
            {"id": "astron-code-latest", "label": "Astron Code (Latest)", "notes": "默认 · 代码与推理"},
            {"id": "lite", "label": "星火 Lite", "notes": "免费档，速度快"},
            {"id": "generalv3", "label": "星火 Pro", "notes": "通用对话"},
            {"id": "generalv3.5", "label": "星火 Max", "notes": "强推理"},
            {"id": "4.0Ultra", "label": "星火 4.0 Ultra", "notes": "旗舰，适合大师辩论"},
        ],
        "api_key_format_hint": "Bearer token（在 maas.xfyun.cn 控制台获取）",
        "docs_url": "https://www.xfyun.cn/doc/spark/Web.html",
    },
    {
        "id": "custom",
        "name": "Custom (Direct API)",
        "description": "自定义 OpenAI 兼容 API，适合自建网关或私有代理。",
        "homepage": "https://platform.openai.com/docs/api-reference",
        "default_base_url": "",
        "base_url_editable": True,
        "models": [
            {"id": "custom-model", "label": "自定义模型", "notes": "请手动填写模型 ID"},
        ],
        "api_key_format_hint": "API Key",
        "docs_url": "https://platform.openai.com/docs/api-reference",
    },
    {
        "id": "openrouter",
        "name": "OpenRouter",
        "description": "OpenRouter OpenAI 兼容入口，可路由多家模型。",
        "homepage": "https://openrouter.ai/",
        "default_base_url": "https://openrouter.ai/api/v1",
        "base_url_editable": True,
        "models": [
            {"id": "openai/gpt-4.1", "label": "GPT-4.1", "notes": "通用强模型"},
            {"id": "anthropic/claude-3.5-sonnet", "label": "Claude 3.5 Sonnet", "notes": "综合能力"},
        ],
        "api_key_format_hint": "sk-or-...",
        "docs_url": "https://openrouter.ai/docs",
    },
    {
        "id": "kimi",
        "name": "Kimi",
        "description": "月之暗面 Moonshot / Kimi OpenAI 兼容 API。",
        "homepage": "https://platform.moonshot.cn/",
        "default_base_url": "https://api.moonshot.cn/v1",
        "base_url_editable": True,
        "models": [
            {"id": "kimi-k2-0711-preview", "label": "Kimi K2", "notes": "推理与工具调用"},
            {"id": "moonshot-v1-32k", "label": "Moonshot v1 32K", "notes": "长上下文"},
        ],
        "api_key_format_hint": "sk-...",
        "docs_url": "https://platform.moonshot.cn/docs",
    },
    {
        "id": "minimax",
        "name": "MiniMax",
        "description": "MiniMax 国际站 OpenAI 兼容 API。",
        "homepage": "https://www.minimax.io/",
        "default_base_url": "https://api.minimax.io/v1",
        "base_url_editable": True,
        "models": [
            {"id": "MiniMax-M1", "label": "MiniMax M1", "notes": "推理模型"},
            {"id": "MiniMax-Text-01", "label": "MiniMax Text 01", "notes": "通用对话"},
        ],
        "api_key_format_hint": "API Key",
        "docs_url": "https://www.minimax.io/platform/document",
    },
    {
        "id": "zai_glm",
        "name": "Z.AI / GLM",
        "description": "Zhipu AI / 智谱 GLM OpenAI 兼容直连 API。",
        "homepage": "https://open.bigmodel.cn/",
        "default_base_url": "https://open.bigmodel.cn/api/paas/v4",
        "base_url_editable": True,
        "models": [
            {"id": "glm-4.5", "label": "GLM-4.5", "notes": "旗舰推理"},
            {"id": "glm-4-flash", "label": "GLM-4 Flash", "notes": "轻量快速"},
        ],
        "api_key_format_hint": "API Key",
        "docs_url": "https://docs.bigmodel.cn/",
    },
    {
        "id": "minimax_china",
        "name": "MiniMax China",
        "description": "MiniMax 国内站 OpenAI 兼容 API。",
        "homepage": "https://platform.minimaxi.com/",
        "default_base_url": "https://api.minimax.chat/v1",
        "base_url_editable": True,
        "models": [
            {"id": "MiniMax-M1", "label": "MiniMax M1", "notes": "推理模型"},
            {"id": "abab6.5s-chat", "label": "abab6.5s", "notes": "通用对话"},
        ],
        "api_key_format_hint": "API Key",
        "docs_url": "https://platform.minimaxi.com/document",
    },
    {
        "id": "alibaba_cloud",
        "name": "Alibaba Cloud",
        "description": "阿里云百炼 DashScope OpenAI 兼容 API。",
        "homepage": "https://bailian.console.aliyun.com/",
        "default_base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "base_url_editable": True,
        "models": [
            {"id": "qwen-plus", "label": "Qwen Plus", "notes": "通用对话"},
            {"id": "qwen-max", "label": "Qwen Max", "notes": "更强能力"},
        ],
        "api_key_format_hint": "sk-...",
        "docs_url": "https://help.aliyun.com/zh/model-studio/",
    },
    {
        "id": "volcengine",
        "name": "火山引擎",
        "description": "火山方舟 Ark OpenAI 兼容 API。",
        "homepage": "https://www.volcengine.com/product/ark",
        "default_base_url": "https://ark.cn-beijing.volces.com/api/v3",
        "base_url_editable": True,
        "models": [
            {"id": "doubao-seed-1-6", "label": "Doubao Seed 1.6", "notes": "通用对话"},
            {"id": "deepseek-r1", "label": "DeepSeek R1", "notes": "方舟托管"},
        ],
        "api_key_format_hint": "API Key",
        "docs_url": "https://www.volcengine.com/docs/82379",
    },
]


def get_provider(provider_id: str) -> ProviderInfo | None:
    for p in PROVIDERS:
        if p["id"] == provider_id:
            return p
    return None
