"use client";

import { useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import Link from "next/link";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  BarChart3,
  Clock3,
  Copy,
  Download,
  FileText,
  Gauge,
  Loader2,
  RotateCcw,
  Share2,
  ShieldAlert,
  Target,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShortTermAnalysisResult } from "@/components/short-term/ShortTermAnalysisResult";
import { StockAutocomplete } from "@/components/portfolio/StockAutocomplete";
import { listDiagnosisTasks } from "@/lib/diagnosis-api";
import type { StockInfo } from "@/lib/portfolio-api";
import { buildRecentStocks, type RecentStock } from "@/lib/recent-stocks";
import {
  createShortTermShareLink,
  getShortTermReport,
  listShortTermTasks,
  startShortTermAnalysis,
  type ShortTermCandle,
  type ShortTermAnalyzeResponse,
  type ShortTermTaskSummary,
  type ShortTermLevel,
} from "@/lib/short-term-api";
import { downloadShortTermMarkdown, downloadShortTermPdf } from "@/lib/short-term-report";
import { useLLMStore } from "@/stores/llm";
import { cn } from "@/lib/cn";

type RecentSelectableStock = StockInfo & {
  id: string;
  created_at: string;
  source: "diagnosis" | "short_term";
};

export default function ShortTermPage() {
  const [stock, setStock] = useState<StockInfo | null>(null);
  const [result, setResult] = useState<ShortTermAnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [recentStocks, setRecentStocks] = useState<RecentSelectableStock[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const llmStore = useLLMStore();

  async function refreshRecent() {
    setRecentLoading(true);
    try {
      const [diagnosisTasks, shortTermTasks] = await Promise.all([
        listDiagnosisTasks(),
        listShortTermTasks(),
      ]);
      setRecentStocks(buildShortTermRecentStocks(buildRecentStocks(diagnosisTasks, 12), shortTermTasks, 10));
    } catch {
      setRecentStocks([]);
    } finally {
      setRecentLoading(false);
    }
  }

  useEffect(() => {
    llmStore.hydrate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refreshRecent();
  }, []);

  const enabledProvider = Object.entries(llmStore.config.providers).find(
    ([, p]) => p?.enabled && p.apiKey && p.defaultModel,
  );
  const isAnalyzing = loading || taskId != null;

  async function handleAnalyze() {
    if (!stock || !enabledProvider) return;
    const [providerId, cfg] = enabledProvider;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await startShortTermAnalysis({
        code: stock.code,
        name: stock.name,
        llm: {
          provider: providerId,
          api_key: cfg!.apiKey,
          model: cfg!.defaultModel,
          base_url: cfg!.baseUrl || undefined,
        },
      });
      setTaskId(res.task_id);
      refreshRecent();
      await pollTask(res.task_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  }

  async function pollTask(id: string) {
    try {
      while (true) {
        const data = await getShortTermReport(id);
        if (data.status === "done" && data.report) {
          setResult(data.report);
          setLoading(false);
          refreshRecent();
          return;
        }
        if (data.status === "failed") {
          setError(data.error || "短线分析失败");
          setLoading(false);
          refreshRecent();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1800));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    } finally {
      setTaskId(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 lg:px-10 lg:py-12">
      <div className="mb-8 max-w-3xl">
        <h1 className="mb-2 text-4xl font-black tracking-tight text-ink-900">短线分析</h1>
        <p className="text-sm leading-6 text-ink-500">
          选一只 A 股，按固定技术规则生成短线观察计划。关键价位会单独用组件展示，便于盯盘确认。
        </p>
      </div>

      <div className="space-y-6">
        <section className="space-y-6 rounded-lg border border-ink-200 bg-white/70 p-6 shadow-sm">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_190px] lg:items-end">
            <div>
              <label className="mb-2 block text-sm font-semibold text-ink-700">
                股票代码或名字
              </label>
              <StockAutocomplete
                value={stock}
                onChange={(item) => {
                  setStock(item);
                  setResult(null);
                  setError(null);
                }}
                placeholder="输入 A 股代码或名字，例：000725 / 京东方"
              />
            </div>

            <Button
              onClick={handleAnalyze}
              disabled={!stock || !enabledProvider || loading}
              size="lg"
              className="w-full"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
              生成分析
            </Button>
          </div>

          <div className="flex flex-wrap gap-3">
            {stock && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-sm text-emerald-800">
                已选中：<span className="font-mono">{stock.code}</span>
                {" · "}
                <span className="font-medium">{stock.name}</span>
                {" · "}
                <span className="text-xs text-emerald-700">
                  {stock.exchange.toUpperCase()}
                </span>
              </div>
            )}

            <div className="inline-flex items-center gap-2 rounded-md border border-ink-200 bg-[#fffdf8] px-3 py-2 text-xs font-semibold text-ink-500">
              <Activity className="h-3.5 w-3.5 text-scarlet-600" />
              akshare 行情 · 固定技术规则 · 当前模型配置
            </div>
          </div>

          {!enabledProvider && llmStore.hydrated && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50/60 p-3 text-sm text-amber-800">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
              <div>
                <p className="font-medium">还没配置可用的 LLM Provider</p>
                <p className="text-xs">
                  <Link href="/settings/llm" className="underline">
                    先去模型配置页
                  </Link>{" "}
                  填入 API Key 并测试通过。
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
        )}
      </section>

        {!isAnalyzing && (
          <RecentStocksPanel
            stock={stock}
            stocks={recentStocks}
            loading={recentLoading}
            onRefresh={refreshRecent}
            onSelect={(item) => {
              setStock({
                code: item.code,
                name: item.name,
                exchange: item.exchange,
              });
              setResult(null);
              setError(null);
            }}
          />
        )}

        {!result ? (
          <EmptyState loading={loading} taskId={taskId} />
        ) : (
          <ShortTermAnalysisResult result={result} />
        )}
      </div>
    </main>
  );
}

function RecentStocksPanel({
  stock,
  stocks,
  loading,
  onRefresh,
  onSelect,
}: {
  stock: StockInfo | null;
  stocks: RecentSelectableStock[];
  loading: boolean;
  onRefresh: () => void;
  onSelect: (stock: RecentSelectableStock) => void;
}) {
  return (
    <section className="rounded-lg border border-ink-200 bg-[#fffdf8] p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-black text-ink-900">最近股票</h2>
          <p className="mt-1 text-xs text-ink-400">点击后自动填入上方输入框</p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-lg p-2 text-ink-400 transition hover:bg-ink-100 hover:text-scarlet-600"
          aria-label="刷新最近股票"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
        </button>
      </div>

      {stocks.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {stocks.map((item) => {
            const selected = stock?.code === item.code;
            return (
              <button
                key={`${item.source}-${item.id}-${item.code}`}
                type="button"
                onClick={() => onSelect(item)}
                className={`group flex items-center justify-between gap-3 rounded-lg border px-3 py-3 text-left transition ${
                  selected
                    ? "border-scarlet-300 bg-[#fff1ed] shadow-sm"
                    : "border-ink-100 bg-white/70 hover:border-[#e6b8b1] hover:bg-white"
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-ink-800">{item.name}</span>
                  <span className="mt-1 flex items-center gap-2 text-xs text-ink-400">
                    <span className="font-mono">{item.code}</span>
                    <span>{item.exchange.toUpperCase()}</span>
                    {item.source === "short_term" && <span>短线</span>}
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-ink-50 px-2 py-1 text-[11px] font-semibold text-ink-500 group-hover:text-scarlet-600">
                  选中
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-ink-200 bg-white/50 p-6 text-center">
          <Clock3 className="mx-auto h-5 w-5 text-ink-300" />
          <p className="mt-2 text-sm font-semibold text-ink-600">暂无最近股票</p>
          <p className="mt-1 text-xs leading-5 text-ink-400">完成一次论股或短线分析后，这里会展示近期分析过的标的。</p>
        </div>
      )}
    </section>
  );
}

function buildShortTermRecentStocks(
  diagnosisStocks: RecentStock[],
  shortTermTasks: ShortTermTaskSummary[],
  limit: number,
): RecentSelectableStock[] {
  const candidates: RecentSelectableStock[] = [
    ...shortTermTasks.map((task) => ({
      code: task.code,
      name: task.name || task.code,
      exchange: exchangeFromCode(task.code),
      id: task.task_id,
      created_at: task.created_at,
      source: "short_term" as const,
    })),
    ...diagnosisStocks.map((item) => ({
      code: item.code,
      name: item.name,
      exchange: item.exchange,
      id: item.diagnosis_id,
      created_at: item.created_at,
      source: "diagnosis" as const,
    })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const seen = new Set<string>();
  const result: RecentSelectableStock[] = [];
  for (const item of candidates) {
    if (!item.code || seen.has(item.code)) continue;
    seen.add(item.code);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

function exchangeFromCode(code: string): StockInfo["exchange"] {
  if (code.endsWith(".HK")) return "hk";
  if (/^[A-Z]/i.test(code)) return "us";
  if (code.startsWith("6")) return "sh";
  if (code.startsWith("8") || code.startsWith("4")) return "bj";
  return "sz";
}

function EmptyState({ loading, taskId }: { loading: boolean; taskId?: string | null }) {
  return (
    <section className="rounded-lg border border-dashed border-ink-200 bg-white/45 px-6 py-14 text-center">
      {loading ? (
        <Loader2 className="mx-auto h-7 w-7 animate-spin text-scarlet-600" />
      ) : (
        <Target className="mx-auto h-7 w-7 text-ink-300" />
      )}
      <h2 className="mt-4 text-base font-black text-ink-800">
        {loading ? "正在生成短线分析" : "选择股票后开始分析"}
      </h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-ink-500">
        {loading
          ? "正在抓取行情、计算关键价位，并调用已配置模型生成短线判断。"
          : "结果会按趋势、价格阶段、动量、量能和关键价位分层展示。"}
      </p>
      {taskId && (
        <p className="mt-3 text-xs text-ink-400">
          任务已保留到分析任务，可切换页面后继续查看：<span className="font-mono">{taskId.slice(0, 8)}</span>
        </p>
      )}
    </section>
  );
}

function AnalysisResult({ result }: { result: ShortTermAnalyzeResponse }) {
  const snapshot = result.snapshot;
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  function runDownload(type: "pdf" | "md") {
    setDownloadError(null);
    try {
      if (type === "pdf") {
        downloadShortTermPdf(result);
      } else {
        downloadShortTermMarkdown(result);
      }
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleShare() {
    if (!result.task_id) return;
    setSharing(true);
    setDownloadError(null);
    try {
      const res = await createShortTermShareLink(result.task_id);
      const absolute = `${window.location.origin}${res.url}`;
      setShareUrl(absolute);
      await navigator.clipboard?.writeText(absolute);
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : String(e));
    } finally {
      setSharing(false);
    }
  }

  return (
    <section className="space-y-6">
      <div className="rounded-lg border border-ink-200 bg-white/70 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-ink-400">数据日期：{snapshot.date}</p>
            <h2 className="mt-1 text-2xl font-black text-ink-900">
              {result.name} <span className="font-mono text-base text-ink-400">{result.code}</span>
            </h2>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-xs font-semibold text-ink-400">收盘价</p>
            <p className="text-3xl font-black text-scarlet-600">{snapshot.close.toFixed(2)}</p>
            <div className="mt-3 flex flex-wrap justify-start gap-2 sm:justify-end">
              <Button type="button" variant="outline" size="sm" onClick={() => runDownload("pdf")}>
                <Download className="h-4 w-4" />
                PDF
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => runDownload("md")}>
                <FileText className="h-4 w-4" />
                Markdown
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleShare}
                disabled={!result.task_id || sharing}
              >
                {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
                分享
              </Button>
            </div>
          </div>
        </div>
        {shareUrl && (
          <div className="mt-4 flex items-center gap-2 rounded-md bg-ink-50 px-3 py-2 text-xs text-ink-600">
            <Copy className="h-3.5 w-3.5" />
            <span className="truncate">{shareUrl}</span>
          </div>
        )}
        {downloadError && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            {downloadError}
          </div>
        )}

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric icon={TrendingUp} label="趋势" value={snapshot.trend} />
          <Metric icon={Gauge} label="动量" value={snapshot.momentum} />
          <Metric icon={BarChart3} label="量能" value={snapshot.volume_state} />
          <Metric
            icon={ShieldAlert}
            label="RSI14"
            value={snapshot.rsi14 == null ? "无数据" : snapshot.rsi14.toFixed(1)}
          />
        </div>
      </div>

      <KeyPriceBoard levels={result.levels} current={snapshot.close} candles={result.chart} />

      <div className="rounded-lg border border-ink-200 bg-white/70 p-6 shadow-sm">
        <h3 className="text-lg font-black text-ink-900">短线结论</h3>
        <div className="mt-4 whitespace-pre-wrap text-sm leading-7 text-ink-700">
          {result.ai_analysis}
        </div>
      </div>

      <p className="text-xs leading-5 text-ink-400">{result.risk_notice}</p>
    </section>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-ink-100 bg-[#fffdf8] px-4 py-4">
      <div className="flex items-center gap-2 text-xs font-semibold text-ink-400">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <div className="mt-2 text-base font-black text-ink-800">{value}</div>
    </div>
  );
}

function KeyPriceBoard({
  levels,
  current,
  candles,
}: {
  levels: ShortTermLevel[];
  current: number;
  candles: ShortTermCandle[];
}) {
  const board = useMemo(() => {
    const supports = levels
      .filter((item) => item.kind !== "current" && item.price < current)
      .sort((a, b) => b.price - a.price)
      .slice(0, 4)
      .reverse();
    const resistances = levels
      .filter((item) => item.kind !== "current" && item.price >= current)
      .sort((a, b) => a.price - b.price)
      .slice(0, 4);
    return [...supports, ...levels.filter((item) => item.kind === "current"), ...resistances];
  }, [current, levels]);

  const chart = useMemo(() => candles.slice(-250), [candles]);
  const chartLevels = useMemo(() => {
    return deriveChartLevels(chart, current, levels);
  }, [chart, current, levels]);

  return (
    <div className="rounded-lg border border-ink-200 bg-white/70 p-6 shadow-sm">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-ink-900">关键价位</h3>
          <p className="mt-1 text-xs text-ink-500">
            近一年 K 线仅突出核心支撑、压力，并叠加 MA20/MA60 趋势线。
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px] font-bold text-ink-500">
          <LegendDot className="bg-amber-500" label="支撑" />
          <LegendDot className="bg-emerald-600" label="压力" />
          <LegendLine className="bg-sky-600" label="MA20" />
          <LegendLine className="bg-indigo-500" label="MA60" />
        </div>
      </div>

      <div className="rounded-lg border border-ink-100 bg-[#fffdf8] p-4">
        <CandleChart candles={chart} levels={chartLevels} current={current} />

        <div className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {board.map((level) => (
            <div
              key={`${level.label}-${level.price}-${level.note}`}
              className={cn(
                "rounded-md border px-3 py-3",
                level.kind === "current"
                  ? "border-ink-200 bg-white"
                  : level.price < current
                    ? "border-emerald-200 bg-emerald-50/50"
                    : "border-amber-200 bg-amber-50/50",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-sm font-black text-ink-800">{level.label}</span>
                <span className="font-mono text-sm font-black text-ink-900">
                  {level.price.toFixed(2)}
                </span>
              </div>
              <p className="mt-1 text-xs leading-5 text-ink-500">{level.note}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CandleChart({
  candles,
  levels,
  current,
}: {
  candles: ShortTermCandle[];
  levels: ShortTermLevel[];
  current: number;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const width = 960;
  const height = 420;
  const pad = { top: 24, right: 72, bottom: 38, left: 54 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const prices = [
    ...candles.flatMap((c) => [c.high, c.low, c.ma20, c.ma60].filter((v): v is number => v != null)),
    ...levels.map((x) => x.price),
    current,
  ];
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const rawRange = Math.max(maxPrice - minPrice, 0.01);
  const minYPrice = minPrice - rawRange * 0.08;
  const maxYPrice = maxPrice + rawRange * 0.08;
  const range = Math.max(maxYPrice - minYPrice, 0.01);
  const y = (price: number) => pad.top + ((maxYPrice - price) / range) * plotH;
  const x = (index: number) =>
    pad.left + (candles.length <= 1 ? 0 : (index / (candles.length - 1)) * plotW);
  const candleW = Math.max(2.2, Math.min(6.5, (plotW / Math.max(candles.length, 1)) * 0.58));
  const grid = Array.from({ length: 5 }, (_, i) => minYPrice + (range * i) / 4);
  const ma20Path = buildLinePath(candles.map((c, i) => [x(i), c.ma20 == null ? null : y(c.ma20)]));
  const ma60Path = buildLinePath(candles.map((c, i) => [x(i), c.ma60 == null ? null : y(c.ma60)]));
  const dateTicks = [0, Math.floor(candles.length / 2), candles.length - 1].filter(
    (idx, pos, arr) => idx >= 0 && candles[idx] && arr.indexOf(idx) === pos,
  );
  const hovered = hoverIndex == null ? null : candles[hoverIndex] ?? null;
  const hoverX = hoverIndex == null ? null : x(hoverIndex);
  const hoverY = hovered ? y(hovered.close) : null;
  const tooltipX = hoverX == null ? 0 : hoverX > width * 0.68 ? hoverX - 206 : hoverX + 14;
  const tooltipY = hoverY == null ? 0 : Math.max(16, Math.min(hoverY - 72, height - 142));

  function updateHover(clientX: number, currentTarget: SVGSVGElement) {
    const rect = currentTarget.getBoundingClientRect();
    const ratio = width / rect.width;
    const px = (clientX - rect.left) * ratio;
    const next = Math.round(((px - pad.left) / plotW) * (candles.length - 1));
    setHoverIndex(Math.max(0, Math.min(candles.length - 1, next)));
  }

  return (
    <div className="overflow-hidden rounded-lg border border-ink-100 bg-white shadow-inner">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="block h-auto w-full touch-pan-x select-none"
        role="img"
        aria-label="近一年K线图"
        onPointerMove={(event) => updateHover(event.clientX, event.currentTarget)}
        onPointerLeave={() => setHoverIndex(null)}
        onPointerDown={(event) => updateHover(event.clientX, event.currentTarget)}
      >
        <defs>
          <linearGradient id="chartBg" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#fffdfa" />
            <stop offset="100%" stopColor="#fbf7ef" />
          </linearGradient>
        </defs>
        <rect width={width} height={height} fill="url(#chartBg)" />
        <rect
          x={pad.left}
          y={pad.top}
          width={plotW}
          height={plotH}
          fill="#ffffff"
          opacity="0.62"
          rx="10"
        />
        {grid.map((price) => (
          <g key={price}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={y(price)}
              y2={y(price)}
              stroke="#eee6d8"
              strokeDasharray="3 7"
            />
            <text x={width - pad.right + 10} y={y(price) + 4} className="fill-ink-400 text-[11px]">
              {price.toFixed(2)}
            </text>
          </g>
        ))}

        {levels.map((level) => {
          const lineY = y(level.price);
          const color = level.kind === "support" ? "#d97706" : "#059669";
          return (
            <g key={`${level.label}-${level.price}-${level.kind}-line`}>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={lineY}
                y2={lineY}
                stroke={color}
                strokeWidth="2"
                strokeDasharray="7 6"
                opacity={0.92}
              />
              <rect
                x={pad.left + 8}
                y={lineY - 20}
                width={112}
                height={18}
                rx={5}
                fill="#fffdfa"
                stroke={color}
                opacity="0.95"
              />
              <text
                x={pad.left + 14}
                y={lineY - 7}
                fill={color}
                className="text-[11px] font-bold"
              >
                {level.label} {level.price.toFixed(2)}
              </text>
            </g>
          );
        })}

        {ma20Path && <path d={ma20Path} fill="none" stroke="#0284c7" strokeWidth="1.7" opacity="0.94" />}
        {ma60Path && <path d={ma60Path} fill="none" stroke="#6366f1" strokeWidth="1.7" opacity="0.86" />}

        {candles.map((candle, index) => {
          const cx = x(index);
          const up = candle.close >= candle.open;
          const color = up ? "#dc2626" : "#059669";
          const wickColor = up ? "#b91c1c" : "#047857";
          const openY = y(candle.open);
          const closeY = y(candle.close);
          const bodyY = Math.min(openY, closeY);
          const bodyH = Math.max(Math.abs(openY - closeY), 1.5);
          return (
            <g key={`${candle.date}-${index}`}>
              <line
                x1={cx}
                x2={cx}
                y1={y(candle.high)}
                y2={y(candle.low)}
                stroke={wickColor}
                strokeWidth="1"
                opacity="0.72"
              />
              <rect
                x={cx - candleW / 2}
                y={bodyY}
                width={candleW}
                height={bodyH}
                fill={up ? color : "#fffdfa"}
                stroke={color}
                strokeWidth="1"
                rx="0.8"
                opacity={hoverIndex === index ? 1 : 0.88}
              />
            </g>
          );
        })}

        {hovered && hoverX != null && hoverY != null && (
          <g>
            <line
              x1={hoverX}
              x2={hoverX}
              y1={pad.top}
              y2={height - pad.bottom}
              stroke="#6b6257"
              strokeDasharray="4 5"
              opacity="0.45"
            />
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={hoverY}
              y2={hoverY}
              stroke="#6b6257"
              strokeDasharray="4 5"
              opacity="0.35"
            />
            <circle cx={hoverX} cy={hoverY} r="4" fill="#111827" opacity="0.7" />
            <g transform={`translate(${tooltipX}, ${tooltipY})`}>
              <rect width="190" height="126" rx="10" fill="#1f1a17" opacity="0.92" />
              <text x="14" y="24" fill="#fffdfa" className="text-[12px] font-bold">
                {hovered.date}
              </text>
              <TooltipRow y={46} label="开盘" value={hovered.open} />
              <TooltipRow y={64} label="最高" value={hovered.high} />
              <TooltipRow y={82} label="最低" value={hovered.low} />
              <TooltipRow y={100} label="收盘" value={hovered.close} />
              <text x="14" y="118" fill="#b8aa98" className="text-[10px]">
                滑动查看每日价格
              </text>
            </g>
          </g>
        )}

        {dateTicks.map((idx) => (
          <text
            key={idx}
            x={x(idx)}
            y={height - 12}
            textAnchor={idx === 0 ? "start" : idx === candles.length - 1 ? "end" : "middle"}
            className="fill-ink-400 text-[11px]"
          >
            {candles[idx].date.slice(5)}
          </text>
        ))}
      </svg>
    </div>
  );
}

function buildLinePath(points: Array<[number, number | null]>) {
  let path = "";
  let open = false;
  for (const [px, py] of points) {
    if (py == null || Number.isNaN(py)) {
      open = false;
      continue;
    }
    path += `${open ? "L" : "M"}${px.toFixed(2)},${py.toFixed(2)} `;
    open = true;
  }
  return path.trim();
}

function deriveChartLevels(
  candles: ShortTermCandle[],
  current: number,
  sourceLevels: ShortTermLevel[],
): ShortTermLevel[] {
  const recent = candles.slice(-160);
  const pivots: Array<{ price: number; kind: "support" | "resistance"; date: string }> = [];
  const tolerance = Math.max(current * 0.008, 0.03);

  for (let index = 3; index < recent.length - 3; index += 1) {
    const window = recent.slice(index - 3, index + 4);
    const candle = recent[index];
    const isSwingLow = candle.low === Math.min(...window.map((item) => item.low));
    const isSwingHigh = candle.high === Math.max(...window.map((item) => item.high));

    if (isSwingLow && candle.low < current) {
      pivots.push({ price: candle.low, kind: "support", date: candle.date });
    }
    if (isSwingHigh && candle.high >= current - tolerance) {
      pivots.push({ price: candle.high, kind: "resistance", date: candle.date });
    }
  }

  const backendSupports = sourceLevels
    .filter((item) => item.kind === "support" && item.price < current)
    .map((item) => ({ price: item.price, kind: "support" as const, date: item.label }));
  const backendResistances = sourceLevels
    .filter((item) => item.kind === "resistance" && item.price >= current - tolerance)
    .map((item) => ({ price: item.price, kind: "resistance" as const, date: item.label }));

  const supports = clusterPriceLevels(
    [...pivots.filter((item) => item.kind === "support"), ...backendSupports],
    "support",
    current,
  )
    .sort((a, b) => b.price - a.price)
    .map((item) => ({
      label: "支撑",
      price: item.price,
      kind: "support",
      note: `近一年局部低点确认，最近触及 ${item.date}`,
    }))
    .slice(0, 1);

  const resistances = clusterPriceLevels(
    [...backendResistances, ...pivots.filter((item) => item.kind === "resistance")],
    "resistance",
    current,
  )
    .sort((a, b) => a.price - b.price)
    .map((item) => ({
      label: "压力",
      price: item.price,
      kind: "resistance",
      note: `近一年局部高点确认，最近触及 ${item.date}`,
    }))
    .slice(0, 1);

  return [...supports, ...resistances];
}

function clusterPriceLevels(
  levels: Array<{ price: number; kind: "support" | "resistance"; date: string }>,
  kind: "support" | "resistance",
  current: number,
) {
  const sorted = [...levels].sort((a, b) => a.price - b.price);
  const clusters: Array<{ prices: number[]; dates: string[] }> = [];
  const tolerance = Math.max(current * 0.008, 0.03);

  for (const level of sorted) {
    const cluster = clusters.find((item) => {
      const avg = item.prices.reduce((sum, price) => sum + price, 0) / item.prices.length;
      return Math.abs(avg - level.price) <= tolerance;
    });

    if (cluster) {
      cluster.prices.push(level.price);
      cluster.dates.push(level.date);
    } else {
      clusters.push({ prices: [level.price], dates: [level.date] });
    }
  }

  return clusters
    .map((cluster) => {
      const price =
        cluster.prices.reduce((sum, item) => sum + item, 0) / Math.max(cluster.prices.length, 1);
      const date = cluster.dates[cluster.dates.length - 1] ?? "";
      const distance = Math.abs(price - current);
      return {
        price: Number(price.toFixed(3)),
        kind,
        date,
        touches: cluster.prices.length,
        distance,
      };
    })
    .sort((a, b) => b.touches - a.touches || a.distance - b.distance);
}

function TooltipRow({ y, label, value }: { y: number; label: string; value: number }) {
  return (
    <g>
      <text x="14" y={y} fill="#b8aa98" className="text-[11px]">
        {label}
      </text>
      <text x="176" y={y} textAnchor="end" fill="#fffdfa" className="text-[11px] font-bold">
        {value.toFixed(2)}
      </text>
    </g>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-2.5 w-2.5 rounded-full", className)} />
      {label}
    </span>
  );
}

function LegendLine({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-0.5 w-5 rounded-full", className)} />
      {label}
    </span>
  );
}
