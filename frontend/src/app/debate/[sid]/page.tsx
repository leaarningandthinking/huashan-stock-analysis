"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { openSSE } from "@/lib/sse";
import { AnalystCard, type AnalystStatus } from "@/components/debate/AnalystCard";
import { DebateStage } from "@/components/debate/DebateStage";
import { ProgressBar } from "@/components/debate/ProgressBar";
import type { MasterTurnData } from "@/components/debate/MasterTurn";
import { RiskPanel, type RiskSchool, type RiskState } from "@/components/debate/RiskPanel";
import { apiGet, type MasterSummary } from "@/lib/api";
import { cn } from "@/lib/cn";
import { getDiagnosisReport, type DiagnosisReportResponse } from "@/lib/diagnosis-api";

const ANALYST_ROLES = ["fundamental", "sentiment", "news", "technical"] as const;
type Role = (typeof ANALYST_ROLES)[number];
const PROGRESS_POLL_INTERVAL_MS = 120_000;
const STALE_PROGRESS_WARNING_MS = 360_000;

interface AnalystState {
  status: AnalystStatus;
  text: string;
  stockCount: number;
}

interface StepInfo {
  step: number;
  name: string;
  status: "pending" | "running" | "done" | "skipped";
}

const INITIAL_STEPS: StepInfo[] = [
  { step: 1, name: "持仓概览", status: "pending" },
  { step: 2, name: "分析师团队", status: "pending" },
  { step: 3, name: "投研经理分析", status: "pending" },
  { step: 4, name: "大师圆桌观点", status: "pending" },
  { step: 5, name: "风控审核", status: "pending" },
  { step: 6, name: "投资经理决策", status: "pending" },
  { step: 7, name: "报告摘要", status: "pending" },
];

const INITIAL_RISK: Record<RiskSchool, RiskState> = {
  aggressive: { status: "pending", text: "" },
  conservative: { status: "pending", text: "" },
};

interface DiagnosisContext {
  mode: "single" | "batch" | "portfolio";
  stocks: { code: string; name: string }[];
}

type ReportSnapshot = {
  analysts?: Record<string, { text?: string; failed?: boolean; error?: string }>;
  research_manager?: { text?: string; failed?: boolean; error?: string };
  debate?: { transcript?: MasterTurnData[] };
  risk?: Record<string, { text?: string; failed?: boolean }>;
  investment_manager?: { text?: string; failed?: boolean };
};

function buildSteps(ctx: DiagnosisContext | null): StepInfo[] {
  if (ctx?.mode === "single") {
    return INITIAL_STEPS.filter((s) => s.step !== 1);
  }
  return INITIAL_STEPS;
}

function applyContextToSteps(prev: StepInfo[], ctx: DiagnosisContext | null): StepInfo[] {
  const prevByStep = new Map(prev.map((s) => [s.step, s]));
  return buildSteps(ctx).map((base) => ({
    ...base,
    ...prevByStep.get(base.step),
    name: normalizeStepName(base.step, prevByStep.get(base.step)?.name ?? base.name),
  }));
}

function normalizeStepName(step: number, name: string): string {
  if (step === 3) return "投研经理分析";
  if (step === 4) return "大师圆桌观点";
  return name;
}

function buildPageTitle(ctx: DiagnosisContext | null): string {
  const firstStock = ctx?.stocks?.[0];
  if (ctx?.stocks?.length === 1 && firstStock?.name) {
    return `华山煮酒·${firstStock.name}论股中`;
  }
  if (ctx?.mode === "batch" && ctx.stocks?.length) {
    return `华山煮酒·${ctx.stocks.length}只股票论股中`;
  }
  if (ctx?.mode === "portfolio") {
    return "华山煮酒·持仓论股中";
  }
  return "华山论股·诊断进行中";
}

function doneSteps(ctx: DiagnosisContext | null): StepInfo[] {
  return buildSteps(ctx).map((s) => ({ ...s, status: "done" }));
}

