"use client";

import { MasterTurn, type MasterTurnData } from "./MasterTurn";
import { type RevisionInfo } from "./AnalystCard";

interface Props {
  turns: MasterTurnData[];
  lineup: { slug: string; name: string; tagline?: string }[];
  onReviseMaster?: (slug: string) => void;
  revisionInfoByMaster?: Record<string, RevisionInfo>;
}

export function DebateStage({ turns, lineup, onReviseMaster, revisionInfoByMaster }: Props) {
  if (turns.length === 0 && lineup.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-ink-300 bg-white/40 p-8 text-center text-sm text-ink-400">
        辩论尚未开场…
      </div>
    );
  }

  // 按 master slug 分配一个稳定的 index，用于颜色 + 左右翻转
  const slugToIdx = new Map<string, number>();
  for (const m of lineup) {
    if (!slugToIdx.has(m.slug)) slugToIdx.set(m.slug, slugToIdx.size);
  }
  for (const t of turns) {
    if (!slugToIdx.has(t.master)) slugToIdx.set(t.master, slugToIdx.size);
  }

  return (
    <div className="space-y-4">
      {lineup.length > 0 && (
        <div className="flex flex-wrap gap-2 rounded-md border border-ink-200 bg-white/60 p-3 text-xs">
          <span className="text-ink-500">本场参辩：</span>
          {lineup.map((m) => (
            <span
              key={m.slug}
              className="rounded-full bg-ink-100 px-2 py-0.5 font-medium text-ink-700"
            >
              {m.name}
            </span>
          ))}
        </div>
      )}
      {turns.map((t, i) => {
        const idx = slugToIdx.get(t.master) ?? i;
        return (
          <MasterTurn
            key={`${t.master}-${t.round}-${i}`}
            turn={t}
            index={idx}
            flip={idx % 2 === 1}
            onRevise={onReviseMaster ? () => onReviseMaster(t.master) : undefined}
            revisionInfo={revisionInfoByMaster?.[t.master]}
          />
        );
      })}
    </div>
  );
}
