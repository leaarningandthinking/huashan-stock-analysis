"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Clock3, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StockAutocomplete } from "@/components/portfolio/StockAutocomplete";
import { listDiagnosisTasks } from "@/lib/diagnosis-api";
import { parsePortfolio, type StockInfo } from "@/lib/portfolio-api";
import { buildRecentStocks, type RecentStock } from "@/lib/recent-stocks";

export default function SingleStockPage() {
  const router = useRouter();
  const [stock, setStock] = useState<StockInfo | null>(null);
  const [recentStocks, setRecentStocks] = useState<RecentStock[]>([]);
  const [loading, setLoading] = useState(false);
  const [recentLoading, setRecentLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refreshRecent() {
    setRecentLoading(true);
    try {
      const tasks = await listDiagnosisTasks();
      setRecentStocks(buildRecentStocks(tasks, 10));
    } catch {
      setRecentStocks([]);
    } finally {
      setRecentLoading(false);
    }
  }

  useEffect(() => {
    refreshRecent();
  }, []);

  async function handleNext() {
    if (!stock) return;
    setLoading(true);
    setError(null);
    try {
      const r = await parsePortfolio({
        mode: "single",
        codes: [stock.code],
      });
      // TODO（W6）：跳到选大师页 /debate/select?pid=...
      // 现在先 alert 看下能否回包
      router.push(`/debate/select?pid=${r.portfolio_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-8 lg:px-10 lg:py-12">
      <div className="mb-8 max-w-3xl">
        <h1 className="mb-2 text-4xl font-black tracking-tight text-ink-900">论股 Agent</h1>
        <p className="text-sm leading-6 text-ink-500">
          选一只股票，由 4 位分析师并行起报告，再由 2-3 位大师形成圆桌观点，最后输出风控审核与投资经理决策。
        </p>
      </div>

      <div className="space-y-6">
        <section className="space-y-6 rounded-lg border border-ink-200 bg-white/70 p-6 shadow-sm">
          <div>
            <label className="mb-2 block text-sm font-semibold text-ink-700">
              股票代码或名字
            </label>
            <StockAutocomplete value={stock} onChange={setStock} />
          </div>

          {stock && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-3 text-sm text-emerald-800">
              已选中：<span className="font-mono">{stock.code}</span>
              {" · "}
              <span className="font-medium">{stock.name}</span>
              {" · "}
              <span className="text-xs text-emerald-700">
                {stock.exchange.toUpperCase()}
              </span>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <Button onClick={handleNext} disabled={!stock || loading} size="lg">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="h-4 w-4" />
            )}
            下一步：选大师
          </Button>
        </section>

        <section className="rounded-lg border border-ink-200 bg-[#fffdf8] p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-black text-ink-900">最近股票</h2>
              <p className="mt-1 text-xs text-ink-400">点击后自动填入左侧输入框</p>
            </div>
            <button
              type="button"
              onClick={refreshRecent}
              className="rounded-lg p-2 text-ink-400 transition hover:bg-ink-100 hover:text-scarlet-600"
              aria-label="刷新最近股票"
            >
              {recentLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
            </button>
          </div>

          {recentStocks.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {recentStocks.map((item) => {
                const selected = stock?.code === item.code;
                return (
                  <button
                    key={`${item.diagnosis_id}-${item.code}`}
                    type="button"
                    onClick={() =>
                      setStock({
                        code: item.code,
                        name: item.name,
                        exchange: item.exchange,
                      })
                    }
                    className={`group flex items-center justify-between gap-3 rounded-lg border px-3 py-3 text-left transition ${
                      selected
                        ? "border-scarlet-300 bg-[#fff1ed] shadow-sm"
                        : "border-ink-100 bg-white/70 hover:border-[#e6b8b1] hover:bg-white"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-ink-800">
                        {item.name}
                      </span>
                      <span className="mt-1 flex items-center gap-2 text-xs text-ink-400">
                        <span className="font-mono">{item.code}</span>
                        <span>{item.exchange.toUpperCase()}</span>
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
              <p className="mt-1 text-xs leading-5 text-ink-400">
                完成一次论股后，这里会展示近期分析过的标的。
              </p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