export default function DiagnosisStreamPage() {
  const params = useParams<{ sid: string }>();
  const sid = params.sid;

  const [steps, setSteps] = useState<StepInfo[]>(INITIAL_STEPS);
  const [diagnosisContext, setDiagnosisContext] = useState<DiagnosisContext | null>(null);
  const [analysts, setAnalysts] = useState<Record<Role, AnalystState>>({
    fundamental: { status: "pending", text: "", stockCount: 0 },
    sentiment: { status: "pending", text: "", stockCount: 0 },
    news: { status: "pending", text: "", stockCount: 0 },
    technical: { status: "pending", text: "", stockCount: 0 },
  });
  const [lineup, setLineup] = useState<{ slug: string; name: string; tagline?: string }[]>([]);
  const [turns, setTurns] = useState<MasterTurnData[]>([]);
  const [researchManager, setResearchManager] = useState<RiskState>({
    status: "pending",
    text: "",
  });
  const [riskStates, setRiskStates] = useState<Record<RiskSchool, RiskState>>(INITIAL_RISK);
  const [managerDecision, setManagerDecision] = useState<RiskState>({
    status: "pending",
    text: "",
  });
  const [reportReady, setReportReady] = useState<any>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const lastAppliedEventIdRef = useRef(0);
  const lastProgressAtRef = useRef(Date.now());
  // 大师目录用 ref 保存，避免触发 SSE useEffect 重连
  const mastersDirectoryRef = useRef<Record<string, MasterSummary>>({});

  // 拉一份大师目录用于头像
  useEffect(() => {
    apiGet<MasterSummary[]>("/api/masters")
      .then((list) => {
        const m: Record<string, MasterSummary> = {};
        for (const x of list) m[x.slug] = x;
        mastersDirectoryRef.current = m;
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!sid) return;
    let disposed = false;
    const poll = () => {
      getDiagnosisReport(sid)
        .then((report) => {
          if (disposed) return;
          applyReportSnapshot(report);
          if (
            report.status === "running" &&
            Date.now() - lastProgressAtRef.current > STALE_PROGRESS_WARNING_MS
          ) {
            setGlobalError(
              "诊断仍在运行，但最近几分钟没有新的进度事件。页面会继续每 2 分钟同步一次，若长期无变化再重新发起诊断。",
            );
          }
        })
        .catch(() => {
          if (!disposed) {
            setGlobalError("进度同步暂时失败，页面会继续每 2 分钟自动重试。");
          }
        });
    };
    poll();
    const timer = window.setInterval(poll, PROGRESS_POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [sid]);

  function markProgress() {
    lastProgressAtRef.current = Date.now();
    setGlobalError((prev) => {
      if (
        prev?.startsWith("事件流暂未返回进度") ||
        prev?.startsWith("诊断仍在运行") ||
        prev?.startsWith("进度同步暂时失败")
      ) {
        return null;
      }
      return prev;
    });
  }

  function applyReportSnapshot(report: DiagnosisReportResponse) {
    const ctx =
      report.mode && report.stocks
        ? { mode: report.mode, stocks: report.stocks }
        : null;
    if (ctx) {
      setDiagnosisContext(ctx);
      setSteps((prev) => applyContextToSteps(prev, ctx));
    }
    if (report.events?.length) {
      applyPersistedEvents(report.events);
    }
    if (report.status === "done" && report.report) {
      hydrateFromReport(report.report as ReportSnapshot, ctx ?? diagnosisContext);
      setSteps(doneSteps(ctx ?? diagnosisContext));
      setReportReady({ status: "done" });
      markProgress();
    }
    if (report.status === "failed") {
      setGlobalError(report.error ?? "诊断任务失败");
    }
  }

  function applyPersistedEvents(events: { id?: string | number; event?: string; data?: unknown }[]) {
    const ordered = [...events].sort((a, b) => Number(a.id ?? 0) - Number(b.id ?? 0));
    for (const rec of ordered) {
      const eventId = Number(rec.id ?? 0);
      if (eventId && eventId <= lastAppliedEventIdRef.current) continue;
      if (eventId) lastAppliedEventIdRef.current = eventId;
      applyDiagnosisEvent(rec.event ?? "message", rec.data);
    }
  }

  function hydrateFromReport(snapshot: ReportSnapshot, ctx: DiagnosisContext | null) {
    const stockCount = ctx?.stocks?.length ?? 0;
    if (snapshot.analysts) {
      setAnalysts((prev) => {
        const next = { ...prev };
        for (const role of ANALYST_ROLES) {
          const item = snapshot.analysts?.[role];
          if (!item) continue;
          next[role] = {
            status: item.failed ? "fail" : "done",
            text: item.failed ? item.error ?? item.text ?? "" : item.text ?? "",
            stockCount,
          };
        }
        return next;
      });
    }
    if (snapshot.debate?.transcript) {
      setTurns(snapshot.debate.transcript.map((turn) => ({ ...turn, done: true })));
    }
    if (snapshot.research_manager) {
      setResearchManager({
        status: snapshot.research_manager.failed ? "fail" : "done",
        text: snapshot.research_manager.text ?? snapshot.research_manager.error ?? "",
      });
    }
    if (snapshot.risk) {
      setRiskStates((prev) => ({
        ...prev,
        aggressive: {
          status: snapshot.risk?.aggressive?.failed ? "fail" : "done",
          text: snapshot.risk?.aggressive?.text ?? "",
        },
        conservative: {
          status: snapshot.risk?.conservative?.failed ? "fail" : "done",
          text: snapshot.risk?.conservative?.text ?? "",
        },
      }));
    }
    if (snapshot.investment_manager) {
      setManagerDecision({
        status: snapshot.investment_manager.failed ? "fail" : "done",
        text: snapshot.investment_manager.text ?? "",
      });
    }
  }

  function applyDiagnosisEvent(eventType: string, data: any) {
    markProgress();
    switch (eventType) {
      case "diagnosis.context":
        setDiagnosisContext(data);
        setSteps((prev) => applyContextToSteps(prev, data));
        break;
      case "step.start":
        setSteps((s) =>
          s.map((x) =>
            x.step === data.step
              ? { ...x, status: "running", name: normalizeStepName(x.step, data.name ?? x.name) }
              : x,
          ),
        );
        break;
      case "step.done":
        setSteps((s) =>
          s.map((x) => (x.step === data.step ? { ...x, status: "done" } : x)),
        );
        break;
      case "step.skip":
        setSteps((s) =>
          s.map((x) =>
            x.step === data.step
              ? { ...x, status: "skipped", name: normalizeStepName(x.step, data.name ?? x.name) }
              : x,
          ),
        );
        break;
      case "analyst.start":
        setAnalysts((a) => ({
          ...a,
          [data.analyst]: {
            ...a[data.analyst as Role],
            status: "running",
            stockCount: data.stocks?.length ?? 0,
          },
        }));
        break;
      case "analyst.delta":
        setAnalysts((a) => ({
          ...a,
          [data.analyst]: {
            ...a[data.analyst as Role],
            text: a[data.analyst as Role].text + (data.text ?? ""),
          },
        }));
        break;
      case "analyst.done":
        setAnalysts((a) => ({
          ...a,
          [data.analyst]: { ...a[data.analyst as Role], status: "done" },
        }));
        break;
      case "analyst.fail":
        setAnalysts((a) => ({
          ...a,
          [data.analyst]: {
            ...a[data.analyst as Role],
            status: "fail",
            text:
              a[data.analyst as Role].text +
              `\n\n⚠️ 分析师失败：${data.error ?? "(unknown)"}`,
          },
        }));
        break;
      case "research_manager.start":
        setResearchManager((s) => ({ ...s, status: "running" }));
        break;
      case "research_manager.delta":
        setResearchManager((s) => ({ ...s, text: s.text + (data.text ?? "") }));
        break;
      case "research_manager.done":
        setResearchManager((s) => ({ ...s, status: data.failed ? "fail" : "done" }));
        break;
      case "debate.lineup":
        setLineup(data.masters ?? []);
        break;
      case "master.start":
        setTurns((prev) => [
          ...prev,
          {
            master: data.master,
            name: data.name ?? data.master,
            round: data.round ?? 1,
            text: "",
            done: false,
            avatar_url: mastersDirectoryRef.current[data.master]?.avatar_url ?? undefined,
            tagline: mastersDirectoryRef.current[data.master]?.tagline,
          },
        ]);
        break;
      case "master.delta":
        setTurns((prev) => {
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].master === data.master && prev[i].round === data.round) {
              const next = [...prev];
              next[i] = { ...prev[i], text: prev[i].text + (data.text ?? "") };
              return next;
            }
          }
          return prev;
        });
        break;
      case "master.done":
        setTurns((prev) => {
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].master === data.master && prev[i].round === data.round) {
              const next = [...prev];
              next[i] = { ...prev[i], done: true };
              return next;
            }
          }
          return prev;
        });
        break;
      case "risk.start":
        setRiskStates((s) => ({
          ...s,
          [data.school as RiskSchool]: { ...s[data.school as RiskSchool], status: "running" },
        }));
        break;
      case "risk.delta":
        setRiskStates((s) => ({
          ...s,
          [data.school as RiskSchool]: {
            ...s[data.school as RiskSchool],
            text: s[data.school as RiskSchool].text + (data.text ?? ""),
          },
        }));
        break;
      case "risk.done":
        setRiskStates((s) => ({
          ...s,
          [data.school as RiskSchool]: {
            ...s[data.school as RiskSchool],
            status: data.failed ? "fail" : "done",
          },
        }));
        break;
      case "manager.start":
        setManagerDecision((s) => ({ ...s, status: "running" }));
        break;
      case "manager.delta":
        setManagerDecision((s) => ({ ...s, text: s.text + (data.text ?? "") }));
        break;
      case "manager.done":
        setManagerDecision((s) => ({ ...s, status: data.failed ? "fail" : "done" }));
        break;
      case "report.ready":
        setReportReady(data);
        break;
      case "error":
        if (data) {
          setGlobalError(`${data.code ?? "ERROR"}: ${data.message ?? "(no message)"}`);
        }
        break;
    }
  }

  useEffect(() => {
    if (!sid) return;
    const url = `/api/diagnosis/${sid}/stream`;
    const client = openSSE(url, (eventType, data, eventId) => {
      if (eventType !== "__connection_error__") {
        const numericEventId = Number(eventId ?? 0);
        if (numericEventId && numericEventId <= lastAppliedEventIdRef.current) {
          return;
        }
        if (numericEventId) lastAppliedEventIdRef.current = numericEventId;
        applyDiagnosisEvent(eventType, data);
      }
      if (eventType === "report.ready") {
        client.close();
      }
    });
    return () => {
      client.close();
    };
  }, [sid]);

  const pageTitle = buildPageTitle(diagnosisContext);

  return (
    <main className="container mx-auto max-w-5xl py-10">
      <h1 className="mb-2 text-3xl font-bold text-ink-800">{pageTitle}</h1>
      <p className="mb-6 text-sm text-ink-500">
        会话 ID：<span className="font-mono text-ink-400">{sid}</span>
      </p>

      <ProgressBar steps={steps} />
      <div className="mt-3">
        <StepProgress steps={steps} />
      </div>

      {globalError && (
        <div className="my-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {globalError}
        </div>
      )}

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold text-ink-700">分析师团队</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {ANALYST_ROLES.map((r) => (
            <AnalystCard
              key={r}
              role={r}
              status={analysts[r].status}
              text={analysts[r].text}
              stockCount={analysts[r].stockCount}
            />
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold text-ink-700">投研经理分析</h2>
        <div className="rounded-lg border border-ink-200 bg-white/70 p-4">
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink-700">
            {researchManager.text || (
              <span className="text-ink-400">
                {researchManager.status === "pending" ? "等待分析师报告完成…" : "等待数据…"}
              </span>
            )}
            {researchManager.status === "running" && researchManager.text && (
              <span className="inline-block h-3 w-1.5 animate-pulse bg-scarlet-500/40 align-middle" />
            )}
          </pre>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold text-ink-700">大师圆桌观点</h2>
        <DebateStage turns={turns} lineup={lineup} />
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold text-ink-700">风控审核</h2>
        <RiskPanel states={riskStates} />
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold text-ink-700">投资经理决策</h2>
        <div className="rounded-lg border border-ink-200 bg-white/70 p-4">
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink-700">
            {managerDecision.text || (
              <span className="text-ink-400">
                {managerDecision.status === "pending" ? "等待风控审核完成…" : "等待数据…"}
              </span>
            )}
            {managerDecision.status === "running" && managerDecision.text && (
              <span className="inline-block h-3 w-1.5 animate-pulse bg-scarlet-500/40 align-middle" />
            )}
          </pre>
        </div>
      </section>

      {reportReady && (
        <section className="mt-8 rounded-md border border-emerald-200 bg-emerald-50/60 p-4 text-sm text-emerald-800">
          <p className="font-medium">
            报告就绪 · {reportReady.master_count ?? 0} 轮发言 · {reportReady.risk_count ?? 0} 派风控
            {reportReady.has_research_manager ? " · 投研经理已完成分析" : ""}
            {reportReady.has_manager ? " · 投资经理已决策" : ""}
          </p>
          <p className="mt-1 text-xs text-emerald-700">
            <Link href={`/debate/${sid}/report`} className="underline hover:text-emerald-900">
              查看完整结构化报告
            </Link>
          </p>
        </section>
      )}
    </main>
  );
}

function StepProgress({ steps }: { steps: StepInfo[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-ink-200 bg-white/60 px-4 py-3 text-sm">
      {steps.map((s, idx) => (
        <li key={s.step} className="flex items-center gap-2">
          {s.status === "running" ? (
            <Loader2 className="h-4 w-4 animate-spin text-scarlet-600" />
          ) : s.status === "done" ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          ) : s.status === "skipped" ? (
            <Circle className="h-4 w-4 text-ink-200" />
          ) : (
            <Circle className="h-4 w-4 text-ink-300" />
          )}
          <span
            className={cn(
              "font-medium",
              s.status === "done" && "text-emerald-700",
              s.status === "running" && "text-scarlet-700",
              s.status === "skipped" && "text-ink-400 line-through",
              s.status === "pending" && "text-ink-500",
            )}
          >
            {idx + 1}. {s.name}
          </span>
          {idx < steps.length - 1 && <span className="text-ink-300">›</span>}
        </li>
      ))}
    </ol>
  );
}
