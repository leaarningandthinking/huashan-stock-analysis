import { apiGet } from "@/lib/api";

export interface ServiceStatus {
  name: string;
  source?: "akshare" | "yfinance" | string;
  market?: string;
  status: "ok" | "fail";
  latency_ms: number;
  error: string | null;
  cached?: boolean;
  updated_at?: string;
  cache_ttl_seconds?: number;
}

export interface DatasourceHealth {
  akshare_version: string;
  yfinance_version?: string;
  probe_code: string;
  probes?: {
    a_share?: string;
    us?: string;
    hk?: string;
  };
  overall: "ok" | "degraded";
  services: ServiceStatus[];
  cached?: boolean;
  updated_at?: string;
  cache_ttl_seconds?: number;
}

export function fetchDatasourceHealth(force = false): Promise<DatasourceHealth> {
  return apiGet<DatasourceHealth>(`/api/datasource/health${force ? "?force=true" : ""}`);
}

export function refreshDatasourceService(
  serviceName: string,
): Promise<{ service: ServiceStatus }> {
  return apiGet<{ service: ServiceStatus }>(
    `/api/datasource/health/${encodeURIComponent(serviceName)}`,
  );
}
