"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { DiagnosisReportView } from "@/components/report/DiagnosisReportView";
import { getDiagnosisReport, type DiagnosisReportResponse } from "@/lib/diagnosis-api";

function buildReportTitle(data: DiagnosisReportResponse | null): string {
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

export default function DiagnosisReportPage() {
  const params = useParams<{ sid: string }>();
  const sid = params.sid;
  const [data, setData] = useState<DiagnosisReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sid) return;
    getDiagnosisReport(sid)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [sid]);

  const reportTitle = buildReportTitle(data);

  return (
    <main className="container mx-auto max-w-5xl py-10">
      <p className="mb-2 text-sm">
        <Link href={`/debate/${sid}`} className="text-ink-500 hover:text-scarlet-600">
          ← 诊断过程
        </Link>
      </p>
      <h1 className="mb-6 text-3xl font-bold text-ink-800">{reportTitle}</h1>

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

      {data && data.status !== "done" && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          报告尚未完成，当前状态：{data.status}
        </div>
      )}

      {data?.report && (
        <DiagnosisReportView
          diagnosisId={data.diagnosis_id}
          report={data.report as any}
          reportTitle={reportTitle}
        />
      )}
    </main>
  );
}
