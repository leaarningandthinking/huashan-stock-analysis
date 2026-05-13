"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, XCircle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  fetchDatasourceHealth,
  refreshDatasourceService,
  type DatasourceHealth,
  type ServiceStatus,
} from "@/lib/datasource-api";

const SERVICE_LABELS: Record<string, { label: string; desc: string }> = {
  a_share_symbol_list: { label: "A 股代码列表", desc: "akshare：全 A 股代码 + 名字，用于输入校验。" },
  a_share_fundamentals: { label: "A 股基本面", desc: "akshare：财务摘要 / ROE / 估值。" },
  a_share_technical: { label: "A 股技术面行情", desc: "akshare：前复权历史 K 线 + 技术指标计算。" },
  a_share_news: { label: "A 股个股新闻", desc: "akshare：东财个股新闻 / 公告。" },
  a_share_sentiment: { label: "A 股市场情绪", desc: "akshare：千股千评 / 关注指数。" },
  us_stock_quotes: { label: "美股行情", desc: "yfinance：Yahoo Finance 免费行情接口，探测 AAPL。" },
  hk_stock_quotes: { label: "港股行情", desc: "yfinance：Yahoo Finance 免费行情接口，探测 0700.HK。" },
};
const HEALTH_STORAGE_KEY = "huashan-datasource-health";
const HEALTH_STORAGE_TTL = 6 * 60 * 60 * 1000;

function fallbackDatasource(error: string): DatasourceHealth {
  return {
    akshare_version: "unknown",
    probe_code: "600519",
    overall: "degraded",
    services: Object.keys(SERVICE_LABELS).map((name) => ({
      name,
      status: "fail",
      latency_ms: 0,
      error,
    })),
  };
}

export default function DatasourcePage() {
  const [data, setData] = useState<DatasourceHealth | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshingService, setRefreshingService] = useState<string | null>(null);

  async function refresh(force = false) {
    if (!force) {
      const cached = readCachedHealth();
      if (cached) {
        setData(cached);
        setLoading(false);
        return;
      }
    }
    setLoading(true);
    setLoadError(null);
    try {
      const r = await fetchDatasourceHealth(force);
      setData(r);
      writeCachedHealth(r);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setLoadError(message);
      setData(fallbackDatasource(message));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh(false);
  }, []);

  async function refreshOne(serviceName: string) {
    setRefreshingService(serviceName);
    setLoadError(null);
    try {
      const r = await refreshDatasourceService(serviceName);
      setData((prev) => {
        if (!prev) return prev;
        const services = prev.services.map((s) => (s.name === serviceName ? r.service : s));
        const next = {
          ...prev,
          services,
          overall: services.every((s) => s.status === "ok") ? "ok" as const : "degraded" as const,
          cached: services.every((s) => s.cached),
          updated_at: latestUpdatedAt(services) ?? prev.updated_at,
        };
        writeCachedHealth(next);
        return next;
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshingService(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 lg:px-10 lg:py-12">
      <header className="mb-8">
        <h1 className="mb-2 text-3xl font-bold text-ink-800">数据源</h1>
        <p className="text-sm text-ink-500">
          A 股使用{" "}
          <a
            href="https://github.com/akfamily/akshare"
            target="_blank"
            rel="noreferrer"
            className="text-scarlet-600 hover:underline"
          >
            akshare
          </a>
          ，港股和美股使用 yfinance 的 Yahoo Finance 免费接口。东财 / 新浪 / Yahoo 源偶有波动，业务侧通过缓存和降级兜底。
        </p>
      </header>

      <div className="mb-4 flex flex-col gap-3 rounded-lg border border-ink-200 bg-white/60 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-ink-500">
          {data && (
            <span>
              akshare {data.akshare_version} · yfinance {data.yfinance_version ?? "unknown"} ·{" "}
              A股 {data.probes?.a_share ?? data.probe_code} / 美股 {data.probes?.us ?? "AAPL"} / 港股{" "}
              {data.probes?.hk ?? "0700.HK"} ·{" "}
              {data.overall === "ok" ? (
                <span className="text-emerald-700">全部正常</span>
              ) : (
                <span className="text-amber-700">部分降级</span>
              )}
              {data.updated_at && (
                <>
                  {" "}
                  · {data.cached ? "缓存" : "最新"} {new Date(data.updated_at).toLocaleString("zh-CN")}
                </>
              )}
            </span>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => refresh(true)} disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          强制探活
        </Button>
      </div>

      {loadError && (
        <div className="mb-4 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            数据源探活接口不可用，下面展示的是兜底状态，不代表 akshare 或 yfinance 实际全部失败：{loadError}
          </span>
        </div>
      )}

      {data && (
        <div className="space-y-3">
          {data.services.map((s) => {
            const meta = SERVICE_LABELS[s.name] ?? {
              label: s.name,
              desc: "",
            };
            const ok = s.status === "ok";
            return (
              <Card key={s.name}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between text-base">
                    <span className="flex items-center gap-2">
                      {ok ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                      ) : (
                        <XCircle className="h-5 w-5 text-red-600" />
                      )}
                      {meta.label}
                    </span>
                    <span className="flex items-center gap-3">
                      <span
                        className={
                          "text-xs font-normal " +
                          (ok ? "text-emerald-700" : "text-red-700")
                        }
                      >
                        {ok ? `${s.latency_ms}ms` : "失败"}
                      </span>
                      {!ok && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => refreshOne(s.name)}
                          disabled={refreshingService === s.name}
                        >
                          {refreshingService === s.name ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                          重新缓存
                        </Button>
                      )}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 text-xs text-ink-500">
                  <p>{meta.desc}</p>
                  {(s.source || s.market) && (
                    <p className="mt-2">
                      {s.market ? `${s.market} · ` : ""}
                      {s.source ?? ""}
                    </p>
                  )}
                  {s.updated_at && (
                    <p className="mt-2">
                      缓存时间：{new Date(s.updated_at).toLocaleString("zh-CN")}
                      {s.cached ? "（缓存命中）" : "（刚刷新）"}
                    </p>
                  )}
                  {s.error && (
                    <p className="mt-2 break-all rounded bg-red-50 p-2 text-red-700">
                      {s.error}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {!data && loading && (
        <div className="text-center text-sm text-ink-400">
          首次探活需要并行打 7 个源，约 3-8 秒…
        </div>
      )}
    </main>
  );
}

function latestUpdatedAt(services: ServiceStatus[]): string | null {
  const dates = services.map((s) => s.updated_at).filter(Boolean) as string[];
  return dates.length > 0 ? dates.sort().at(-1)! : null;
}

function readCachedHealth(): DatasourceHealth | null {
  try {
    const raw = window.localStorage.getItem(HEALTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { saved_at: number; data: DatasourceHealth };
    if (!parsed?.saved_at || Date.now() - parsed.saved_at > HEALTH_STORAGE_TTL) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCachedHealth(data: DatasourceHealth) {
  try {
    window.localStorage.setItem(
      HEALTH_STORAGE_KEY,
      JSON.stringify({ saved_at: Date.now(), data }),
    );
  } catch {
    // ignore localStorage quota/security errors
  }
}
