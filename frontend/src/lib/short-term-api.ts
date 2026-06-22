import { apiGet, apiPost } from "@/lib/api";

export interface ShortTermLevel {
  label: string;
  price: number;
  kind: "support" | "resistance" | "current" | string;
  note: string;
}

export interface ShortTermSnapshot {
  date: string;
  close: number;
  change_pct_5d: number | null;
  change_pct_20d: number | null;
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  ma60: number | null;
  ma120: number | null;
  rsi14: number | null;
  macd_diff: number | null;
  macd_dea: number | null;
  macd_hist: number | null;
  volume_ratio_vs_20d: number | null;
  trend: string;
  momentum: string;
  volume_state: string;
}

export interface ShortTermAnalyzeRequest {
  code: string;
  name?: string;
  llm: {
    provider: string;
    api_key: string;
    model: string;
    base_url?: string;
  };
}

export interface ShortTermCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  ma20: number | null;
  ma60: number | null;
}

export interface ShortTermAnalyzeResponse {
  task_id?: string | null;
  code: string;
  name: string;
  snapshot: ShortTermSnapshot;
  levels: ShortTermLevel[];
  chart: ShortTermCandle[];
  ai_analysis: string;
  risk_notice: string;
}

export interface ShortTermStartResponse {
  task_id: string;
  status: string;
}

export interface ShortTermTaskSummary {
  task_id: string;
  status: "pending" | "running" | "done" | "failed" | string;
  code: string;
  name: string;
  created_at: string;
  finished_at: string | null;
  error: string | null;
}

export interface ShortTermTaskReportResponse {
  task_id: string;
  status: "pending" | "running" | "done" | "failed" | string;
  report: ShortTermAnalyzeResponse | null;
  error: string | null;
}

export interface ShortTermShareCreateResponse {
  code: string;
  url: string;
}

export interface ShortTermShareReportResponse extends ShortTermTaskReportResponse {
  share_code: string;
  visit_count: number;
}

export function analyzeShortTerm(
  req: ShortTermAnalyzeRequest,
): Promise<ShortTermAnalyzeResponse> {
  return apiPost<ShortTermAnalyzeResponse>("/api/short-term/analyze", req);
}

export function startShortTermAnalysis(
  req: ShortTermAnalyzeRequest,
): Promise<ShortTermStartResponse> {
  return apiPost<ShortTermStartResponse>("/api/short-term/start", req);
}

export function listShortTermTasks(): Promise<ShortTermTaskSummary[]> {
  return apiGet<ShortTermTaskSummary[]>("/api/short-term");
}

export function getShortTermReport(taskId: string): Promise<ShortTermTaskReportResponse> {
  return apiGet<ShortTermTaskReportResponse>(`/api/short-term/${taskId}`);
}

export function createShortTermShareLink(taskId: string): Promise<ShortTermShareCreateResponse> {
  return apiPost<ShortTermShareCreateResponse>(`/api/short-term/${taskId}/share`, {});
}

export function getSharedShortTermReport(code: string): Promise<ShortTermShareReportResponse> {
  return apiGet<ShortTermShareReportResponse>(`/api/short-term/share/${code}`);
}
