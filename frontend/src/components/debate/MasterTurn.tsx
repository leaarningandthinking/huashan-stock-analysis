"use client";

import { useEffect, useRef } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { RevisionBadge, type RevisionInfo } from "./AnalystCard";

export interface MasterTurnData {
  master: string;
  name: string;
  round: number;
  text: string;
  done: boolean;
  avatar_url?: string;
  tagline?: string;
}

const SCHOOL_TONES = [
  // 不区分阵营，按发言顺序循环上色，让视觉有节奏
  "border-amber-400 bg-amber-50/40",
  "border-violet-400 bg-violet-50/40",
  "border-sky-400 bg-sky-50/40",
  "border-emerald-400 bg-emerald-50/40",
  "border-rose-400 bg-rose-50/40",
  "border-orange-400 bg-orange-50/40",
];

interface Props {
  turn: MasterTurnData;
  index: number;
  flip?: boolean; // 左右交替排版
  onRevise?: () => void;
  revisionInfo?: RevisionInfo;
}

export function MasterTurn({ turn, index, flip, onRevise, revisionInfo }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current && !turn.done) {
      ref.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [turn.text, turn.done]);

  const tone = SCHOOL_TONES[index % SCHOOL_TONES.length];

  return (
    <div
      ref={ref}
      className={cn(
        "flex gap-3",
        flip ? "flex-row-reverse" : "flex-row",
      )}
    >
      <div className="flex-none">
        {turn.avatar_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={turn.avatar_url}
            alt={turn.name}
            className="h-12 w-12 rounded-full border border-ink-200 bg-white object-cover"
          />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-ink-100 text-sm font-semibold text-ink-600">
            {turn.name.slice(0, 1)}
          </div>
        )}
      </div>
      <div
        className={cn(
          "flex-1 rounded-lg border-l-4 p-4 shadow-sm",
          tone,
          flip && "border-l-0 border-r-4",
        )}
      >
        <div className="mb-2 flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-ink-800">{turn.name}</span>
            {turn.tagline && (
              <span className="text-ink-500">· {turn.tagline}</span>
            )}
            <span className="rounded bg-white/70 px-1.5 py-0.5 text-ink-500">
              第 {turn.round} 轮
            </span>
            <RevisionBadge info={revisionInfo} />
          </div>
          <div className="flex items-center gap-2">
            {onRevise && turn.done && (
              <button
                type="button"
                onClick={onRevise}
                title={`对 ${turn.name} 的发言有异议?调整`}
                className="rounded-full px-2 py-0.5 text-xs text-ink-500 hover:bg-amber-100 hover:text-amber-800"
              >
                💬 调整
              </button>
            )}
            {turn.done ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : (
              <Loader2 className="h-4 w-4 animate-spin text-scarlet-600" />
            )}
          </div>
        </div>
        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink-700">
          {turn.text}
          {!turn.done && (
            <span className="inline-block h-3 w-1.5 animate-pulse bg-scarlet-500/40 align-middle" />
          )}
        </pre>
      </div>
    </div>
  );
}
