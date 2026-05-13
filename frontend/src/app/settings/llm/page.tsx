"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, KeyRound } from "lucide-react";
import { fetchProviders, type ProviderMeta } from "@/lib/llm-api";
import { ProviderCard } from "@/components/settings/ProviderCard";
import { useLLMStore } from "@/stores/llm";

const FALLBACK_PROVIDERS: ProviderMeta[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    description: "深度求索，主力 deepseek-chat + deepseek-reasoner。",
    homepage: "https://platform.deepseek.com/",
    default_base_url: "https://api.deepseek.com",
    base_url_editable: false,
    models: [
      { id: "deepseek-chat", label: "DeepSeek Chat", notes: "对话主力" },
      { id: "deepseek-reasoner", label: "DeepSeek Reasoner", notes: "推理增强，适合大师辩论" },
    ],
    api_key_format_hint: "sk-xxxxxxxx...（在 platform.deepseek.com 创建）",
    docs_url: "https://api-docs.deepseek.com/zh-cn/",
  },
  {
    id: "spark_maas",
    name: "讯飞星火 MaaS",
    description: "讯飞 MaaS 平台，OpenAI 兼容入口。",
    homepage: "https://maas.xfyun.cn/",
    default_base_url: "https://maas-coding-api.cn-huabei-1.xf-yun.com/v2",
    base_url_editable: true,
    models: [
      { id: "astron-code-latest", label: "Astron Code (Latest)", notes: "默认 · 代码与推理" },
      { id: "lite", label: "星火 Lite", notes: "免费档，速度快" },
      { id: "generalv3.5", label: "星火 Max", notes: "强推理" },
      { id: "4.0Ultra", label: "星火 4.0 Ultra", notes: "旗舰，适合大师辩论" },
    ],
    api_key_format_hint: "Bearer token（在 maas.xfyun.cn 控制台获取）",
    docs_url: "https://www.xfyun.cn/doc/spark/Web.html",
  },
  {
    id: "custom",
    name: "Custom (Direct API)",
    description: "自定义 OpenAI 兼容 API，适合自建网关或私有代理。",
    homepage: "https://platform.openai.com/docs/api-reference",
    default_base_url: "",
    base_url_editable: true,
    models: [{ id: "custom-model", label: "自定义模型", notes: "请手动填写模型 ID" }],
    api_key_format_hint: "API Key",
    docs_url: "https://platform.openai.com/docs/api-reference",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "OpenRouter OpenAI 兼容入口，可路由多家模型。",
    homepage: "https://openrouter.ai/",
    default_base_url: "https://openrouter.ai/api/v1",
    base_url_editable: true,
    models: [
      { id: "openai/gpt-4.1", label: "GPT-4.1", notes: "通用强模型" },
      { id: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet", notes: "综合能力" },
    ],
    api_key_format_hint: "sk-or-...",
    docs_url: "https://openrouter.ai/docs",
  },
  {
    id: "kimi",
    name: "Kimi",
    description: "月之暗面 Moonshot / Kimi OpenAI 兼容 API。",
    homepage: "https://platform.moonshot.cn/",
    default_base_url: "https://api.moonshot.cn/v1",
    base_url_editable: true,
    models: [
      { id: "kimi-k2-0711-preview", label: "Kimi K2", notes: "推理与工具调用" },
      { id: "moonshot-v1-32k", label: "Moonshot v1 32K", notes: "长上下文" },
    ],
    api_key_format_hint: "sk-...",
    docs_url: "https://platform.moonshot.cn/docs",
  },
];

export default function LLMSettingsPage() {
  const [providers, setProviders] = useState<ProviderMeta[]>(FALLBACK_PROVIDERS);
  const hydrate = useLLMStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
    fetchProviders()
      .then(setProviders)
      .catch(() => setProviders(FALLBACK_PROVIDERS));
  }, [hydrate]);

  return (
    <main className="container mx-auto max-w-3xl py-12">
      <header className="mb-8">
        <h1 className="mb-2 text-3xl font-bold text-ink-800">模型配置</h1>
        <p className="text-sm text-ink-500">
          为每位大师准备好他们说话用的模型。配置完成后即可前往论股。
        </p>

        <div className="mt-4 flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50/60 p-3 text-xs text-emerald-800">
          <ShieldCheck className="mt-0.5 h-4 w-4 flex-none" />
          <div>
            <p className="font-medium">隐私承诺</p>
            <p className="mt-0.5 leading-relaxed text-emerald-700">
              你填的 API Key 只保存在浏览器 localStorage，
              <span className="font-mono">{`不会`}</span>上传服务器。
              每次诊断请求时由前端临时附在请求里送给后端，后端调用完即丢弃，不入数据库。
            </p>
          </div>
        </div>
      </header>

      <div className="space-y-6">
        {providers.map((p) => (
          <ProviderCard key={p.id} meta={p} />
        ))}
      </div>

      <footer className="mt-12 border-t border-ink-200 pt-6 text-xs text-ink-400">
        <div className="flex items-start gap-2">
          <KeyRound className="mt-0.5 h-4 w-4 flex-none" />
          <div>
            <p>
              没账号？
              <a
                href="https://platform.deepseek.com/api_keys"
                target="_blank"
                rel="noreferrer"
                className="ml-1 text-scarlet-600 hover:underline"
              >
                DeepSeek 注册领 key
              </a>
              {" · "}
              <a
                href="https://maas.xfyun.cn/"
                target="_blank"
                rel="noreferrer"
                className="text-scarlet-600 hover:underline"
              >
                讯飞 MaaS 控制台
              </a>
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}
