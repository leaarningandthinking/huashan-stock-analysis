"use client";

import { useEffect, useRef } from "react";
import { CheckCircle2, Loader2, Circle } from "lucide-react";
import { cn } from "@/lib/cn";

export type AnalystStatus = "pending" | "running" | "done" | "fail";

const ROLE_META: Record<string, { label: string; color: string }> = {
  fundamental: { label: "基本面分析师", color: "border-amber-500" },
  sentiment: { label: "情绪分析师", color: "border-violet-500" },
  news: { label: "新闻分析师", color: "border-sky-500" },
  technical: { label: "技术分析师", color: "border-emerald-500" },
};

interface Props {
  role: string;
  status: AnalystStatus;
  text: string;
  stockCount?: number;
}

export function AnalystCard({ role, status, text, stockCount = 0 }: Props) {
  const meta = ROLE_META[role] ?? { label: role, color: "border-ink-400" };
  const scrollRef = useRef<HTMLDivElement>(null);

  // 流式追加时自动滚到底
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [text]);

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border-l-4 bg-white/70 shadow-sm",
        meta.color,
      )}
    >
      <div className="flex items-center justify-between border-b border-ink-100 px-4 py-2">
        <div className="flex items-center gap-2">
          <StatusIcon status={status} />
          <h3 className="text-sm font-semibold text-ink-800">{meta.label}</h3>
          {stockCount > 0 && (
            <span className="text-xs text-ink-400">{stockCount} 只</span>
          )}
        </div>
        <StatusBadge status={status} />
      </div>
      <div
        ref={scrollRef}
        className="max-h-72 min-h-[8rem] overflow-y-auto px-4 py-3 text-sm leading-relaxed text-ink-700"
      >
        {text ? (
          <pre className="whitespace-pre-wrap font-sans">{text}</pre>
        ) : (
          <p className="text-ink-400">
            {status === "pending" ? "等待启动…" : "等待数据…"}
          </p>
        )}
        {status === "running" && text && (
          <span className="inline-block h-4 w-2 animate-pulse bg-scarlet-500/40 align-middle" />
        )}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: AnalystStatus }) {
  if (status === "running") {
    return <Loader2 className="h-4 w-4 animate-spin text-scarlet-600" />;
  }
  if (status === "done") {
    return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  }
  if (status === "fail") {
    return <Circle className="h-4 w-4 text-red-500" />;
  }
  return <Circle className="h-4 w-4 text-ink-300" />;
}

function StatusBadge({ status }: { status: AnalystStatus }) {
  const map = {
    pending: { text: "待启动", color: "text-ink-400" },
    running: { text: "分析中…", color: "text-scarlet-600" },
    done: { text: "已完成", color: "text-emerald-700" },
    fail: { text: "失败", color: "text-red-700" },
  } as const;
  const m = map[status];
  return <span className={"text-xs " + m.color}>{m.text}</span>;
}
