import { apiGet, apiPost } from "@/lib/api";

export interface DiagnosisStartRequest {
  portfolio_id: string;
  masters: string[];
  llm: {
    provider: string;
    api_key: string;
    model: string;
    base_url?: string;
  };
}

export interface PersonalizationPreview {
  preference_count: number;
  preference_by_scope: { global: number; analyst: number; master: number; risk: number };
  profile_version: number;
  profile_summary: string | null;
  is_first_diagnosis: boolean;
}

export interface DiagnosisStartResponse {
  diagnosis_id: string;
  stream_url: string;
  personalization?: PersonalizationPreview | null;
}

export function getDiagnosisPreview(): Promise<PersonalizationPreview> {
  return apiGet<PersonalizationPreview>("/api/profile/diagnosis_preview");
}

export interface DiagnosisReportResponse {
  diagnosis_id: string;
  status: "pending" | "running" | "done" | "failed";
  report: Record<string, unknown> | null;
  error?: string | null;
  mode?: "single" | "batch" | "portfolio" | null;
  stocks?: { code: string; name: string }[];
  events?: { id?: string | number; event?: string; data?: unknown }[];
}

export interface DiagnosisTaskSummary {
  diagnosis_id: string;
  status: "pending" | "running" | "done" | "failed";
  mode: "single" | "batch" | "portfolio" | null;
  stocks: { code: string; name: string }[];
  masters: string[];
  created_at: string;
  finished_at: string | null;
  error: string | null;
}

export interface ShareCreateResponse {
  code: string;
  url: string;
}

export interface ShareReportResponse extends DiagnosisReportResponse {
  share_code: string;
  visit_count: number;
}

export function startDiagnosis(
  req: DiagnosisStartRequest,
): Promise<DiagnosisStartResponse> {
  return apiPost<DiagnosisStartResponse>("/api/diagnosis/start", req);
}

export function getDiagnosisReport(sid: string): Promise<DiagnosisReportResponse> {
  return apiGet<DiagnosisReportResponse>(`/api/diagnosis/${sid}`);
}

export function listDiagnosisTasks(): Promise<DiagnosisTaskSummary[]> {
  return apiGet<DiagnosisTaskSummary[]>("/api/diagnosis");
}

export function createShareLink(sid: string): Promise<ShareCreateResponse> {
  return apiPost<ShareCreateResponse>(`/api/diagnosis/${sid}/share`, {});
}

export function getSharedReport(code: string): Promise<ShareReportResponse> {
  return apiGet<ShareReportResponse>(`/api/share/${code}`);
}
