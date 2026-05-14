"use client";

import { cn } from "@/lib/cn";

export interface StepInfo {
  step: number;
  name: string;
  status: "pending" | "running" | "done" | "skipped";
}

// 各 step 的耗时权重（单位：秒级别的相对值）
// 大师圆桌观点是大头（多轮 LLM 串行）
const WEIGHTS: Record<number, number> = {
  1: 1,   // 持仓概览（瞬完成）
  2: 6,   // 分析师团队（4 LLM 并行 ~1 倍单次）
  3: 0.5, // 投研经理分析
  4: 12,  // 大师圆桌观点（2-3 大师 × 2 轮串行）
  5: 3,   // 风控审核（两派并行）
  6: 4,   // 投资经理决策
  7: 2,   // 报告摘要
};

interface Props {
  steps: StepInfo[];
}

export function ProgressBar({ steps }: Props) {
  const totalWeight = steps.reduce(
    (sum, s) => (s.status === "skipped" ? sum : sum + (WEIGHTS[s.step] ?? 1)),
    0,
  );

  let acquired = 0;
  for (const s of steps) {
    if (s.status === "skipped") continue;
    const w = WEIGHTS[s.step] ?? 1;
    if (s.status === "done") acquired += w;
    else if (s.status === "running") acquired += w * 0.5;
  }

  const pct = totalWeight > 0 ? Math.round((acquired / totalWeight) * 100) : 0;

  const currentStep = steps.find((s) => s.status === "running");
  const currentStepIndex = currentStep
    ? steps.findIndex((s) => s.step === currentStep.step) + 1
    : 0;
  const allDone = steps.every((s) => s.status === "done" || s.status === "skipped");

  return (
    <div className="rounded-lg border border-ink-200 bg-white/60 px-4 py-3">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-medium text-ink-700">
          {allDone ? (
            <span className="text-emerald-700">✓ 全部完成</span>
          ) : currentStep ? (
            <>
              <span className="text-scarlet-600">进行中：</span>
              {currentStepIndex}. {currentStep.name}
            </>
          ) : (
            <span className="text-ink-500">等待开始…</span>
          )}
        </span>
        <span
          className={cn(
            "font-mono text-sm font-semibold",
            allDone ? "text-emerald-700" : "text-scarlet-700",
          )}
        >
          {pct}%
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-ink-100">
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{
            width: `${pct}%`,
            backgroundColor: allDone ? "#059669" : "#a83232",
          }}
        />
      </div>
    </div>
  );
}
