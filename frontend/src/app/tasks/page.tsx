"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Loader2,
  PlayCircle,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  listDiagnosisTasks,
  type DiagnosisTaskSummary,
} from "@/lib/diagnosis-api";

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

export default function TasksPage() {
  const [tasks, setTasks] = useState<DiagnosisTaskSummary[]>([]);
  const [loading, setLoading] = useState(true);
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
              <Link
                key={task.diagnosis_id}
                href={href}
                className="group grid gap-4 rounded-2xl border border-ink-200 bg-[#fffdf8] p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-[#e6b8b1] hover:shadow-md md:grid-cols-[1fr_auto]"
              >
                <div className="min-w-0">
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
                </div>
                <div className="flex items-center justify-between gap-4 md:justify-end">
                  <div className="text-xs text-ink-400">
                    {task.masters.length > 0 ? `${task.masters.length} 位大师` : "未选择大师"}
                  </div>
                  <ArrowRight className="h-5 w-5 text-ink-300 transition group-hover:translate-x-0.5 group-hover:text-scarlet-600" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
