"use client";

import { Loader2, CheckCircle2, Circle } from "lucide-react";
import { cn } from "@/lib/cn";

export type RiskSchool = "aggressive" | "conservative";
export type RiskStatus = "pending" | "running" | "done" | "fail";

export interface RiskState {
  status: RiskStatus;
  text: string;
}

const META: Record<RiskSchool, { label: string; color: string; icon: string }> = {
  aggressive: {
    label: "激进派",
    color: "border-red-500 bg-red-50/40",
    icon: "↑",
  },
  conservative: {
    label: "保守派",
    color: "border-emerald-500 bg-emerald-50/40",
    icon: "↓",
  },
};

const ORDER: RiskSchool[] = ["aggressive", "conservative"];

interface Props {
  states: Record<RiskSchool, RiskState>;
}

export function RiskPanel({ states }: Props) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {ORDER.map((school) => {
        const m = META[school];
        const s = states[school];
        return (
          <div
            key={school}
            className={cn("rounded-lg border-l-4 p-4 shadow-sm", m.color)}
          >
            <div className="mb-2 flex items-center justify-between text-sm">
              <h4 className="font-semibold text-ink-800">
                <span className="mr-1 text-base">{m.icon}</span>
                {m.label}
              </h4>
              <StatusIcon status={s.status} />
            </div>
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink-700">
              {s.text || (
                <span className="text-ink-400">
                  {s.status === "pending" ? "等待辩论结束…" : "等待数据…"}
                </span>
              )}
              {s.status === "running" && s.text && (
                <span className="inline-block h-3 w-1.5 animate-pulse bg-scarlet-500/40 align-middle" />
              )}
            </pre>
          </div>
        );
      })}
    </div>
  );
}

function StatusIcon({ status }: { status: RiskStatus }) {
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
