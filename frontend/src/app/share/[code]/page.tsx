"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { DiagnosisReportView } from "@/components/report/DiagnosisReportView";
import { getSharedReport, type ShareReportResponse } from "@/lib/diagnosis-api";

function buildReportTitle(data: ShareReportResponse | null): string {
  const stocks = data?.stocks ?? [];
  if (stocks.length === 1 && stocks[0].name) {
    return `华山论股·${stocks[0].name}股票报告`;
  }
  if (data?.mode === "batch" && stocks.length > 0) {
    return `华山论股·${stocks.length}只股票报告`;
  }
  if (data?.mode === "portfolio") {
    return "华山论股·持仓组合报告";
  }
  return "华山论股·股票报告";
}

export default function SharedReportPage() {
  const params = useParams<{ code: string }>();
  const code = params.code;
  const [data, setData] = useState<ShareReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    getSharedReport(code)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [code]);

  const reportTitle = buildReportTitle(data);

  return (
    <main className="container mx-auto max-w-5xl py-10">
      <p className="mb-2 text-sm">
        <Link href="/" className="text-ink-500 hover:text-scarlet-600">
          ← 首页
        </Link>
      </p>
      <h1 className="mb-2 text-3xl font-bold text-ink-800">{reportTitle}</h1>
      <p className="mb-6 text-xs text-ink-400">
        分享码：<span className="font-mono">{code}</span>
        {data && <> · 访问 {data.visit_count} 次</>}
      </p>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!data && !error && (
        <div className="flex items-center gap-2 text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载报告中…
        </div>
      )}

      {data?.report && (
        <DiagnosisReportView
          diagnosisId={data.diagnosis_id}
          report={data.report as any}
          readonly
          reportTitle={reportTitle}
        />
      )}
    </main>
  );
}
