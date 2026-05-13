/**
 * 后端 LLM 路由的前端封装。
 */

import { apiGet, apiPost } from "@/lib/api";

export interface ModelOption {
  id: string;
  label: string;
  notes: string;
}

export interface ProviderMeta {
  id: string;
  name: string;
  description: string;
  homepage: string;
  default_base_url: string;
  base_url_editable: boolean;
  models: ModelOption[];
  api_key_format_hint: string;
  docs_url: string;
}

export interface LLMTestResponse {
  ok: boolean;
  latency_ms: number;
  sample: string;
  model: string;
  error: string | null;
}

export function fetchProviders(): Promise<ProviderMeta[]> {
  return apiGet<ProviderMeta[]>("/api/llm/providers");
}

export function testProvider(payload: {
  provider: string;
  api_key: string;
  model: string;
  base_url?: string;
}): Promise<LLMTestResponse> {
  return apiPost<LLMTestResponse>("/api/llm/test", payload);
}
