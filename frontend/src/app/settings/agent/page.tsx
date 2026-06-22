"use client";

/**
 * 我的诊股 Agent · L2 经营入口(Phase F5)。
 *
 * 4 个区域:
 * - Hero: 当前画像 narrative + 版本 + 立即更新画像按钮
 * - 显式偏好(按 scope 分组,可启停 / 删除)
 * - AI 发现的矛盾(画像 vs 行为不一致)
 * - 诊股历史时间线
 *
 * 数据接口:/api/profile, /preferences, /timeline
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import { loadConfig } from "@/lib/llm-config";

interface ProfileData {
  exists: boolean;
  version?: number;
  narrative?: string | null;
  risk_appetite?: number | null;
  preferred_horizon?: string | null;
  decision_speed?: string | null;
  focus_themes?: string[];
  avoided_styles?: string[];
  confidence?: number | null;
  contradictions?: Array<{
    explicit_pref_id?: string;
    behavior_evidence?: string;
    suggestion?: string;
  }>;
  source_signal_count?: number;
  source_card_count?: number;
  last_reflected_at?: string | null;
  preference_count?: number;
  diagnosis_count?: number;
  needs_more_data?: boolean;
  hint?: string;
}

interface Preference {
  id: string;
  scope: string;
  instruction: string;
  summary: string | null;
  active: boolean;
  source: string;
  applied_count: number;
  last_applied_at: string | null;
  created_at: string;
  origin_diagnosis_id: string | null;
}

interface TimelineEntry {
  diagnosis_id: string;
  created_at: string;
  stocks: string[];
  mode: string | null;
  consensus: string | null;
  risk_lean: string | null;
  revision_count: number;
}

const SCOPE_GROUPS: { key: string; label: string; match: (s: string) => boolean }[] = [
  { key: "global", label: "全局", match: (s) => s === "global" },
  { key: "analyst", label: "影响分析师", match: (s) => s.startsWith("analyst:") },
  { key: "master", label: "影响大师辩论", match: (s) => s.startsWith("master:") },
  { key: "risk", label: "影响风控", match: (s) => s.startsWith("risk:") },
];

export default function MyAgentPage() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [prefs, setPrefs] = useState<Preference[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [reflecting, setReflecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    global: true,
    analyst: true,
    master: false,
    risk: false,
  });

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, pl, tl] = await Promise.all([
        apiGet<ProfileData>("/api/profile"),
        apiGet<Preference[]>("/api/profile/preferences"),
        apiGet<TimelineEntry[]>("/api/profile/timeline?limit=20"),
      ]);
      setProfile(p);
      setPrefs(pl);
      setTimeline(tl);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const triggerReflect = async () => {
    const cfg = loadConfig();
    // 取第一个 enabled provider 做反思
    let llm: { provider: string; api_key: string; base_url?: string; model?: string } | null = null;
    for (const [pid, pcfg] of Object.entries(cfg.providers)) {
      if (pcfg?.enabled && pcfg.apiKey) {
        llm = {
          provider: pid,
          api_key: pcfg.apiKey,
          base_url: pcfg.baseUrl || undefined,
          model: pcfg.defaultModel,
        };
        break;
      }
    }
    if (!llm) {
      setError("请先在「设置 → LLM」配置一个 Provider");
      return;
    }
    setReflecting(true);
    setError(null);
    try {
      const resp = await fetch("/api/profile/reflect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(llm),
      });
      if (!resp.ok) {
        const detail = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${detail.slice(0, 200)}`);
      }
      await reload();
    } catch (e) {
      setError(`反思失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setReflecting(false);
    }
  };

  const toggleActive = async (pref: Preference) => {
    try {
      await fetch(`/api/profile/preferences/${pref.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !pref.active }),
      });
      await reload();
    } catch {
      /* ignore */
    }
  };

  const deletePref = async (pref: Preference) => {
    if (!confirm(`确认删除偏好「${pref.summary || pref.instruction.slice(0, 30)}」?`)) return;
    try {
      await fetch(`/api/profile/preferences/${pref.id}`, { method: "DELETE" });
      await reload();
    } catch {
      /* ignore */
    }
  };

  if (loading) {
    return (
      <main className="container mx-auto max-w-4xl py-10">
        <div className="text-ink-500">加载中…</div>
      </main>
    );
  }

  // 零状态:无画像 + 偏好稀少
  const isZeroState = !profile?.exists && (profile?.diagnosis_count ?? 0) === 0 && prefs.length === 0;

  return (
    <main className="container mx-auto max-w-4xl py-10">
      <h1 className="mb-2 text-3xl font-bold text-ink-800">我的画像</h1>
      <p className="mb-6 text-sm text-ink-500">
        这是系统对你的理解,会自动注入到未来每次诊股,让结果更贴合你的口味。
      </p>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {isZeroState ? (
        <ZeroState />
      ) : (
        <>
          <HeroBlock profile={profile} onReflect={triggerReflect} reflecting={reflecting} />

          <section className="mt-8">
            <h2 className="mb-3 text-lg font-semibold text-ink-700">显式偏好 ({prefs.length})</h2>
            {prefs.length === 0 ? (
              <p className="rounded-md border border-ink-200 bg-white/60 p-4 text-sm text-ink-500">
                还没有偏好。去任意一次诊股的报告页,点右下角「💬 调整诊股逻辑」对话告诉机器人。
              </p>
            ) : (
              SCOPE_GROUPS.map((g) => {
                const items = prefs.filter((p) => g.match(p.scope));
                if (items.length === 0) return null;
                const open = openGroups[g.key];
                return (
                  <div key={g.key} className="mb-3 rounded-lg border border-ink-200 bg-white/60">
                    <button
                      type="button"
                      onClick={() => setOpenGroups((s) => ({ ...s, [g.key]: !open }))}
                      className="flex w-full items-center justify-between px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
                    >
                      <span>
                        {open ? "▼" : "▶"} {g.label} ({items.length})
                      </span>
                    </button>
                    {open && (
                      <div className="space-y-2 px-4 pb-3">
                        {items.map((p) => (
                          <PreferenceCard
                            key={p.id}
                            pref={p}
                            onToggle={() => void toggleActive(p)}
                            onDelete={() => void deletePref(p)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </section>

          {profile?.contradictions && profile.contradictions.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-3 text-lg font-semibold text-purple-700">
                ⚠️ AI 发现的矛盾 ({profile.contradictions.length})
              </h2>
              <div className="space-y-2">
                {profile.contradictions.map((c, i) => (
                  <div
                    key={i}
                    className="rounded-md border border-purple-200 bg-purple-50 p-3 text-sm text-purple-900"
                  >
                    <p className="font-medium">证据:{c.behavior_evidence}</p>
                    {c.suggestion && (
                      <p className="mt-1 text-xs text-purple-700">💡 建议:{c.suggestion}</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {timeline.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-3 text-lg font-semibold text-ink-700">诊股历史时间线 ({timeline.length})</h2>
              <div className="space-y-1.5">
                {timeline.map((t) => (
                  <Link
                    key={t.diagnosis_id}
                    href={`/debate/${t.diagnosis_id}`}
                    className="flex items-center justify-between rounded-md border border-ink-200 bg-white/60 px-3 py-2 text-sm hover:bg-ink-50"
                  >
                    <span className="font-mono text-xs text-ink-500">
                      {new Date(t.created_at).toLocaleString("zh-CN", { hour12: false }).slice(0, 16)}
                    </span>
                    <span className="text-ink-700">
                      {t.mode} · {t.stocks.join(", ") || "—"}
                    </span>
                    <span className="text-xs text-ink-500">
                      共识 {t.consensus ?? "—"} · 风控 {t.risk_lean ?? "—"}
                      {t.revision_count > 0 && (
                        <span className="ml-1 text-emerald-600">· v{t.revision_count + 1}</span>
                      )}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}

function HeroBlock({
  profile,
  onReflect,
  reflecting,
}: {
  profile: ProfileData | null;
  onReflect: () => void;
  reflecting: boolean;
}) {
  if (!profile) return null;

  return (
    <section className="rounded-lg border border-blue-200 bg-blue-50/60 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-ink-800">
          画像概览 {profile.exists ? `· v${profile.version ?? 0}` : ""}
        </h2>
        <button
          type="button"
          onClick={onReflect}
          disabled={reflecting}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:bg-ink-300"
        >
          {reflecting ? "反思中…" : "立即更新画像"}
        </button>
      </div>

      {profile.exists ? (
        <>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink-800">
            {profile.narrative}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-ink-600 sm:grid-cols-4">
            {profile.risk_appetite !== null && profile.risk_appetite !== undefined && (
              <Field label="风险偏好" value={profile.risk_appetite.toFixed(2)} />
            )}
            {profile.preferred_horizon && (
              <Field label="持有周期" value={profile.preferred_horizon} />
            )}
            {profile.decision_speed && (
              <Field label="决策风格" value={profile.decision_speed} />
            )}
            {profile.confidence !== null && profile.confidence !== undefined && (
              <Field label="置信度" value={profile.confidence.toFixed(2)} />
            )}
          </div>
          {profile.focus_themes && profile.focus_themes.length > 0 && (
            <p className="mt-3 text-xs text-ink-600">
              <strong>关注:</strong> {profile.focus_themes.join(", ")}
            </p>
          )}
          {profile.avoided_styles && profile.avoided_styles.length > 0 && (
            <p className="mt-1 text-xs text-ink-600">
              <strong>避免:</strong> {profile.avoided_styles.join(", ")}
            </p>
          )}
          {profile.last_reflected_at && (
            <p className="mt-3 text-xs text-ink-400">
              上次反思:{new Date(profile.last_reflected_at).toLocaleString("zh-CN")}
            </p>
          )}
        </>
      ) : (
        <p className="mt-3 text-sm text-ink-700">{profile.hint}</p>
      )}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-white/70 px-2 py-1.5">
      <div className="text-ink-400">{label}</div>
      <div className="text-sm font-medium text-ink-800">{value}</div>
    </div>
  );
}

function PreferenceCard({
  pref,
  onToggle,
  onDelete,
}: {
  pref: Preference;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`rounded-md border bg-white px-3 py-2 text-sm ${
        pref.active ? "border-amber-300" : "border-ink-200 opacity-60"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink-800">
            {pref.summary || pref.instruction.slice(0, 30) + "…"}
          </p>
          <p className="mt-1 text-xs text-ink-600">{pref.instruction}</p>
          <p className="mt-1 text-xs text-ink-400">
            scope: {pref.scope} · 应用 {pref.applied_count} 次 · {pref.source}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={onToggle}
            className="rounded border border-ink-200 px-2 py-0.5 text-xs text-ink-600 hover:bg-ink-100"
          >
            {pref.active ? "停用" : "启用"}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

function ZeroState() {
  return (
    <div className="rounded-lg border border-ink-200 bg-white/70 p-8 text-center">
      <p className="text-3xl">🌱</p>
      <h2 className="mt-3 text-xl font-semibold text-ink-800">你的诊股 Agent 还没开始成长</h2>
      <ul className="mt-4 space-y-1.5 text-sm text-ink-600">
        <li>· 完成 <strong>3 次诊股</strong>,系统就能生成你的画像 v1</li>
        <li>· 在报告里点 <strong>「💬 调整诊股逻辑」</strong> 告诉 AI 你的想法</li>
        <li>· 行为信号(看报告时长、采纳建议等)会自动学习</li>
      </ul>
      <Link
        href="/"
        className="mt-5 inline-block rounded bg-scarlet-600 px-4 py-2 text-sm font-medium text-white hover:bg-scarlet-700"
      >
        去诊股 →
      </Link>
    </div>
  );
}
