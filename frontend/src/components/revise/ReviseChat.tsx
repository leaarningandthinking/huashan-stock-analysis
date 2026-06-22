"use client";

/**
 * 修订诊股侧边栏(Cursor / Notion AI 风格)。
 *
 * 3 态:
 * - collapsed: 右侧 32px 窄条 + 💬 icon + context tag + 未读小红点
 * - expanded:  右侧 380~600px 面板,左边界可拖拽调宽,localStorage 持久化
 * - (fullscreen 留 F2)
 *
 * 触发:
 * - 点窄条 / ⌘+I 切换
 * - Esc 收起
 * - F1 内嵌"调整"按钮(externalContext + triggerNonce) → 强制展开 + 锁定 context
 *
 * 不影响主内容布局:position: fixed; right: 0,在 1440px+ 屏幕填充原本右侧留白。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { loadConfig, type LLMConfig } from "@/lib/llm-config";

type ChatEvent =
  | { kind: "user"; text: string }
  | { kind: "thinking"; step: number }
  | { kind: "tool_call"; name: string; arguments: Record<string, unknown> }
  | { kind: "tool_result"; name: string; result: Record<string, unknown> }
  | { kind: "assistant"; text: string }
  | { kind: "rerun_triggered"; plan: Record<string, unknown> }
  | { kind: "error"; message: string };

const STORAGE_KEY = "hs_revise_sidebar_v1";
const SEEN_KEY = "hs_revise_seen_v1"; // 是否见过窄条(首次访问加强引导)
const DEFAULT_WIDTH = 420;
const MIN_WIDTH = 320;
const MAX_WIDTH = 720;

interface SidebarState {
  isOpen: boolean;
  width: number;
}

function loadSidebarState(): SidebarState {
  if (typeof window === "undefined") return { isOpen: false, width: DEFAULT_WIDTH };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { isOpen: false, width: DEFAULT_WIDTH };
    const parsed = JSON.parse(raw) as Partial<SidebarState>;
    return {
      isOpen: !!parsed.isOpen,
      width: clampWidth(parsed.width ?? DEFAULT_WIDTH),
    };
  } catch {
    return { isOpen: false, width: DEFAULT_WIDTH };
  }
}

function saveSidebarState(s: SidebarState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore quota */
  }
}

function clampWidth(w: number): number {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(w)));
}

function pickReviseProvider(cfg: LLMConfig): {
  provider: string;
  api_key: string;
  base_url?: string;
  model?: string;
} | null {
  if (cfg.routing?.analyst) {
    const pid = cfg.routing.analyst.provider;
    const pcfg = cfg.providers[pid];
    if (pcfg?.enabled && pcfg.apiKey) {
      return {
        provider: pid,
        api_key: pcfg.apiKey,
        base_url: pcfg.baseUrl || undefined,
        model: cfg.routing.analyst.model || pcfg.defaultModel,
      };
    }
  }
  for (const [pid, pcfg] of Object.entries(cfg.providers)) {
    if (pcfg?.enabled && pcfg.apiKey) {
      return {
        provider: pid,
        api_key: pcfg.apiKey,
        base_url: pcfg.baseUrl || undefined,
        model: pcfg.defaultModel,
      };
    }
  }
  return null;
}

// 把 section key 映射成可读 chip 文本
function describeContext(ctx: { section: string; stock?: string } | null): string {
  if (!ctx) return "";
  const map: Record<string, string> = {
    "analyst.fundamental": "基本面分析师",
    "analyst.sentiment": "情绪分析师",
    "analyst.news": "新闻分析师",
    "analyst.technical": "技术分析师",
    "risk.aggressive": "激进派风控",
    "risk.conservative": "保守派风控",
    "report_card": "报告卡片",
    "debate": "大师辩论",
  };
  if (ctx.section.startsWith("master.")) {
    return `大师 ${ctx.section.slice(7)}`;
  }
  return map[ctx.section] ?? ctx.section;
}

