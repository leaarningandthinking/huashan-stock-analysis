"use client";

import { useEffect, useState } from "react";
import { Download, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSharedShortTermReport, type ShortTermAnalyzeResponse } from "@/lib/short-term-api";
import {
  buildShortTermReportTitle,
  downloadShortTermMarkdown,
  downloadShortTermPdf,
} from "@/lib/short-term-report";

export default function SharedShortTermPage({ params }: { params: { code: string } }) {
  const [report, setReport] = useState<ShortTermAnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSharedShortTermReport(params.code)
      .then((data) => {
        setReport(data.report);
        setError(data.error ?? null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [params.code]);

  if (!report && !error) {
    return (
      <main className="mx-auto w-full max-w-5xl px-5 py-12">
        <div className="flex items-center gap-2 rounded-lg border border-ink-200 bg-white/70 p-6 text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在加载分享报告…
        </div>
      </main>
    );
  }

  if (error || !report) {
    return (
      <main className="mx-auto w-full max-w-5xl px-5 py-12">
        <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          {error || "分享报告不可用"}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 lg:px-10 lg:py-12">
      <section className="overflow-hidden rounded-lg border border-ink-200 bg-white shadow-sm">
        <div className="border-b border-ink-100 bg-ink-900 px-5 py-5 text-white">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-200">
                Huashan Short-Term Technical Research
              </p>
              <h1 className="text-2xl font-semibold">{buildShortTermReportTitle(report)}</h1>
              <p className="mt-2 text-xs text-ink-200">
                分享码：<span className="font-mono">{params.code}</span>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => downloadShortTermPdf(report)} variant="outline" className="border-white/25 bg-white/10 text-white hover:bg-white/20">
                <Download className="h-4 w-4" />
                下载报告
              </Button>
              <Button onClick={() => downloadShortTermMarkdown(report)} variant="outline" className="border-white/25 bg-white/10 text-white hover:bg-white/20">
                <FileText className="h-4 w-4" />
                Markdown
              </Button>
            </div>
          </div>
        </div>
      </section>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="收盘价" value={report.snapshot.close.toFixed(2)} />
        <Metric label="趋势" value={report.snapshot.trend} />
        <Metric label="动量" value={report.snapshot.momentum} />
        <Metric label="量能" value={report.snapshot.volume_state} />
      </div>

      <section className="mt-6 rounded-lg border border-ink-200 bg-white/70 p-6 shadow-sm">
        <h2 className="text-lg font-black text-ink-900">关键价位</h2>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {report.levels.map((level) => (
            <div key={`${level.label}-${level.price}-${level.note}`} className="rounded-md border border-ink-100 bg-[#fffdf8] p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-black text-ink-800">{level.label}</span>
                <span className="font-mono text-sm font-black text-ink-900">{level.price.toFixed(2)}</span>
              </div>
              <p className="mt-1 text-xs leading-5 text-ink-500">{level.note}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-ink-200 bg-white/70 p-6 shadow-sm">
        <h2 className="text-lg font-black text-ink-900">原文内容</h2>
        <div className="mt-4 whitespace-pre-wrap text-sm leading-7 text-ink-700">{report.ai_analysis}</div>
      </section>

      <p className="mt-6 text-xs leading-5 text-ink-400">{report.risk_notice}</p>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-ink-100 bg-[#fffdf8] px-4 py-4">
      <div className="text-xs font-semibold text-ink-400">{label}</div>
      <div className="mt-2 text-base font-black text-ink-800">{value}</div>
    </div>
  );
}
