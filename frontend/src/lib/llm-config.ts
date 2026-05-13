/**
 * LLM 配置类型 + localStorage 持久化。
 *
 * 这是开源项目的核心隐私承诺：API Key 永不上传服务器，仅在浏览器持久化。
 * 每次诊断请求时由前端把当时需要的字段附在 body 上送给后端，后端用完即弃。
 */

export type ProviderId =
  | "deepseek"
  | "spark_maas"
  | "custom"
  | "openrouter"
  | "kimi"
  | "minimax"
  | "zai_glm"
  | "minimax_china"
  | "alibaba_cloud"
  | "volcengine";

export interface ProviderConfig {
  apiKey: string;
  /** 自定义 base URL；空字符串表示用默认 */
  baseUrl: string;
  /** 该 provider 默认使用的模型 id */
  defaultModel: string;
  enabled: boolean;
  /** 上次成功测试时间（ms epoch），未测过 = 0 */
  lastTestedAt: number;
}

export interface RoutingPolicy {
  analyst: { provider: ProviderId; model: string };
  master: { provider: ProviderId; model: string };
  risk: { provider: ProviderId; model: string };
}

export interface LLMConfig {
  providers: Partial<Record<ProviderId, ProviderConfig>>;
  routing: RoutingPolicy | null;
  version: number;
}

const STORAGE_KEY = "hs_llm_config_v1";

export const DEFAULT_CONFIG: LLMConfig = {
  providers: {},
  routing: null,
  version: 1,
};

export function loadConfig(): LLMConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as LLMConfig;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(cfg: LLMConfig): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export function hasAnyEnabled(cfg: LLMConfig): boolean {
  return Object.values(cfg.providers).some((p) => p?.enabled && p.apiKey);
}
