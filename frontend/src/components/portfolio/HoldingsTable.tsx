"use client";

import { useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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

/** 可编辑草稿行。stock 是「名称或代码」文本，保存时优先用 code（未改动时），否则用 stock 重新匹配。 */
interface DraftRow {
  code: string;
  stock: string;
  shares: string;
  cost: string;
  value: string;
}

/** 保存时传回的行：stock 用于后端按代码/名称重新解析。 */
export interface EditedHolding {
  stock: string;
  shares: string;
  cost: string;
  value: string;
}

function toDraft(h: HoldingItem): DraftRow {
  return {
    code: h.code ?? "",
    stock: h.name || h.code || "",
    shares: h.shares == null ? "" : String(h.shares),
    cost: h.cost == null ? "" : String(h.cost),
    value: h.value == null ? "" : String(h.value),
  };
}

interface Props {
  holdings: HoldingItem[];
  overview: PortfolioOverview;
  warnings?: string[];
  /** 提供后显示「编辑」按钮；保存时把编辑后的行传回，由上层重新解析并回写。 */
  onSave?: (rows: EditedHolding[]) => Promise<void> | void;
  saving?: boolean;
}

export function HoldingsTable({ holdings, overview, warnings = [], onSave, saving = false }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DraftRow[]>(() => holdings.map(toDraft));

  // 解析结果变化（含保存后回写）时重置草稿并退出编辑态。
  useEffect(() => {
    setDraft(holdings.map(toDraft));
    setEditing(false);
  }, [holdings]);

  function patchRow(i: number, patch: Partial<DraftRow>) {
    setDraft((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeRow(i: number) {
    setDraft((prev) => prev.filter((_, idx) => idx !== i));
  }
  function addRow() {
    setDraft((prev) => [...prev, { code: "", stock: "", shares: "", cost: "", value: "" }]);
  }
  async function save() {
    if (!onSave) return;
    const rows: EditedHolding[] = draft
      .map((r) => ({
        // 名称未改动时用代码（最准）；改过则清掉了 code，用文本按名称重配。
        stock: (r.code || r.stock).trim(),
        shares: r.shares.trim(),
        cost: r.cost.trim(),
        value: r.value.trim(),
      }))
      .filter((r) => r.stock);
    await onSave(rows);
  }

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

      {onSave && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-ink-500">
            {editing ? "修正识别错误的名称或数字后保存，会重新核对代码并计算概览。" : "识别有误？可手动修正后保存。"}
          </p>
          {editing ? (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setDraft(holdings.map(toDraft)); setEditing(false); }} disabled={saving}>
                <X className="h-4 w-4" />
                取消
              </Button>
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                保存修改
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" />
              编辑
            </Button>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-ink-200 bg-white/70">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-xs text-ink-500">
            <tr>
              {!editing && <th className="px-3 py-2 text-left">代码</th>}
              <th className="px-3 py-2 text-left">{editing ? "名称 / 代码" : "名称"}</th>
              <th className="px-3 py-2 text-right">持仓</th>
              <th className="px-3 py-2 text-right">成本</th>
              <th className="px-3 py-2 text-right">市值</th>
              {!editing && <th className="px-3 py-2 text-right">盈亏</th>}
              {editing && <th className="px-3 py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {editing
              ? draft.map((r, i) => (
                  <tr key={i} className="border-t border-ink-100">
                    <td className="px-2 py-1.5">
                      <input
                        value={r.stock}
                        onChange={(e) => patchRow(i, { stock: e.target.value, code: "" })}
                        placeholder="名称或代码"
                        className="w-full rounded border border-ink-200 bg-white px-2 py-1 text-sm outline-none focus:border-scarlet-500"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <NumInput value={r.shares} onChange={(v) => patchRow(i, { shares: v })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <NumInput value={r.cost} onChange={(v) => patchRow(i, { cost: v })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <NumInput value={r.value} onChange={(v) => patchRow(i, { value: v })} />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => removeRow(i)}
                        className="rounded p-1 text-ink-400 hover:bg-red-50 hover:text-red-600"
                        aria-label="删除该行"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))
              : holdings.map((h, i) => (
                  <tr
                    key={i}
                    className={"border-t border-ink-100 " + (h.valid ? "" : "bg-red-50/50 text-red-700")}
                  >
                    <td className="px-3 py-2 font-mono text-xs">{h.code}</td>
                    <td className="px-3 py-2">{h.name || "—"}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(h.shares)}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(h.cost)}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(h.value)}</td>
                    <td className={"px-3 py-2 text-right font-medium " + pnlColor(h.pnl)}>{fmtPct(h.pnl)}</td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <Button variant="ghost" size="sm" onClick={addRow} disabled={saving}>
          <Plus className="h-4 w-4" />
          添加一行
        </Button>
      )}

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

function NumInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      value={value}
      inputMode="decimal"
      onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
      className="w-full rounded border border-ink-200 bg-white px-2 py-1 text-right text-sm outline-none focus:border-scarlet-500"
    />
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
