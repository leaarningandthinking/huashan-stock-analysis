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
  Share2,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getDiagnosisReport,
  createShareLink,
  listDiagnosisTasks,
  type DiagnosisTaskSummary,
} from "@/lib/diagnosis-api";
import {
  createShortTermShareLink,
  getShortTermReport,
  listShortTermTasks,
  type ShortTermAnalyzeResponse,
  type ShortTermTaskSummary,
} from "@/lib/short-term-api";
import {
  buildMarkdown,
  buildPrintHtml,
  type ReportShape,
} from "@/components/report/DiagnosisReportView";
import {
  buildShortTermMarkdown,
  buildShortTermPrintHtml,
} from "@/lib/short-term-report";

const STATUS_META: Record<
  "pending" | "running" | "done" | "failed",
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
  short_term: "短线分析",
};

type TaskRow =
  | { type: "diagnosis"; data: DiagnosisTaskSummary }
  | { type: "short_term"; data: ShortTermTaskSummary };

function normalizeStatus(status: string): "pending" | "running" | "done" | "failed" {
  return status === "pending" || status === "running" || status === "done" || status === "failed"
    ? status
    : "failed";
}

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

function buildTitle(task: TaskRow) {
  if (task.type === "short_term") {
    return `${task.data.name} ${task.data.code}`;
  }
  const data = task.data;
  if (data.stocks.length === 0) return MODE_LABEL[data.mode ?? ""] ?? "分析任务";
  if (data.stocks.length === 1) {
    const stock = data.stocks[0];
    return `${stock.name} ${stock.code}`;
  }
  return `${data.stocks[0].name}等 ${data.stocks.length} 只标的`;
}

function buildReportTitle(task: TaskRow) {
  if (task.type === "short_term") {
    return `华山论股·${task.data.name}短线分析报告`;
  }
  const data = task.data;
  if (data.stocks.length === 1 && data.stocks[0].name) {
    return `华山论股·${data.stocks[0].name}股票报告`;
  }
  if (data.mode === "batch" && data.stocks.length > 0) {
    return `华山论股·${data.stocks.length}只股票报告`;
  }
  if (data.mode === "portfolio") {
    return "华山论股·持仓组合报告";
  }
  return "华山论股·股票报告";
}

function taskCreatedAt(task: TaskRow) {
  return task.data.created_at;
}

function taskStatus(task: TaskRow) {
  return normalizeStatus(task.data.status);
}

function taskKey(task: TaskRow) {
  return task.type === "short_term" ? task.data.task_id : task.data.diagnosis_id;
}

function taskHref(task: TaskRow) {
  if (task.type === "short_term") return `/short-term/${task.data.task_id}`;
  return task.data.status === "done"
    ? `/debate/${task.data.diagnosis_id}/report`
    : `/debate/${task.data.diagnosis_id}`;
}

function safeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "");
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadTask, setDownloadTask] = useState<TaskRow | null>(null);
  const [downloading, setDownloading] = useState<"pdf" | "md" | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [sharingKey, setSharingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [diagnosisTasks, shortTermTasks] = await Promise.all([
        listDiagnosisTasks(),
        listShortTermTasks(),
      ]);
      setTasks([
        ...diagnosisTasks.map((data): TaskRow => ({ type: "diagnosis", data })),
        ...shortTermTasks.map((data): TaskRow => ({ type: "short_term", data })),
      ]);
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
        (a, b) => new Date(taskCreatedAt(b)).getTime() - new Date(taskCreatedAt(a)).getTime(),
      ),
    [tasks],
  );

  async function fetchCompletedReport(task: TaskRow) {
    if (task.type === "short_term") {
      const data = await getShortTermReport(task.data.task_id);
      if (data.status !== "done" || !data.report) {
        throw new Error("报告尚未生成完成，暂时不能下载");
      }
      return data.report;
    }
    const data = await getDiagnosisReport(task.data.diagnosis_id);
    if (data.status !== "done" || !data.report) {
      throw new Error("报告尚未生成完成，暂时不能下载");
    }
    return data.report as ReportShape;
  }

  async function downloadMarkdownReport(task: TaskRow) {
    setDownloading("md");
    setDownloadError(null);
    try {
      const report = await fetchCompletedReport(task);
      const title = buildReportTitle(task);
      const markdown =
        task.type === "short_term"
          ? buildShortTermMarkdown(report as ShortTermAnalyzeResponse, title)
          : buildMarkdown(task.data.diagnosis_id, report as ReportShape, title);
      const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeFileName(title)}-${taskKey(task).slice(0, 8)}.md`;
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

  async function downloadPdfReport(task: TaskRow) {
    setDownloading("pdf");
    setDownloadError(null);
    try {
      const report = await fetchCompletedReport(task);
      const title = buildReportTitle(task);
      const html =
        task.type === "short_term"
          ? buildShortTermPrintHtml(report as ShortTermAnalyzeResponse, title)
          : buildPrintHtml(task.data.diagnosis_id, report as ReportShape, title);
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

  async function shareTask(task: TaskRow) {
    const key = `${task.type}-${taskKey(task)}`;
    setSharingKey(key);
    setDownloadError(null);
    try {
      const res =
        task.type === "short_term"
          ? await createShortTermShareLink(task.data.task_id)
          : await createShareLink(task.data.diagnosis_id);
      const absolute = `${window.location.origin}${res.url}`;
      setShareUrl(absolute);
      await navigator.clipboard?.writeText(absolute);
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : String(e));
    } finally {
      setSharingKey(null);
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
            const statusValue = taskStatus(task);
            const status = STATUS_META[statusValue];
            const StatusIcon = status.icon;
            const href = taskHref(task);
            const stocks =
              task.type === "short_term"
                ? [{ code: task.data.code, name: task.data.name }]
                : task.data.stocks;
            const modeLabel =
              task.type === "short_term"
                ? MODE_LABEL.short_term
                : MODE_LABEL[task.data.mode ?? ""] ?? "分析";
            return (
              <article
                key={`${task.type}-${taskKey(task)}`}
                className="group grid gap-4 rounded-2xl border border-ink-200 bg-[#fffdf8] p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-[#e6b8b1] hover:shadow-md md:grid-cols-[1fr_auto]"
              >
                <Link href={href} className="min-w-0">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${status.className}`}>
                      <StatusIcon className="h-3.5 w-3.5" />
                      {status.label}
                    </span>
                    <span className="rounded-full bg-ink-50 px-3 py-1 text-xs font-bold text-ink-500">
                      {modeLabel}
                    </span>
                    <span className="text-xs text-ink-400">{formatTime(taskCreatedAt(task))}</span>
                  </div>
                  <h2 className="truncate text-xl font-black text-ink-900">{buildTitle(task)}</h2>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-ink-500">
                    {stocks.slice(0, 6).map((stock) => (
                      <span key={`${taskKey(task)}-${stock.code}`} className="rounded bg-ink-50 px-2 py-1">
                        {stock.name} {stock.code}
                      </span>
                    ))}
                    {stocks.length > 6 && <span>+{stocks.length - 6}</span>}
                  </div>
                  {task.data.error && <p className="mt-3 text-xs text-red-700">{task.data.error}</p>}
                </Link>
                <div className="flex items-center justify-between gap-4 md:justify-end">
                  <div className="text-xs text-ink-400">
                    {task.type === "short_term"
                      ? "技术规则"
                      : task.data.masters.length > 0
                        ? `${task.data.masters.length} 位大师`
                        : "未选择大师"}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={statusValue !== "done"}
                    onClick={() => {
                      setDownloadTask(task);
                      setDownloadError(null);
                    }}
                    title={statusValue === "done" ? "下载报告" : "报告完成后可下载"}
                  >
                    <Download className="h-4 w-4" />
                    下载
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={statusValue !== "done" || sharingKey === `${task.type}-${taskKey(task)}`}
                    onClick={() => shareTask(task)}
                    title={statusValue === "done" ? "生成分享链接" : "报告完成后可分享"}
                  >
                    {sharingKey === `${task.type}-${taskKey(task)}` ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Share2 className="h-4 w-4" />
                    )}
                    分享
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

      {shareUrl && (
        <div className="fixed inset-x-4 bottom-5 z-50 mx-auto flex max-w-xl items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800 shadow-lg">
          <Share2 className="h-4 w-4 flex-none" />
          <span className="truncate">分享链接已复制：{shareUrl}</span>
          <button
            type="button"
            onClick={() => setShareUrl(null)}
            className="ml-auto rounded p-1 hover:bg-emerald-100"
            aria-label="关闭分享提示"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </main>
  );
}
