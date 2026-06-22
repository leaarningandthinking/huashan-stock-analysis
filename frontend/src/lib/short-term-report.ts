import type { ShortTermAnalyzeResponse, ShortTermCandle, ShortTermLevel } from "@/lib/short-term-api";

type ReportChartLevel = ShortTermLevel & {
  low?: number;
  high?: number;
  touches?: number;
};

export function buildShortTermReportTitle(report: ShortTermAnalyzeResponse) {
  return `华山论股·${report.name}短线分析报告`;
}

export function safeReportFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "");
}

export function buildShortTermMarkdown(report: ShortTermAnalyzeResponse, title = buildShortTermReportTitle(report)) {
  const snapshot = report.snapshot;
  const lines = [
    `# ${title}`,
    "",
    `- 代码：${report.code}`,
    `- 名称：${report.name}`,
    `- 数据日期：${snapshot.date}`,
    `- 收盘价：${snapshot.close.toFixed(2)}`,
    "",
    "## 核心指标",
    "",
    `- 趋势：${snapshot.trend}`,
    `- 动量：${snapshot.momentum}`,
    `- 量能：${snapshot.volume_state}`,
    `- MA5/10/20/60/120：${formatMaybe(snapshot.ma5)} / ${formatMaybe(snapshot.ma10)} / ${formatMaybe(snapshot.ma20)} / ${formatMaybe(snapshot.ma60)} / ${formatMaybe(snapshot.ma120)}`,
    `- RSI14：${formatMaybe(snapshot.rsi14)}`,
    `- MACD DIF/DEA/柱体：${formatMaybe(snapshot.macd_diff)} / ${formatMaybe(snapshot.macd_dea)} / ${formatMaybe(snapshot.macd_hist)}`,
    `- 量比：${formatMaybe(snapshot.volume_ratio_vs_20d)}`,
    "",
    "## 关键价位",
    "",
    ...report.levels.map((level) => `- ${level.label}：${level.price.toFixed(2)}，${level.note}`),
    "",
    "## 原文分析",
    "",
    report.ai_analysis,
    "",
    "## 风险提示",
    "",
    report.risk_notice,
    "",
  ];

  return lines.join("\n");
}

