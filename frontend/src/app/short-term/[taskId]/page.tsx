"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { getShortTermReport, type ShortTermAnalyzeResponse } from "@/lib/short-term-api";
import { ShortTermAnalysisResult } from "@/components/short-term/ShortTermAnalysisResult";

export default function ShortTermReportPage({ params }: { params: { taskId: string } }) {
  const [report, setReport] = useState<ShortTermAnalyzeResponse | null>(null);
  const [status, setStatus] = useState<string>("pending");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function load() {
      try {
        const data = await getShortTermReport(params.taskId);
        if (cancelled) return;
        setStatus(data.status);
        setReport(data.report);
        setError(data.error ?? null);
        if (data.status === "pending" || data.status === "running") {
          timer = setTimeout(load, 1800);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }

    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [params.taskId]);

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 lg:px-10 lg:py-12">
      <Link href="/tasks" className="mb-6 inline-flex items-center gap-2 text-sm text-ink-500 hover:text-scarlet-600">
        <ArrowLeft className="h-4 w-4" />
        返回分析任务
      </Link>

      {!report && !error && (
        <div className="rounded-lg border border-dashed border-ink-200 bg-white/45 px-6 py-14 text-center">
          <Loader2 className="mx-auto h-7 w-7 animate-spin text-scarlet-600" />
          <h1 className="mt-4 text-base font-black text-ink-800">
            {status === "pending" || status === "running" ? "短线分析正在进行中" : "正在加载短线分析报告"}
          </h1>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-ink-500">
            行情、K 线和分析结论会在任务完成后自动展示。你可以切换页面，任务会继续保留在分析任务里。
          </p>
        </div>
      )}

      {error && !report && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          {error || `报告尚未可用，当前状态：${status}`}
        </div>
      )}

      {report && <ShortTermAnalysisResult result={report} />}
    </main>
  );
}