export function ReviseChat({
  sid,
  externalContext,
  triggerNonce = 0,
}: {
  sid: string;
  externalContext?: { section: string; stock?: string } | null;
  triggerNonce?: number;
}) {
  // Sidebar 形态状态
  const [mounted, setMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [hasUnread, setHasUnread] = useState(false);
  const [firstTimeHint, setFirstTimeHint] = useState(false);

  // 会话状态
  const [events, setEvents] = useState<ChatEvent[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<"need_plan" | "need_confirm" | null>(null);
  const [context, setContext] = useState<{ section: string; stock?: string } | null>(null);

  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  // 首次加载状态 + 标记 mounted(避免 SSR 闪烁)
  useEffect(() => {
    const s = loadSidebarState();
    setIsOpen(s.isOpen);
    setWidth(s.width);
    setMounted(true);
    // 首次访问加强引导:8 秒高强度 pulse,引诱用户发现
    if (typeof window !== "undefined") {
      const seen = window.localStorage.getItem(SEEN_KEY);
      if (!seen && !s.isOpen) {
        setFirstTimeHint(true);
        const timer = setTimeout(() => {
          setFirstTimeHint(false);
          try {
            window.localStorage.setItem(SEEN_KEY, "1");
          } catch {
            /* ignore */
          }
        }, 8000);
        return () => clearTimeout(timer);
      }
    }
  }, []);

  // 持久化
  useEffect(() => {
    if (mounted) saveSidebarState({ isOpen, width });
  }, [mounted, isOpen, width]);

  // 同步 CSS var,让 AppShell 主内容自动让出空间(不再遮挡)
  useEffect(() => {
    if (!mounted || typeof window === "undefined") return;
    const offset = isOpen ? `${width}px` : `48px`;
    document.documentElement.style.setProperty("--hs-revise-offset", offset);
    return () => {
      document.documentElement.style.removeProperty("--hs-revise-offset");
    };
  }, [mounted, isOpen, width]);

  // ⌘+I / Ctrl+I 切换;Esc 收起
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i") {
        e.preventDefault();
        setIsOpen((p) => !p);
      } else if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);

  // 监听全局 revise:open 事件(让报告页其他位置的 CTA 按钮能触发打开)
  useEffect(() => {
    const onOpen = () => setIsOpen(true);
    window.addEventListener("revise:open", onOpen);
    return () => window.removeEventListener("revise:open", onOpen);
  }, []);

  // F1: 外部"调整"按钮 → 强制展开 + 锁定 context
  useEffect(() => {
    if (triggerNonce > 0 && externalContext) {
      setContext(externalContext);
      setIsOpen(true);
      setHasUnread(false);
    }
  }, [triggerNonce, externalContext]);

  // 收到新事件 + 当前未打开 → 标红点
  useEffect(() => {
    if (!isOpen && events.length > 0) setHasUnread(true);
  }, [events.length, isOpen]);

  // 打开时清红点
  useEffect(() => {
    if (isOpen) setHasUnread(false);
  }, [isOpen]);

  // 自动滚到底
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, isOpen]);

  // 拖拽改宽
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const newWidth = clampWidth(window.innerWidth - e.clientX);
      setWidth(newWidth);
    };
    const onUp = () => {
      if (draggingRef.current) {
        draggingRef.current = false;
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const startDrag = useCallback(() => {
    draggingRef.current = true;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }, []);

  const sendQuick = (text: string) => {
    if (busy) return;
    setInput(text);
    queueMicrotask(() => void doSend(text));
  };

  const doSend = async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || busy) return;

    const cfg = loadConfig();
    const llm = pickReviseProvider(cfg);
    if (!llm) {
      setEvents((p) => [
        ...p,
        { kind: "error", message: "未配置可用的 LLM Provider,请先去「设置 → LLM」配置 API Key" },
      ]);
      return;
    }

    setEvents((p) => [...p, { kind: "user", text }]);
    setInput("");
    setBusy(true);
    setPendingAction(null);

    let assistantBuffer = "";

    try {
      const resp = await fetch(`/api/diagnosis/${sid}/revise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: historyRef.current,
          llm_config: llm,
          context: context ?? undefined,
        }),
      });
      if (!resp.ok || !resp.body) {
        const detail = await resp.text().catch(() => "");
        setEvents((p) => [
          ...p,
          { kind: "error", message: `HTTP ${resp.status}: ${detail.slice(0, 200)}` },
        ]);
        setBusy(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      const findFrameEnd = (s: string): { idx: number; sepLen: number } | null => {
        const crlf = s.indexOf("\r\n\r\n");
        const lflf = s.indexOf("\n\n");
        if (crlf === -1 && lflf === -1) return null;
        if (crlf === -1) return { idx: lflf, sepLen: 2 };
        if (lflf === -1) return { idx: crlf, sepLen: 4 };
        return crlf < lflf ? { idx: crlf, sepLen: 4 } : { idx: lflf, sepLen: 2 };
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let m;
        while ((m = findFrameEnd(buf)) !== null) {
          const frame = buf.slice(0, m.idx);
          buf = buf.slice(m.idx + m.sepLen);

          let evName = "message";
          let dataStr = "";
          for (const rawLine of frame.split(/\r?\n/)) {
            if (rawLine.startsWith("event:")) evName = rawLine.slice(6).trim();
            else if (rawLine.startsWith("data:")) dataStr += rawLine.slice(5).trim();
          }
          if (!dataStr) continue;
          let data: Record<string, unknown> = {};
          try {
            data = JSON.parse(dataStr);
          } catch {
            /* ignore */
          }

          if (evName === "thinking") {
            setEvents((p) => [...p, { kind: "thinking", step: (data.step as number) ?? 0 }]);
          } else if (evName === "tool_call") {
            setEvents((p) => [
              ...p,
              {
                kind: "tool_call",
                name: String(data.name ?? "?"),
                arguments: (data.arguments as Record<string, unknown>) ?? {},
              },
            ]);
          } else if (evName === "tool_result") {
            const tname = String(data.name ?? "?");
            const tresult = (data.result as Record<string, unknown>) ?? {};
            setEvents((p) => [...p, { kind: "tool_result", name: tname, result: tresult }]);
            if (tname === "propose_preference" && tresult.ok) {
              setPendingAction("need_plan");
            } else if (tname === "plan_rerun" && tresult.plan_id) {
              setPendingAction("need_confirm");
            } else if (tname === "confirm_and_apply" && tresult.ok) {
              setPendingAction(null);
            }
          } else if (evName === "message") {
            const t = String(data.text ?? "");
            assistantBuffer = t;
            setEvents((p) => [...p, { kind: "assistant", text: t }]);
          } else if (evName === "rerun_triggered") {
            setEvents((p) => [
              ...p,
              { kind: "rerun_triggered", plan: (data.plan as Record<string, unknown>) ?? {} },
            ]);
          } else if (evName === "error") {
            setEvents((p) => [
              ...p,
              { kind: "error", message: String(data.message ?? "未知错误") },
            ]);
          } else if (evName === "done") {
            historyRef.current.push({ role: "user", content: text });
            if (assistantBuffer) {
              historyRef.current.push({ role: "assistant", content: assistantBuffer });
            }
          }
        }
      }
    } catch (e) {
      setEvents((p) => [
        ...p,
        { kind: "error", message: `请求失败:${e instanceof Error ? e.message : String(e)}` },
      ]);
    } finally {
      setBusy(false);
    }
  };

  // SSR / 首次渲染时不显示,避免闪烁
  if (!mounted) return null;

  const contextLabel = describeContext(context);

  // === collapsed 状态:右侧 48px 窄条(scarlet 配色,首次访问 pulse) ===
  if (!isOpen) {
    const seekAttention = firstTimeHint || hasUnread;
    return (
      <>
        {/* 首次进入,补一个一次性的 tooltip 气泡指向窄条 */}
        {firstTimeHint && (
          <div
            className="fixed right-14 top-1/2 z-40 -translate-y-1/2 animate-fade-in rounded-md border border-ink-300 bg-white px-3 py-2 text-xs text-ink-800 shadow-lg"
          >
            <p className="font-medium">🗡️ 东方不败在此候着</p>
            <p className="mt-0.5 text-ink-500">点击右侧侧栏 或按 ⌘+I 召唤</p>
            <span className="absolute -right-1 top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 border-r border-t border-ink-300 bg-white" />
          </div>
        )}

        <button
          type="button"
          onClick={() => setIsOpen(true)}
          title="召唤东方不败 (⌘+I)"
          className={[
            "group fixed right-0 top-0 z-40 flex h-screen w-12 flex-col items-center justify-start gap-3 py-5 transition-all",
            // 武侠墨色:深墨背景 + 暖金 accent
            "border-l border-amber-700/40 bg-ink-800 text-amber-100 shadow-lg shadow-ink-900/30",
            "hover:w-14 hover:bg-ink-700",
            seekAttention ? "ring-2 ring-amber-400/60 ring-offset-0" : "",
          ].join(" ")}
          aria-label="召唤东方不败"
        >
          {/* icon + 未读点 */}
          <div className="relative">
            <span className="text-2xl drop-shadow">🗡️</span>
            {hasUnread && (
              <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-amber-300 ring-2 ring-ink-800" />
            )}
          </div>

          {/* 竖排标题 */}
          <div className="mt-1 text-sm font-semibold tracking-widest text-amber-100 [writing-mode:vertical-rl]">
            东方不败
          </div>

          {/* context tag */}
          {contextLabel && (
            <div className="mt-2 max-h-40 overflow-hidden rounded border border-amber-700/30 bg-amber-100/10 px-1 py-1.5 text-[11px] text-amber-200 [writing-mode:vertical-rl]">
              🔒 {contextLabel}
            </div>
          )}

          {/* 底部 hint */}
          <div className="mt-auto text-[10px] tracking-widest text-amber-200/60 [writing-mode:vertical-rl]">
            ⌘+I
          </div>
        </button>
      </>
    );
  }

  // === expanded 状态:右侧 sidebar ===
  return (
    <aside
      className="fixed right-0 top-0 z-40 flex h-screen flex-col border-l border-ink-300 bg-white shadow-2xl shadow-ink-900/10"
      style={{ width: `${width}px` }}
    >
      {/* 拖拽手柄 */}
      <div
        onMouseDown={startDrag}
        className="absolute left-0 top-0 h-full w-1 cursor-col-resize transition-colors hover:bg-amber-400/40"
        title="拖动改变宽度"
      />

      {/* Header - 深墨色,武侠风 */}
      <div className="flex items-center justify-between border-b border-amber-700/30 bg-ink-800 px-4 py-3 text-amber-100">
        <div className="flex items-center gap-2">
          <span className="text-base">🗡️</span>
          <div className="flex flex-col leading-tight">
            <h3 className="text-sm font-semibold text-amber-50">东方不败</h3>
            <span className="text-[10px] text-amber-200/70">诊股修订 · 懒得寒暄</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          title="收起 (Esc)"
          className="rounded p-1 text-amber-200/70 hover:bg-ink-700 hover:text-amber-100"
          aria-label="收起"
        >
          ✕
        </button>
      </div>

      {/* 锁定 context 条 */}
      {context && (
        <div className="flex items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-900">
          <span>
            🔒 锁定到 <strong>{contextLabel}</strong>
            {context.stock && <span> · {context.stock}</span>}
          </span>
          <button
            type="button"
            onClick={() => setContext(null)}
            className="text-amber-700 hover:text-amber-900"
            title="解除锁定"
          >
            解除
          </button>
        </div>
      )}

      {/* 消息流 */}
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-3 text-sm">
        {events.length === 0 && <EmptyHint />}
        {events.map((ev, i) => (
          <EventLine key={i} ev={ev} />
        ))}
        {busy && <div className="text-xs text-ink-400">思考中…</div>}
      </div>

      {/* 输入区 */}
      <div className="border-t border-ink-200 px-3 py-2">
        {!busy && pendingAction === "need_plan" && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => sendQuick("请调用 plan_rerun 给我看执行计划")}
              className="rounded-full bg-blue-100 px-3 py-1 text-xs text-blue-800 hover:bg-blue-200"
            >
              ▶️ 看执行计划
            </button>
            <button
              type="button"
              onClick={() => sendQuick("措辞我想再改改,你重新提议一次")}
              className="rounded-full bg-ink-100 px-3 py-1 text-xs text-ink-700 hover:bg-ink-200"
            >
              ✏️ 让我改改
            </button>
            <button
              type="button"
              onClick={() => sendQuick("不要这条偏好了,放弃")}
              className="rounded-full bg-ink-100 px-3 py-1 text-xs text-ink-700 hover:bg-ink-200"
            >
              ❌ 算了
            </button>
          </div>
        )}
        {!busy && pendingAction === "need_confirm" && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => sendQuick("确认,就这样应用")}
              className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
            >
              ✅ 确认应用
            </button>
            <button
              type="button"
              onClick={() => sendQuick("范围我想调一下,先别确认")}
              className="rounded-full bg-ink-100 px-3 py-1 text-xs text-ink-700 hover:bg-ink-200"
            >
              ⚙️ 调整范围
            </button>
            <button
              type="button"
              onClick={() => sendQuick("不应用了,放弃这次修订")}
              className="rounded-full bg-ink-100 px-3 py-1 text-xs text-ink-700 hover:bg-ink-200"
            >
              ❌ 不改了
            </button>
          </div>
        )}

        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void doSend();
              }
            }}
            placeholder={busy ? "等待回复中…" : "对诊股结果有什么想调整?(Enter 发送 · Shift+Enter 换行)"}
            disabled={busy}
            rows={2}
            className="flex-1 resize-none rounded border border-ink-200 px-2 py-1 text-sm focus:border-scarlet-500 focus:outline-none disabled:bg-ink-50"
          />
          <button
            type="button"
            onClick={() => void doSend()}
            disabled={busy || !input.trim()}
            className="self-end rounded bg-ink-800 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-ink-700 disabled:bg-ink-300 disabled:text-ink-100"
          >
            发送
          </button>
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[10px] text-ink-400">
          <span>⌘+I 开关 · Esc 收起</span>
          <span>{width}px</span>
        </div>
      </div>
    </aside>
  );
}

function EmptyHint() {
  return (
    <div className="rounded-md border border-ink-200 bg-ink-50 p-3 text-xs leading-relaxed text-ink-600">
      <p className="font-medium text-ink-700">说话吧,别客气。</p>
      <p className="mt-1 text-ink-500">几个常见姿势:</p>
      <ul className="mt-1 space-y-0.5">
        <li>· 「技术分析师对这只票太乐观了」</li>
        <li>· 「风控太激进,所有买入建议降一档」</li>
        <li>· 「RSI 超 80 时给我明确标超买」</li>
      </ul>
      <p className="mt-2 text-ink-500">
        我会:看 → 提议 → 等你说「确认」才动手。
        <br />
        说过的话会变成偏好,以后我懒得每次都问你。
      </p>
      <p className="mt-2 text-[11px] text-ink-400">
        想精确点,就从报告里每段的 [💬 调整] 按钮进来,我自动锁定到那一段。
      </p>
    </div>
  );
}

function EventLine({ ev }: { ev: ChatEvent }) {
  if (ev.kind === "user") {
    return (
      <div className="ml-8 rounded-md bg-amber-100 px-3 py-2 text-amber-900">
        {ev.text}
      </div>
    );
  }
  if (ev.kind === "assistant") {
    return (
      <div className="mr-8 whitespace-pre-wrap rounded-md bg-ink-50 px-3 py-2 text-ink-800">
        {ev.text}
      </div>
    );
  }
  if (ev.kind === "thinking") {
    return <div className="text-xs text-ink-400">· 思考中 (步骤 {ev.step + 1})</div>;
  }
  if (ev.kind === "tool_call") {
    return (
      <div className="rounded border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs text-blue-800">
        <span className="font-mono font-semibold">{ev.name}</span>
        <span className="ml-1 text-blue-600">
          ({Object.keys(ev.arguments).join(", ") || "无参"})
        </span>
      </div>
    );
  }
  if (ev.kind === "tool_result") {
    const isProposal = ev.name === "propose_preference" && (ev.result as { ok?: boolean }).ok;
    const isPlan = ev.name === "plan_rerun";
    const isConfirm = ev.name === "confirm_and_apply" && (ev.result as { ok?: boolean }).ok;
    let cls = "border-ink-200 bg-white text-ink-700";
    if (isProposal) cls = "border-amber-300 bg-amber-50 text-amber-900";
    else if (isPlan) cls = "border-blue-300 bg-blue-50 text-blue-900";
    else if (isConfirm) cls = "border-emerald-300 bg-emerald-50 text-emerald-900";
    return (
      <div className={`rounded border px-2 py-1.5 text-xs ${cls}`}>
        <div className="font-mono font-semibold">→ {ev.name}</div>
        <pre className="mt-1 whitespace-pre-wrap break-all text-[11px] leading-tight">
          {JSON.stringify(ev.result, null, 2)}
        </pre>
      </div>
    );
  }
  if (ev.kind === "rerun_triggered") {
    return (
      <div className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-900">
        🚀 已触发局部重跑(报告页会显示「修订中」)
      </div>
    );
  }
  if (ev.kind === "error") {
    return (
      <div className="rounded border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-800">
        ⚠️ {ev.message}
      </div>
    );
  }
  return null;
}
