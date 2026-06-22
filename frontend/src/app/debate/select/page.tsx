"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, ArrowRight, AlertCircle, CheckCircle2, ChevronDown, MousePointerClick } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MasterSummary } from "@/lib/api";
import { startDiagnosis } from "@/lib/diagnosis-api";
import { STATIC_MASTERS } from "@/lib/masters-static";
import { useLLMStore } from "@/stores/llm";
import { cn } from "@/lib/cn";

const SCHOOL_LABEL: Record<string, string> = {
  huaren: "华人五绝",
  western: "欧美七雄",
  technical: "技术四杰",
};

function SelectInner() {
  const params = useSearchParams();
  const pid = params.get("pid");
  const router = useRouter();

  const [masters, setMasters] = useState<MasterSummary[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const llmStore = useLLMStore();
  useEffect(() => {
    llmStore.hydrate();
    setMasters(STATIC_MASTERS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 找一个已启用的 provider 作为默认（W5a 简化：用第一个启用的，
  // W6 加完整路由策略后再细化）
  const enabledProvider = Object.entries(llmStore.config.providers).find(
    ([, p]) => p?.enabled && p.apiKey && p.defaultModel,
  );

  function toggle(slug: string) {
    setSelected((prev) =>
      prev.includes(slug)
        ? prev.filter((x) => x !== slug)
        : prev.length >= 3
          ? prev
          : [...prev, slug],
    );
  }

  async function handleStart() {
    if (!pid) {
      setError("缺少 portfolio_id");
      return;
    }
    if (selected.length < 2) {
      setError("至少选 2 位大师");
      return;
    }
    if (!enabledProvider) {
      setError("还没配置可用的 LLM Provider，先去【设置】配置");
      return;
    }
    const [providerId, cfg] = enabledProvider;
    setStarting(true);
    setError(null);
    try {
      const res = await startDiagnosis({
        portfolio_id: pid,
        masters: selected,
        llm: {
          provider: providerId,
          api_key: cfg!.apiKey,
          model: cfg!.defaultModel,
          base_url: cfg!.baseUrl || undefined,
        },
      });
      router.push(`/debate/${res.diagnosis_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }

  // 按 school 分组
  const grouped = (() => {
    if (!masters) return [];
    const map = new Map<string, MasterSummary[]>();
    for (const m of masters) {
      const k = m.school;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(m);
    }
    return Array.from(map.entries());
  })();

  return (
    <main className="container mx-auto max-w-5xl py-10">
      <h1 className="mb-2 text-3xl font-bold text-ink-800">选大师</h1>
      <p className="mb-2 text-sm text-ink-500">
        勾选 2-3 位大师组队，进入群雄论股流程。
        当前选中 <span className="font-medium text-scarlet-700">{selected.length}</span> / 3
      </p>
      {pid && (
        <p className="mb-6 text-xs text-ink-400">
          持仓 ID：<span className="font-mono">{pid}</span>
        </p>
      )}

      <div className="mb-5 flex items-start gap-3 rounded-md border border-scarlet-200 bg-scarlet-50/70 p-3 text-sm text-scarlet-800">
        <MousePointerClick className="mt-0.5 h-4 w-4 flex-none" />
        <div>
          <p className="font-semibold">请先选中下方大师卡片</p>
          <p className="text-xs leading-5 text-scarlet-700">
            选择 2-3 位后，底部“开始论股”按钮会变为可用；不确定选谁时，可展开“标签介绍”查看擅长行业和判断风格。
          </p>
        </div>
      </div>

      {!enabledProvider && llmStore.hydrated && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50/60 p-3 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
          <div>
            <p className="font-medium">还没配置 LLM Provider</p>
            <p className="text-xs">
              <Link href="/settings/llm" className="underline">
                先去模型配置页
              </Link>{" "}
              填入 DeepSeek 或讯飞 MaaS 的 API Key 并测试通过。
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!masters && !error && (
        <div className="text-center text-sm text-ink-400">加载大师中…</div>
      )}

      {grouped.map(([school, list]) => (
        <section key={school} className="mb-6">
          <h2 className="mb-3 border-l-4 border-scarlet-600 pl-3 text-base font-semibold text-ink-700">
            {SCHOOL_LABEL[school] ?? school}
          </h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {list.map((m) => {
              const checked = selected.includes(m.slug);
              const disabled = !checked && selected.length >= 3;
              const opened = expanded === m.slug;
              return (
                <div
                  key={m.slug}
                  className={cn(
                    "rounded-md border bg-white/80 p-3 text-left transition",
                    checked
                      ? "border-scarlet-500 ring-2 ring-scarlet-200"
                      : "border-ink-200 hover:border-scarlet-300",
                    disabled && "opacity-40",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggle(m.slug)}
                    disabled={disabled}
                    className="flex w-full items-center gap-3 text-left disabled:cursor-not-allowed"
                    aria-pressed={checked}
                  >
                    {m.avatar_url && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={m.avatar_url}
                        alt={m.name}
                        className="h-12 w-12 flex-none rounded-full object-cover"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink-800">
                        {m.name}
                      </p>
                      <p className="mt-0.5 text-xs leading-5 text-ink-500">{m.tagline}</p>
                    </div>
                    {checked && <CheckCircle2 className="h-5 w-5 flex-none text-scarlet-600" />}
                  </button>

                  <div className="mt-3 border-t border-ink-100 pt-2">
                    <button
                      type="button"
                      onClick={() => setExpanded(opened ? null : m.slug)}
                      className="flex w-full items-center justify-between text-xs font-medium text-ink-500 hover:text-scarlet-700"
                      aria-expanded={opened}
                    >
                      标签介绍
                      <ChevronDown
                        className={cn("h-4 w-4 transition", opened && "rotate-180")}
                      />
                    </button>
                    {opened && (
                      <div className="mt-2 space-y-2">
                        <div className="flex flex-wrap gap-1.5">
                          {(m.tags ?? []).map((tag) => (
                            <span
                              key={tag}
                              className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] font-medium text-ink-600"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                        <p className="text-xs leading-5 text-ink-500">{m.bio}</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <div className="sticky bottom-4 mt-8 flex justify-end">
        <Button
          onClick={handleStart}
          disabled={selected.length < 2 || !enabledProvider || starting}
          size="lg"
        >
          {starting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowRight className="h-4 w-4" />
          )}
          开始论股 {selected.length >= 2 && `(${selected.length} 位大师)`}
        </Button>
      </div>
    </main>
  );
}

export default function SelectPage() {
  return (
    <Suspense fallback={<div className="container mx-auto py-12">加载中…</div>}>
      <SelectInner />
    </Suspense>
  );
}