export function buildShortTermPrintHtml(report: ShortTermAnalyzeResponse, title = buildShortTermReportTitle(report)) {
  const snapshot = report.snapshot;
  const chartSvg = buildShortTermChartSvg(report.chart.slice(-250), report.levels, snapshot.close);
  const metrics = [
    ["收盘价", snapshot.close.toFixed(2)],
    ["趋势", snapshot.trend],
    ["动量", snapshot.momentum],
    ["量能", snapshot.volume_state],
    ["RSI14", formatMaybe(snapshot.rsi14)],
    ["量比", formatMaybe(snapshot.volume_ratio_vs_20d)],
  ];

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; color: #1f1a17; background: #f8f4ec; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.72; }
    .page { max-width: 920px; margin: 0 auto; padding: 36px; }
    .hero { border-radius: 14px; background: #1f1a17; color: #fffdf8; padding: 28px; }
    .eyebrow { color: #d8c8b0; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    h1 { font-size: 28px; margin: 8px 0 10px; line-height: 1.25; }
    .meta { color: #d8c8b0; font-size: 12px; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 18px 0; }
    .card { border: 1px solid #eadfce; border-radius: 10px; background: #fffdf8; padding: 14px; }
    .label { color: #8f7f6a; font-size: 12px; font-weight: 700; }
    .value { margin-top: 4px; color: #1f1a17; font-size: 16px; font-weight: 800; }
    section { margin-top: 18px; border: 1px solid #eadfce; border-radius: 14px; background: #fffdf8; padding: 22px; }
    h2 { font-size: 18px; margin: 0 0 12px; padding-bottom: 8px; border-bottom: 1px solid #eadfce; }
    p { white-space: pre-wrap; margin: 8px 0; }
    ul { margin: 8px 0 0 20px; padding: 0; }
    li { margin: 5px 0; }
    .chart-wrap { overflow: hidden; border: 1px solid #eadfce; border-radius: 12px; background: #fffaf1; padding: 12px; }
    .chart-wrap svg { display: block; width: 100%; height: auto; }
    .legend { display: flex; gap: 14px; flex-wrap: wrap; margin: 0 0 10px; color: #8f7f6a; font-size: 12px; font-weight: 700; }
    .legend span { display: inline-flex; align-items: center; gap: 6px; }
    .dot { width: 9px; height: 9px; border-radius: 999px; display: inline-block; }
    .line { width: 20px; height: 2px; border-radius: 999px; display: inline-block; }
    .notice { color: #8f7f6a; font-size: 12px; }
    @media print { body { background: #fff; } .page { padding: 0; } .hero, section, .card { break-inside: avoid; } }
  </style>
</head>
<body>
  <main class="page">
    <header class="hero">
      <div class="eyebrow">Huashan Short-Term Technical Research</div>
      <h1>${escapeHtml(title)}</h1>
      <div class="meta">代码：${escapeHtml(report.code)} · 数据日期：${escapeHtml(snapshot.date)} · 任务 ID：${escapeHtml(report.task_id ?? "-")}</div>
    </header>
    <div class="grid">
      ${metrics.map(([label, value]) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`).join("")}
    </div>
    <section>
      <h2>关键价位</h2>
      <div class="legend">
        <span><i class="dot" style="background:#d97706"></i>支撑区</span>
        <span><i class="dot" style="background:#059669"></i>压力区</span>
        <span><i class="line" style="background:#0284c7"></i>MA20</span>
        <span><i class="line" style="background:#6366f1"></i>MA60</span>
      </div>
      <div class="chart-wrap">${chartSvg}</div>
      <ul>${report.levels.map((level) => `<li><strong>${escapeHtml(level.label)}</strong>：${level.price.toFixed(2)}，${escapeHtml(level.note)}</li>`).join("")}</ul>
    </section>
    <section>
      <h2>原文分析</h2>
      <p>${escapeHtml(report.ai_analysis)}</p>
    </section>
    <section>
      <h2>风险提示</h2>
      <p class="notice">${escapeHtml(report.risk_notice)}</p>
    </section>
  </main>
</body>
</html>`;
}

function buildShortTermChartSvg(candles: ShortTermCandle[], levels: ShortTermLevel[], current: number) {
  if (candles.length === 0) {
    return `<div style="color:#8f7f6a;font-size:12px;">暂无 K 线数据</div>`;
  }

  const chartLevels = deriveReportChartLevels(candles, current, levels);
  const width = 960;
  const height = 420;
  const pad = { top: 24, right: 72, bottom: 38, left: 54 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const prices = [
    ...candles.flatMap((c) => [c.high, c.low, c.ma20, c.ma60].filter((v): v is number => v != null)),
    ...chartLevels.flatMap((level) => [level.low ?? level.price, level.high ?? level.price]),
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
  const dateTicks = [0, Math.floor(candles.length / 2), candles.length - 1].filter(
    (idx, pos, arr) => idx >= 0 && candles[idx] && arr.indexOf(idx) === pos,
  );

  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="近一年K线图" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="printChartBg" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="#fffdfa" />
        <stop offset="100%" stop-color="#fbf7ef" />
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#printChartBg)" />
    <rect x="${pad.left}" y="${pad.top}" width="${plotW}" height="${plotH}" fill="#ffffff" opacity="0.68" rx="10" />
    ${grid
      .map(
        (price) => `
          <line x1="${pad.left}" x2="${width - pad.right}" y1="${y(price)}" y2="${y(price)}" stroke="#eee6d8" stroke-dasharray="3 7" />
          <text x="${width - pad.right + 10}" y="${y(price) + 4}" fill="#8f7f6a" font-size="11">${price.toFixed(2)}</text>`,
      )
      .join("")}
    ${chartLevels.map((level) => buildLevelSvg(level, y, pad.left, width - pad.right, plotW)).join("")}
    ${ma20Path ? `<path d="${ma20Path}" fill="none" stroke="#0284c7" stroke-width="1.7" opacity="0.94" />` : ""}
    ${ma60Path ? `<path d="${ma60Path}" fill="none" stroke="#6366f1" stroke-width="1.7" opacity="0.86" />` : ""}
    ${candles
      .map((candle, index) => {
        const cx = x(index);
        const up = candle.close >= candle.open;
        const color = up ? "#dc2626" : "#059669";
        const wickColor = up ? "#b91c1c" : "#047857";
        const openY = y(candle.open);
        const closeY = y(candle.close);
        const bodyY = Math.min(openY, closeY);
        const bodyH = Math.max(Math.abs(openY - closeY), 1.5);
        return `<line x1="${cx}" x2="${cx}" y1="${y(candle.high)}" y2="${y(candle.low)}" stroke="${wickColor}" stroke-width="1" opacity="0.72" />
          <rect x="${cx - candleW / 2}" y="${bodyY}" width="${candleW}" height="${bodyH}" fill="${up ? color : "#fffdfa"}" stroke="${color}" stroke-width="1" rx="0.8" opacity="0.88" />`;
      })
      .join("")}
    ${dateTicks
      .map((idx) => {
        const anchor = idx === 0 ? "start" : idx === candles.length - 1 ? "end" : "middle";
        return `<text x="${x(idx)}" y="${height - 12}" text-anchor="${anchor}" fill="#8f7f6a" font-size="11">${escapeHtml(candles[idx].date.slice(5))}</text>`;
      })
      .join("")}
  </svg>`;
}

function buildLevelSvg(
  level: ReportChartLevel,
  y: (price: number) => number,
  left: number,
  right: number,
  plotW: number,
) {
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
  return `${bandHeight > 2 ? `<rect x="${left}" y="${bandTop}" width="${plotW}" height="${bandHeight}" fill="${color}" opacity="0.12" />` : ""}
    <line x1="${left}" x2="${right}" y1="${lineY}" y2="${lineY}" stroke="${color}" stroke-width="2" stroke-dasharray="7 6" opacity="0.92" />
    <rect x="${left + 8}" y="${lineY - 20}" width="${bandHeight > 2 ? 144 : 112}" height="18" rx="5" fill="#fffdfa" stroke="${color}" opacity="0.95" />
    <text x="${left + 14}" y="${lineY - 7}" fill="${color}" font-size="11" font-weight="700">${escapeHtml(label)}</text>`;
}

function deriveReportChartLevels(
  candles: ShortTermCandle[],
  current: number,
  sourceLevels: ShortTermLevel[],
): ReportChartLevel[] {
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

  const supports = clusterReportPriceLevels(
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
  const resistances = clusterReportPriceLevels(
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

function clusterReportPriceLevels(
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

export function downloadShortTermMarkdown(report: ShortTermAnalyzeResponse) {
  const title = buildShortTermReportTitle(report);
  const markdown = buildShortTermMarkdown(report, title);
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeReportFileName(title)}-${(report.task_id ?? report.code).slice(0, 8)}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadShortTermPdf(report: ShortTermAnalyzeResponse) {
  const title = buildShortTermReportTitle(report);
  const win = window.open("", "_blank");
  if (!win) {
    throw new Error("浏览器拦截了打印窗口，请允许弹窗后重试");
  }
  win.document.write(buildShortTermPrintHtml(report, title));
  win.document.close();
  win.onload = () => {
    win.focus();
    win.print();
  };
}

function formatMaybe(value: number | null | undefined) {
  return value == null ? "无数据" : value.toFixed(2);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
