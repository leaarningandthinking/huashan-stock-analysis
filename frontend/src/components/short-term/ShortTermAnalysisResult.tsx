"use client";

import { useMemo, useState } from "react";
import type { ComponentType } from "react";
import { BarChart3, Copy, Download, FileText, Gauge, Loader2, Share2, ShieldAlert, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createShortTermShareLink,
  type ShortTermAnalyzeResponse,
  type ShortTermCandle,
  type ShortTermLevel,
} from "@/lib/short-term-api";
import { downloadShortTermMarkdown, downloadShortTermPdf } from "@/lib/short-term-report";
import { cn } from "@/lib/cn";

type ChartLevel = ShortTermLevel & {
  low?: number;
  high?: number;
  touches?: number;
};

export function ShortTermAnalysisResult({ result }: { result: ShortTermAnalyzeResponse }) {
  const snapshot = result.snapshot;
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  function runDownload(type: "pdf" | "md") {
    setError(null);
    try {
      if (type === "pdf") downloadShortTermPdf(result);
      else downloadShortTermMarkdown(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleShare() {
    if (!result.task_id) return;
    setSharing(true);
    setError(null);
    try {
      const res = await createShortTermShareLink(result.task_id);
      const absolute = `${window.location.origin}${res.url}`;
      setShareUrl(absolute);
      await navigator.clipboard?.writeText(absolute);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
              <Button type="button" variant="outline" size="sm" onClick={handleShare} disabled={!result.task_id || sharing}>
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
        {error && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric icon={TrendingUp} label="趋势" value={snapshot.trend} />
          <Metric icon={Gauge} label="动量" value={snapshot.momentum} />
          <Metric icon={BarChart3} label="量能" value={snapshot.volume_state} />
          <Metric icon={ShieldAlert} label="RSI14" value={snapshot.rsi14 == null ? "无数据" : snapshot.rsi14.toFixed(1)} />
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
  const chartLevels = useMemo(() => deriveChartLevels(chart, current, levels), [chart, current, levels]);

  return (
    <div className="rounded-lg border border-ink-200 bg-white/70 p-6 shadow-sm">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-ink-900">关键价位</h3>
          <p className="mt-1 text-xs text-ink-500">近一年 K 线仅突出核心支撑区、压力区，并叠加 MA20/MA60 趋势线。</p>
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
                  : level.kind === "support"
                    ? "border-amber-200 bg-amber-50/50"
                    : "border-emerald-200 bg-emerald-50/50",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-sm font-black text-ink-800">{level.label}</span>
                <span className="font-mono text-sm font-black text-ink-900">{level.price.toFixed(2)}</span>
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
  levels: ChartLevel[];
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
    ...levels.flatMap((x) => [x.low ?? x.price, x.high ?? x.price]),
    current,
  ];
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const rawRange = Math.max(maxPrice - minPrice, 0.01);
  const minYPrice = minPrice - rawRange * 0.08;
  const maxYPrice = maxPrice + rawRange * 0.08;
  const range = Math.max(maxYPrice - minYPrice, 0.01);
  const y = (price: number) => pad.top + ((maxYPrice - price) / range) * plotH;
  const x = (index: number) => pad.left + (candles.length <= 1 ? 0 : (index / (candles.length - 1)) * plotW);
  const candleW = Math.max(2.2, Math.min(6.5, (plotW / Math.max(candles.length, 1)) * 0.58));
  const grid = Array.from({ length: 5 }, (_, i) => minYPrice + (range * i) / 4);
  const ma20Path = buildLinePath(candles.map((c, i) => [x(i), c.ma20 == null ? null : y(c.ma20)]));
  const ma60Path = buildLinePath(candles.map((c, i) => [x(i), c.ma60 == null ? null : y(c.ma60)]));
  const hovered = hoverIndex == null ? null : candles[hoverIndex] ?? null;
  const hoverX = hoverIndex == null ? null : x(hoverIndex);
  const hoverY = hovered ? y(hovered.close) : null;
  const tooltipX = hoverX == null ? 0 : hoverX > width * 0.68 ? hoverX - 206 : hoverX + 14;
  const tooltipY = hoverY == null ? 0 : Math.max(16, Math.min(hoverY - 72, height - 142));
  const dateTicks = [0, Math.floor(candles.length / 2), candles.length - 1].filter(
    (idx, pos, arr) => idx >= 0 && candles[idx] && arr.indexOf(idx) === pos,
  );

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
          <linearGradient id="sharedChartBg" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#fffdfa" />
            <stop offset="100%" stopColor="#fbf7ef" />
          </linearGradient>
        </defs>
        <rect width={width} height={height} fill="url(#sharedChartBg)" />
        <rect x={pad.left} y={pad.top} width={plotW} height={plotH} fill="#ffffff" opacity="0.62" rx="10" />
        {grid.map((price) => (
          <g key={price}>
            <line x1={pad.left} x2={width - pad.right} y1={y(price)} y2={y(price)} stroke="#eee6d8" strokeDasharray="3 7" />
            <text x={width - pad.right + 10} y={y(price) + 4} className="fill-ink-400 text-[11px]">
              {price.toFixed(2)}
            </text>
          </g>
        ))}
        {levels.map((level) => {
          const low = level.low ?? level.price;
          const high = level.high ?? level.price;
          const bandTop = y(high);
          const bandHeight = Math.max(y(low) - y(high), 0);
          const lineY = y(level.price);
          const color = level.kind === "support" ? "#d97706" : "#059669";
          const label =
            bandHeight > 2
              ? `${level.label} ${low.toFixed(2)}-${high.toFixed(2)}`
              : `${level.label} ${level.price.toFixed(2)}`;
          return (
            <g key={`${level.label}-${level.price}-${level.kind}-line`}>
              {bandHeight > 2 && (
                <rect
                  x={pad.left}
                  y={bandTop}
                  width={plotW}
                  height={bandHeight}
                  fill={color}
                  opacity="0.12"
                />
              )}
              <line x1={pad.left} x2={width - pad.right} y1={lineY} y2={lineY} stroke={color} strokeWidth="2" strokeDasharray="7 6" opacity={0.92} />
              <rect x={pad.left + 8} y={lineY - 20} width={bandHeight > 2 ? 144 : 112} height={18} rx={5} fill="#fffdfa" stroke={color} opacity="0.95" />
              <text x={pad.left + 14} y={lineY - 7} fill={color} className="text-[11px] font-bold">
                {label}
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
              <line x1={cx} x2={cx} y1={y(candle.high)} y2={y(candle.low)} stroke={wickColor} strokeWidth="1" opacity="0.72" />
              <rect x={cx - candleW / 2} y={bodyY} width={candleW} height={bodyH} fill={up ? color : "#fffdfa"} stroke={color} strokeWidth="1" rx="0.8" opacity={hoverIndex === index ? 1 : 0.88} />
            </g>
          );
        })}
        {hovered && hoverX != null && hoverY != null && (
          <g>
            <line x1={hoverX} x2={hoverX} y1={pad.top} y2={height - pad.bottom} stroke="#6b6257" strokeDasharray="4 5" opacity="0.45" />
            <line x1={pad.left} x2={width - pad.right} y1={hoverY} y2={hoverY} stroke="#6b6257" strokeDasharray="4 5" opacity="0.35" />
            <circle cx={hoverX} cy={hoverY} r="4" fill="#111827" opacity="0.7" />
            <g transform={`translate(${tooltipX}, ${tooltipY})`}>
              <rect width="190" height="126" rx="10" fill="#1f1a17" opacity="0.92" />
              <text x="14" y="24" fill="#fffdfa" className="text-[12px] font-bold">{hovered.date}</text>
              <TooltipRow y={46} label="开盘" value={hovered.open} />
              <TooltipRow y={64} label="最高" value={hovered.high} />
              <TooltipRow y={82} label="最低" value={hovered.low} />
              <TooltipRow y={100} label="收盘" value={hovered.close} />
              <text x="14" y="118" fill="#b8aa98" className="text-[10px]">滑动查看每日价格</text>
            </g>
          </g>
        )}
        {dateTicks.map((idx) => (
          <text key={idx} x={x(idx)} y={height - 12} textAnchor={idx === 0 ? "start" : idx === candles.length - 1 ? "end" : "middle"} className="fill-ink-400 text-[11px]">
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
): ChartLevel[] {
  const recent = candles.slice(-160);
  const pivots: Array<{ price: number; kind: "support" | "resistance"; date: string }> = [];
  const tolerance = Math.max(current * 0.008, 0.03);

  for (let index = 3; index < recent.length - 3; index += 1) {
    const window = recent.slice(index - 3, index + 4);
    const candle = recent[index];
    if (candle.low === Math.min(...window.map((item) => item.low)) && candle.low < current) {
      pivots.push({ price: candle.low, kind: "support", date: candle.date });
    }
    if (candle.high === Math.max(...window.map((item) => item.high)) && candle.high >= current - tolerance) {
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
      label: item.high > item.low ? "支撑区" : "支撑",
      price: item.price,
      low: item.low,
      high: item.high,
      touches: item.touches,
      kind: "support" as const,
      note: `多个相近价位合并，最近触及 ${item.date}`,
    }))
    .slice(0, 1);
  const resistances = clusterPriceLevels(
    [...backendResistances, ...pivots.filter((item) => item.kind === "resistance")],
    "resistance",
    current,
  )
    .sort((a, b) => a.price - b.price)
    .map((item) => ({
      label: item.high > item.low ? "压力区" : "压力",
      price: item.price,
      low: item.low,
      high: item.high,
      touches: item.touches,
      kind: "resistance" as const,
      note: `多个相近价位合并，最近触及 ${item.date}`,
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
      const price = cluster.prices.reduce((sum, item) => sum + item, 0) / Math.max(cluster.prices.length, 1);
      const low = Math.min(...cluster.prices);
      const high = Math.max(...cluster.prices);
      return {
        price: Number(price.toFixed(3)),
        low: Number(low.toFixed(3)),
        high: Number(high.toFixed(3)),
        kind,
        date: cluster.dates[cluster.dates.length - 1] ?? "",
        touches: cluster.prices.length,
        distance: Math.abs(price - current),
      };
    })
    .sort((a, b) => b.touches - a.touches || a.distance - b.distance);
}

function TooltipRow({ y, label, value }: { y: number; label: string; value: number }) {
  return (
    <g>
      <text x="14" y={y} fill="#b8aa98" className="text-[11px]">{label}</text>
      <text x="176" y={y} textAnchor="end" fill="#fffdfa" className="text-[11px] font-bold">{value.toFixed(2)}</text>
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
