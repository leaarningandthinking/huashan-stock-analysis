"use client";

import type { HoldingItem, PortfolioOverview } from "@/lib/portfolio-api";

function fmtNum(v: number | null, digits = 2): string {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function fmtPct(v: number | null): string {
  if (v === null || v === undefined) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function pnlColor(v: number | null): string {
  if (v === null || v === undefined) return "text-ink-500";
  if (v > 0) return "text-red-700";
  if (v < 0) return "text-emerald-700";
  return "text-ink-500";
}

interface Props {
  holdings: HoldingItem[];
  overview: PortfolioOverview;
  warnings?: string[];
}

export function HoldingsTable({ holdings, overview, warnings = [] }: Props) {
  return (
    <div className="space-y-4">
      {warnings.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-800">
          <p className="font-medium">解析警告：</p>
          <ul className="mt-1 list-disc pl-5">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-ink-200 bg-white/70">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-xs text-ink-500">
            <tr>
              <th className="px-3 py-2 text-left">代码</th>
              <th className="px-3 py-2 text-left">名称</th>
              <th className="px-3 py-2 text-right">持仓</th>
              <th className="px-3 py-2 text-right">成本</th>
              <th className="px-3 py-2 text-right">市值</th>
              <th className="px-3 py-2 text-right">盈亏</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h, i) => (
              <tr
                key={i}
                className={
                  "border-t border-ink-100 " +
                  (h.valid ? "" : "bg-red-50/50 text-red-700")
                }
              >
                <td className="px-3 py-2 font-mono text-xs">{h.code}</td>
                <td className="px-3 py-2">{h.name || "—"}</td>
                <td className="px-3 py-2 text-right">{fmtNum(h.shares)}</td>
                <td className="px-3 py-2 text-right">{fmtNum(h.cost)}</td>
                <td className="px-3 py-2 text-right">{fmtNum(h.value)}</td>
                <td className={"px-3 py-2 text-right font-medium " + pnlColor(h.pnl)}>
                  {fmtPct(h.pnl)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="持仓数" value={overview.total_count} />
        <Stat label="总市值" value={fmtNum(overview.total_value)} />
        <Stat label="前 3 集中度" value={fmtPct(overview.concentration_top3)} />
        <Stat
          label="整体盈亏"
          value={fmtPct(overview.overall_pnl)}
          highlight={
            overview.overall_pnl !== null && overview.overall_pnl !== undefined
              ? overview.overall_pnl > 0
                ? "up"
                : overview.overall_pnl < 0
                  ? "down"
                  : "flat"
              : "flat"
          }
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight = "flat",
}: {
  label: string;
  value: string | number;
  highlight?: "up" | "down" | "flat";
}) {
  const color =
    highlight === "up"
      ? "text-red-700"
      : highlight === "down"
        ? "text-emerald-700"
        : "text-ink-800";
  return (
    <div className="rounded-md border border-ink-200 bg-white/70 p-3">
      <div className="text-xs text-ink-500">{label}</div>
      <div className={"mt-1 text-lg font-semibold " + color}>{value}</div>
    </div>
  );
}
