"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Clock3, Loader2, Plus, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StockAutocomplete } from "@/components/portfolio/StockAutocomplete";
import { parsePortfolio, type StockInfo } from "@/lib/portfolio-api";
import { listDiagnosisTasks } from "@/lib/diagnosis-api";
import { buildRecentStocks, type RecentStock } from "@/lib/recent-stocks";

const MAX = 10;

export default function BatchStocksPage() {
  const router = useRouter();
  const [items, setItems] = useState<(StockInfo | null)[]>([null, null, null]);
  const [loading, setLoading] = useState(false);
  const [recentLoading, setRecentLoading] = useState(true);
  const [recentStocks, setRecentStocks] = useState<RecentStock[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refreshRecentStocks() {
    setRecentLoading(true);
    try {
      const tasks = await listDiagnosisTasks();
      setRecentStocks(buildRecentStocks(tasks, MAX));
    } catch {
      setRecentStocks([]);
    } finally {
      setRecentLoading(false);
    }
  }

  useEffect(() => {
    refreshRecentStocks();
  }, []);

  function setAt(i: number, s: StockInfo | null) {
    setItems((prev) => {
      const next = [...prev];
      next[i] = s;
      return next;
    });
  }

  function add() {
    if (items.length >= MAX) return;
    setItems((prev) => [...prev, null]);
  }

  function remove(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  const validStocks = items.filter((s): s is StockInfo => s !== null);
  const codes = Array.from(new Set(validStocks.map((s) => s.code)));
  const canSubmit = codes.length >= 2 && codes.length === validStocks.length;

  function compactItems(next: StockInfo[]) {
    return next.length < 3
      ? [...next, ...Array.from<null>({ length: 3 - next.length }).fill(null)]
      : next;
  }

  function addRecentStock(stock: StockInfo) {
    setError(null);
    setItems((prev) => {
      if (prev.some((item) => item?.code === stock.code)) return prev;
      const filled = prev.filter((item): item is StockInfo => item !== null);
      if (filled.length >= MAX) return prev;
      return compactItems([...filled, stock]);
    });
  }

  function useRecentStocks() {
    const next: StockInfo[] = [];
    const seen = new Set<string>();
    for (const stock of recentStocks) {
      if (seen.has(stock.code)) continue;
      seen.add(stock.code);
      next.push({
        code: stock.code,
        name: stock.name,
        exchange: stock.exchange,
      });
      if (next.length >= MAX) break;
    }
    if (next.length > 0) {
      setItems(compactItems(next));
      setError(null);
    }
  }

  async function handleNext() {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const r = await parsePortfolio({ mode: "batch", codes });
      router.push(`/debate/select?pid=${r.portfolio_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="container mx-auto max-w-3xl py-12">
      <h1 className="mb-2 text-3xl font-bold text-ink-800">批量分析</h1>
      <p className="mb-6 text-sm text-ink-500">
        最多 {MAX} 只候选股，多大师横向对比分析。
      </p>

      <div className="space-y-4 rounded-lg border border-ink-200 bg-white/60 p-6">
        <div className="grid grid-cols-12 items-center gap-2 px-1 pb-2 text-xs text-ink-500">
          <span className="col-span-1"></span>
          <span className="col-span-10">候选股票</span>
          <span className="col-span-1"></span>
        </div>
        {items.map((s, i) => (
          <div key={i} className="grid grid-cols-12 items-center gap-2">
            <span className="col-span-1 text-center text-sm text-ink-400">
              {i + 1}.
            </span>
            <StockAutocomplete
              className="col-span-10"
              value={s}
              onChange={(v) => setAt(i, v)}
            />
            <Button
              className="col-span-1"
              variant="ghost"
              size="sm"
              onClick={() => remove(i)}
              disabled={items.length <= 2}
              aria-label="移除"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}

        <div className="flex items-center justify-between pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={add}
            disabled={items.length >= MAX}
          >
            <Plus className="h-4 w-4" />
            添加候选股 ({items.length}/{MAX})
          </Button>

          <span className="text-xs text-ink-500">
            已填 {validStocks.length} 只
            {codes.length !== validStocks.length && "（含重复）"}
          </span>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <Button
          onClick={handleNext}
          disabled={!canSubmit || loading}
          size="lg"
          className="w-full"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowRight className="h-4 w-4" />
          )}
          下一步：选大师 {canSubmit && `(${codes.length} 只)`}
        </Button>
      </div>

      <section className="mt-6 rounded-lg border border-ink-200 bg-[#fffdf8] p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-black text-ink-900">最近分析</h2>
            <p className="mt-1 text-xs text-ink-400">点击股票加入候选列表，可继续调整后进入选大师</p>
          </div>
          <button
            type="button"
            onClick={refreshRecentStocks}
            className="rounded-lg p-2 text-ink-400 transition hover:bg-ink-100 hover:text-scarlet-600"
            aria-label="刷新最近分析"
          >
            {recentLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4" />
            )}
          </button>
        </div>

        {recentStocks.length > 0 ? (
          <div>
            <div className="flex flex-wrap gap-2">
              {recentStocks.map((stock) => {
                const selected = codes.includes(stock.code);
                return (
                  <button
                    key={`${stock.diagnosis_id}-${stock.code}`}
                    type="button"
                    onClick={() => addRecentStock(stock)}
                    disabled={selected || validStocks.length >= MAX}
                    className={`rounded-lg border px-3 py-2 text-left text-xs transition ${
                      selected
                        ? "border-scarlet-200 bg-[#fff1ed] text-scarlet-700"
                        : "border-ink-100 bg-white/70 text-ink-600 hover:border-[#e6b8b1] hover:bg-white hover:text-ink-900"
                    } disabled:cursor-default`}
                    title={selected ? "已在候选列表中" : "加入候选列表"}
                  >
                    <span className="block font-bold">{stock.name}</span>
                    <span className="mt-0.5 block font-mono text-[11px] text-ink-400">{stock.code}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <span className="text-xs text-ink-400">最多取最近 {MAX} 只不重复股票</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={useRecentStocks}
                disabled={recentStocks.length < 2}
              >
                使用最近股票
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-ink-200 bg-white/50 p-6 text-center">
            <Clock3 className="mx-auto h-5 w-5 text-ink-300" />
            <p className="mt-2 text-sm font-semibold text-ink-600">暂无最近分析</p>
            <p className="mt-1 text-xs leading-5 text-ink-400">
              完成单股、批量或持仓诊断后，这里会展示最近分析过的股票。
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
