"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Clock3, Loader2, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  ManualHoldingRow,
  type ManualRow,
} from "@/components/portfolio/ManualHoldingRow";
import { HoldingsTable } from "@/components/portfolio/HoldingsTable";
import { ImageOcrTab } from "@/components/portfolio/ImageOcrTab";
import {
  listRecentPortfolios,
  parsePortfolio,
  type ManualHolding,
  type ParseResponse,
  type RecentPortfolio,
} from "@/lib/portfolio-api";

type Tab = "manual" | "text" | "image";

const EMPTY_ROW: ManualRow = {
  stock: null,
  shares: "",
  cost: "",
  value: "",
};

export default function PortfolioEntryPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("manual");
  const [rows, setRows] = useState<ManualRow[]>([
    { ...EMPTY_ROW },
    { ...EMPTY_ROW },
    { ...EMPTY_ROW },
  ]);
  const [text, setText] = useState("");
  const [ocrText, setOcrText] = useState("");
  const [recentPortfolio, setRecentPortfolio] = useState<RecentPortfolio | null>(null);
  const [parsing, setParsing] = useState(false);
  const [recentLoading, setRecentLoading] = useState(true);
  const [parseResult, setParseResult] = useState<ParseResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refreshRecentPortfolio() {
    setRecentLoading(true);
    try {
      const recent = await listRecentPortfolios(1);
      setRecentPortfolio(recent[0] ?? null);
    } catch {
      setRecentPortfolio(null);
    } finally {
      setRecentLoading(false);
    }
  }

  useEffect(() => {
    refreshRecentPortfolio();
  }, []);

  function setRowAt(i: number, patch: Partial<ManualRow>) {
    setRows((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      return next;
    });
  }

  async function handlePreview() {
    setError(null);
    setParsing(true);
    try {
      let res: ParseResponse;
      if (tab === "manual") {
        const manual: ManualHolding[] = rows
          .filter((r) => r.stock)
          .map((r) => ({
            code: r.stock!.code,
            shares: r.shares ? Number(r.shares) : null,
            cost: r.cost ? Number(r.cost) : null,
            value: r.value ? Number(r.value) : null,
          }));
        if (manual.length === 0) {
          throw new Error("至少填一只股票");
        }
        res = await parsePortfolio({ mode: "portfolio", manual });
      } else if (tab === "text") {
        if (!text.trim()) {
          throw new Error("请粘贴持仓文本");
        }
        res = await parsePortfolio({ mode: "portfolio", text });
      } else if (tab === "image") {
        if (!ocrText.trim()) {
          throw new Error("请先上传图片并完成 OCR 识别");
        }
        res = await parsePortfolio({ mode: "portfolio", text: ocrText });
      } else {
        throw new Error(`unknown tab: ${tab}`);
      }
      setParseResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setParsing(false);
    }
  }

  function handleNext() {
    if (parseResult) {
      router.push(`/debate/select?pid=${parseResult.portfolio_id}`);
    }
  }

  function useRecentPortfolio() {
    if (!recentPortfolio) return;
    setTab("manual");
    setRows(
      recentPortfolio.holdings.map((holding) => ({
        stock: {
          code: holding.code,
          name: holding.name,
          exchange: holding.exchange as "sh" | "sz" | "bj" | "hk" | "us",
        },
        shares: holding.shares == null ? "" : String(holding.shares),
        cost: holding.cost == null ? "" : String(holding.cost),
        value: holding.value == null ? "" : String(holding.value),
      })),
    );
    setParseResult(null);
    setError(null);
  }

  return (
    <main className="container mx-auto max-w-3xl py-12">
      <h1 className="mb-2 text-3xl font-bold text-ink-800">持仓诊断</h1>
      <p className="mb-6 text-sm text-ink-500">
        三种录入方式任选其一，下方先预览解析结果，确认无误再进入选大师。
      </p>

      <div className="mb-4 flex gap-1 border-b border-ink-200">
        <TabButton active={tab === "manual"} onClick={() => setTab("manual")}>
          手动表格
        </TabButton>
        <TabButton active={tab === "text"} onClick={() => setTab("text")}>
          粘贴文本
        </TabButton>
        <TabButton active={tab === "image"} onClick={() => setTab("image")}>
          上传截图
        </TabButton>
      </div>

      {tab === "manual" && (
        <div className="space-y-3 rounded-lg border border-ink-200 bg-white/60 p-6">
          <div className="grid grid-cols-12 items-center gap-2 px-1 pb-2 text-xs text-ink-500">
            <span className="col-span-1"></span>
            <span className="col-span-4">股票</span>
            <span className="col-span-2">持仓数</span>
            <span className="col-span-2">成本价</span>
            <span className="col-span-2">市值</span>
            <span className="col-span-1"></span>
          </div>
          {rows.map((r, i) => (
            <ManualHoldingRow
              key={i}
              index={i}
              row={r}
              onChange={(p) => setRowAt(i, p)}
              onRemove={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
              canRemove={rows.length > 1}
            />
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRows((prev) => [...prev, { ...EMPTY_ROW }])}
          >
            <Plus className="h-4 w-4" />
            添加一行
          </Button>
          <p className="text-xs text-ink-400">
            持仓数 / 成本 / 市值 选填——不填也能跑诊断，但盈亏指标会缺失。
          </p>
        </div>
      )}

      {tab === "text" && (
        <div className="space-y-3 rounded-lg border border-ink-200 bg-white/60 p-6">
          <textarea
            className="h-64 w-full resize-none rounded-md border border-ink-300 bg-white/70 p-3 font-mono text-sm focus-visible:border-scarlet-500 focus-visible:outline-none"
            placeholder={`每行一只股票，至少包含 6 位代码，例：
600519 贵州茅台 100 1500 180000
000858,五粮液,200,150,35000
600036 招商银行 1000 35 38000`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
          />
          <p className="text-xs text-ink-400">
            字段顺序：代码 名字 持仓数 成本价 市值。空格、tab、逗号都行。
          </p>
        </div>
      )}

      {tab === "image" && <ImageOcrTab onTextExtracted={setOcrText} />}

      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-6 flex gap-3">
        <Button onClick={handlePreview} disabled={parsing} size="lg">
          {parsing && <Loader2 className="h-4 w-4 animate-spin" />}
          解析预览
        </Button>
        {parseResult && (
          <Button onClick={handleNext} variant="outline" size="lg">
            <ArrowRight className="h-4 w-4" />
            下一步：选大师
          </Button>
        )}
      </div>

      <section className="mt-6 rounded-lg border border-ink-200 bg-[#fffdf8] p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-black text-ink-900">最近持仓</h2>
            <p className="mt-1 text-xs text-ink-400">点击后回填到手动表格，可继续修改后解析</p>
          </div>
          <button
            type="button"
            onClick={refreshRecentPortfolio}
            className="rounded-lg p-2 text-ink-400 transition hover:bg-ink-100 hover:text-scarlet-600"
            aria-label="刷新最近持仓"
          >
            {recentLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4" />
            )}
          </button>
        </div>

        {recentPortfolio ? (
          <button
            type="button"
            onClick={useRecentPortfolio}
            className="w-full rounded-lg border border-ink-100 bg-white/70 p-4 text-left transition hover:border-[#e6b8b1] hover:bg-white"
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-bold text-ink-800">
                {recentPortfolio.holdings[0]?.name ?? "持仓组合"}
                {recentPortfolio.holdings.length > 1 ? `等 ${recentPortfolio.holdings.length} 只` : ""}
              </span>
              <span className="text-xs text-ink-400">
                {new Date(recentPortfolio.created_at).toLocaleString("zh-CN")}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {recentPortfolio.holdings.slice(0, 8).map((holding) => (
                <span key={holding.code} className="rounded bg-ink-50 px-2 py-1 text-xs text-ink-600">
                  {holding.name} {holding.code}
                </span>
              ))}
              {recentPortfolio.holdings.length > 8 && (
                <span className="rounded bg-ink-50 px-2 py-1 text-xs text-ink-400">
                  +{recentPortfolio.holdings.length - 8}
                </span>
              )}
            </div>
            <div className="mt-3 text-xs font-semibold text-scarlet-600">使用这组持仓</div>
          </button>
        ) : (
          <div className="rounded-lg border border-dashed border-ink-200 bg-white/50 p-6 text-center">
            <Clock3 className="mx-auto h-5 w-5 text-ink-300" />
            <p className="mt-2 text-sm font-semibold text-ink-600">暂无最近持仓</p>
            <p className="mt-1 text-xs leading-5 text-ink-400">
              完成一次持仓解析后，这里会展示最近一组持仓。
            </p>
          </div>
        )}
      </section>

      {parseResult && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold text-ink-700">
            解析结果（{parseResult.holdings.length} 条）
          </h2>
          <HoldingsTable
            holdings={parseResult.holdings}
            overview={parseResult.overview}
            warnings={parseResult.warnings}
          />
        </section>
      )}
    </main>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "border-b-2 px-4 py-2 text-sm font-medium transition",
        active
          ? "border-scarlet-600 text-scarlet-700"
          : "border-transparent text-ink-500 hover:text-ink-800",
      )}
    >
      {children}
    </button>
  );
}
