/**
 * SSE 客户端封装。
 *
 * 浏览器原生 EventSource 不支持自定义 Header / POST，但我们用 GET 即可
 * （diagnosis 的状态已经先通过 POST /start 创建）。这套设计的好处：
 *   - GET URL 简单：/api/diagnosis/{id}/stream
 *   - 浏览器 EventSource 自带断线重连
 *
 * 事件协议见 backend/app/core/sse.py。
 */

export type SSEHandler = (event: string, data: any, eventId?: string) => void;

export interface SSEClient {
  close: () => void;
}

const DEFAULT_EVENTS = [
  "step.start",
  "step.done",
  "step.skip",
  "analyst.start",
  "analyst.delta",
  "analyst.done",
  "analyst.fail",
  "debate.lineup",
  "debate.round_start",
  "debate.round_done",
  "master.start",
  "master.delta",
  "master.done",
  "risk.start",
  "risk.delta",
  "risk.done",
  "manager.start",
  "manager.delta",
  "manager.done",
  "summary.start",
  "summary.delta",
  "summary.done",
  "report.ready",
  "diagnosis.context",
  "error",
] as const;

export function openSSE(
  url: string,
  onEvent: SSEHandler,
  events: readonly string[] = DEFAULT_EVENTS,
): SSEClient {
  const es = new EventSource(url);

  for (const ev of events) {
    es.addEventListener(ev, (e) => {
      const me = e as MessageEvent;
      // EventSource 的原生 error 事件不是 MessageEvent，没有 data 字段
      if (typeof me.data !== "string") return;
      let parsed: any = me.data;
      try {
        parsed = JSON.parse(me.data);
      } catch {
        // 留原文本
      }
      onEvent(ev, parsed, me.lastEventId);
    });
  }

  es.onerror = () => {
    // EventSource 断线时浏览器会自动重连；用单独的事件名避免和应用层 'error' 撞车
    onEvent("__connection_error__", { state: "disconnected" });
  };

  return {
    close: () => es.close(),
  };
}
