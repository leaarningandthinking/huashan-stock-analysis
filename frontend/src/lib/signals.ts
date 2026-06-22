/**
 * L2 行为信号上报。
 *
 * 设计:失败静默,绝不影响 UX。
 * 用 keepalive: true 让浏览器在 beforeunload 时也能发出去。
 */

export type SignalType =
  | "report_viewed"
  | "master_endorsed"
  | "risk_school_followed"
  | "stock_action"
  | "session_engagement"
  | "revision_clicked";

export async function reportSignal(
  type: SignalType,
  payload: Record<string, unknown> = {},
  diagnosisId?: string,
): Promise<void> {
  try {
    await fetch("/api/signals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true, // beforeunload 也能送出去
      body: JSON.stringify({
        type,
        payload,
        diagnosis_id: diagnosisId,
      }),
    });
  } catch {
    /* 失败静默,绝不影响 UX */
  }
}

/**
 * 报告页停留时长追踪 hook。
 *
 * 用 useEffect 在 mount 时记录开始时间;在 unmount 或 beforeunload 时
 * 用 reportSignal("report_viewed", { view_duration_sec, max_scroll }) 上报。
 */
import { useEffect, useRef } from "react";

export function useReportViewedTracker(diagnosisId: string | undefined): void {
  const startAtRef = useRef<number>(Date.now());
  const maxScrollRef = useRef<number>(0);

  useEffect(() => {
    if (!diagnosisId) return;
    startAtRef.current = Date.now();
    maxScrollRef.current = 0;

    const onScroll = () => {
      const ratio =
        document.documentElement.scrollTop /
        Math.max(
          1,
          document.documentElement.scrollHeight - document.documentElement.clientHeight,
        );
      if (ratio > maxScrollRef.current) {
        maxScrollRef.current = Math.min(1, ratio);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    const flush = () => {
      const durationSec = Math.round((Date.now() - startAtRef.current) / 1000);
      if (durationSec < 2) return; // 太短不算
      void reportSignal(
        "report_viewed",
        {
          view_duration_sec: durationSec,
          max_scroll: Number(maxScrollRef.current.toFixed(2)),
        },
        diagnosisId,
      );
    };

    window.addEventListener("beforeunload", flush);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [diagnosisId]);
}
