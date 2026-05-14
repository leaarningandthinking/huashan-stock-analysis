"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Download,
  Loader2,
  PlayCircle,
  RefreshCw,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getDiagnosisReport,
  listDiagnosisTasks,
  type DiagnosisTaskSummary,
} from "@/lib/diagnosis-api";
import {
  buildMarkdown,
  buildPrintHtml,
  type ReportShape,
} from "@/components/report/DiagnosisReportView";

const STATUS_META: Record<
  DiagnosisTaskSummary["status"],
  { label: string; className: string; icon: typeof Clock3 }
> = {
  pending: { label: "排队中", className: "bg-amber-50 text-amber-700", icon: Clock3 },
  running: { label: "进行中", className: "bg-blue-50 text-blue-700", icon: PlayCircle },
  done: { label: "已完成", className: "bg-emerald-50 text-emerald-700", icon: CheckCircle2 },
  failed: { label: "失败", className: "bg-red-50 text-red-700", icon: XCircle },
};

const MODE_LABEL: Record<string, string> = {
  single: "论股 Agent",
  batch: "批量分析",
  portfolio: "持仓诊断",
};

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function buildTitle(task: DiagnosisTaskSummary) {
  if (task.stocks.length === 0) return MODE_LABEL[task.mode ?? ""] ?? "分析任务";
  if (task.stocks.length === 1) {
    const stock = task.stocks[0];
    return `${stock.name} ${stock.code}`;
  }
  return `${task.stocks[0].name}等 ${task.stocks.length} 只标的`;
}

function buildReportTitle(task: DiagnosisTaskSummary) {
  if (task.stocks.length === 1 && task.stocks[0].name) {
    return `华山论股·${task.stocks[0].name}股票报告`;
  }
  if (task.mode === "batch" && task.stocks.length > 0) {
    return `华山论股·${task.stocks.length}只股票报告`;
  }
  if (task.mode === "portfolio") {
    return "华山论股·持仓组合报告";
  }
  return "华山论股·股票报告";
}

function safeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "");
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<DiagnosisTaskSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadTask, setDownloadTask] = useState<DiagnosisTaskSummary | null>(null);
  const [downloading, setDownloading] = useState<"pdf" | "md" | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setTasks(await listDiagnosisTasks());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const sorted = useMemo(
    () =>
      [...tasks].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    [tasks],
  );

  async function fetchCompletedReport(task: DiagnosisTaskSummary) {
    const data = await getDiagnosisReport(task.diagnosis_id);
    if (data.status !== "done" || !data.report) {
      throw new Error("报告尚未生成完成，暂时不能下载");
    }
    return data.report as ReportShape;
  }

  async function downloadMarkdownReport(task: DiagnosisTaskSummary) {
    setDownloading("md");
    setDownloadError(null);
    try {
      const report = await fetchCompletedReport(task);
      const title = buildReportTitle(task);
      const markdown = buildMarkdown(task.diagnosis_id, report, title);
      const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeFileName(title)}-${task.diagnosis_id.slice(0, 8)}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setDownloadTask(null);
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(null);
    }
  }

  async function downloadPdfReport(task: DiagnosisTaskSummary) {
    setDownloading("pdf");
    setDownloadError(null);
    try {
      const report = await fetchCompletedReport(task);
      const title = buildReportTitle(task);
      const html = buildPrintHtml(task.diagnosis_id, report, title);
      const win = window.open("", "_blank");
      if (!win) {
        throw new Error("浏览器拦截了打印窗口，请允许弹窗后重试");
      }
      win.document.write(html);
      win.document.close();
      win.onload = () => {
        win.focus();
        win.print();
      };
      setDownloadTask(null);
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 lg:px-10 lg:py-12">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-4xl font-black tracking-tight text-ink-900">分析任务</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-500">
            汇总正在进行中和历史上的所有论股分析任务，按创建时间倒序排列。
          </p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          刷新
        </Button>
      </header>

      {error && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          加载分析任务失败，当前展示兜底空状态：{error}
        </div>
      )}

      {loading && !error && (
        <div className="flex items-center gap-2 rounded-xl border border-ink-200 bg-white/70 p-6 text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在加载任务…
        </div>
      )}

      {!loading && sorted.length === 0 && (
        <div className="rounded-2xl border border-dashed border-ink-300 bg-white/50 p-10 text-center">
          <h2 className="text-xl font-bold text-ink-800">
            {error ? "暂无可展示的分析任务" : "还没有分析任务"}
          </h2>
          <p className="mt-2 text-sm text-ink-500">
            {error ? "任务接口暂时不可用，可以先发起新的论股分析。" : "先发起一次论股 Agent、批量分析或持仓诊断。"}
          </p>
          <Link
            href="/debate/single"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-scarlet-600 px-5 py-3 text-sm font-bold text-white hover:bg-scarlet-700"
          >
            开始论股
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}

      {sorted.length > 0 && (
        <div className="space-y-3">
          {sorted.map((task) => {
            const status = STATUS_META[task.status];
            const StatusIcon = status.icon;
            const href =
              task.status === "done"
                ? `/debate/${task.diagnosis_id}/report`
                : `/debate/${task.diagnosis_id}`;
            return (
              <article
                key={task.diagnosis_id}
                className="group grid gap-4 rounded-2xl border border-ink-200 bg-[#fffdf8] p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-[#e6b8b1] hover:shadow-md md:grid-cols-[1fr_auto]"
              >
                <Link href={href} className="min-w-0">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${status.className}`}>
                      <StatusIcon className="h-3.5 w-3.5" />
                      {status.label}
                    </span>
                    <span className="rounded-full bg-ink-50 px-3 py-1 text-xs font-bold text-ink-500">
                      {MODE_LABEL[task.mode ?? ""] ?? "分析"}
                    </span>
                    <span className="text-xs text-ink-400">{formatTime(task.created_at)}</span>
                  </div>
                  <h2 className="truncate text-xl font-black text-ink-900">{buildTitle(task)}</h2>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-ink-500">
                    {task.stocks.slice(0, 6).map((stock) => (
                      <span key={`${task.diagnosis_id}-${stock.code}`} className="rounded bg-ink-50 px-2 py-1">
                        {stock.name} {stock.code}
                      </span>
                    ))}
                    {task.stocks.length > 6 && <span>+{task.stocks.length - 6}</span>}
                  </div>
                  {task.error && <p className="mt-3 text-xs text-red-700">{task.error}</p>}
                </Link>
                <div className="flex items-center justify-between gap-4 md:justify-end">
                  <div className="text-xs text-ink-400">
                    {task.masters.length > 0 ? `${task.masters.length} 位大师` : "未选择大师"}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={task.status !== "done"}
                    onClick={() => {
                      setDownloadTask(task);
                      setDownloadError(null);
                    }}
                    title={task.status === "done" ? "下载报告" : "报告完成后可下载"}
                  >
                    <Download className="h-4 w-4" />
                    下载
                  </Button>
                  <Link href={href} aria-label="查看报告">
                    <ArrowRight className="h-5 w-5 text-ink-300 transition group-hover:translate-x-0.5 group-hover:text-scarlet-600" />
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {downloadTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/30 px-4">
          <div className="w-full max-w-sm rounded-lg border border-ink-200 bg-[#fffdf8] p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-ink-900">下载分析报告</h2>
                <p className="mt-1 truncate text-xs text-ink-400">{buildTitle(downloadTask)}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDownloadTask(null);
                  setDownloadError(null);
                }}
                className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-800"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-3">
              <Button
                onClick={() => downloadPdfReport(downloadTask)}
                disabled={Boolean(downloading)}
              >
                {downloading === "pdf" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                PDF 格式
              </Button>
              <Button
                onClick={() => downloadMarkdownReport(downloadTask)}
                variant="outline"
                disabled={Boolean(downloading)}
              >
                {downloading === "md" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Markdown 格式
              </Button>
            </div>
            <p className="mt-3 text-xs leading-5 text-ink-500">
              PDF 会打开浏览器打印窗口，选择“保存为 PDF”。建议关闭“页眉和页脚”。
            </p>
            {downloadError && (
              <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-700">
                {downloadError}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
