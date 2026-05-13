"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StockAutocomplete } from "@/components/portfolio/StockAutocomplete";
import { parsePortfolio, type StockInfo } from "@/lib/portfolio-api";

const MAX = 10;

export default function BatchStocksPage() {
  const router = useRouter();
  const [items, setItems] = useState<(StockInfo | null)[]>([null, null, null]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <main className="container mx-auto max-w-2xl py-12">
      <h1 className="mb-2 text-3xl font-bold text-ink-800">批量分析</h1>
      <p className="mb-8 text-sm text-ink-500">
        最多 {MAX} 只候选股，多大师横向对比分析。
      </p>

      <div className="space-y-4 rounded-lg border border-ink-200 bg-white/60 p-6">
        {items.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-6 text-center text-sm text-ink-400">
              {i + 1}.
            </span>
            <StockAutocomplete
              className="flex-1"
              value={s}
              onChange={(v) => setAt(i, v)}
            />
            <Button
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
    </main>
  );
}
