from typing import Literal

from pydantic import BaseModel, Field


class LLMConfigPayload(BaseModel):
    """前端从 localStorage 读出来的临时 LLM 配置，用完即弃。"""
    provider: str
    api_key: str
    model: str
    base_url: str | None = None


class DiagnosisStartRequest(BaseModel):
    portfolio_id: str = Field(..., description="先调 /api/portfolio/parse 拿到")
    masters: list[str] = Field(default_factory=list, description="选中的大师 slug，2-3 位")
    llm: LLMConfigPayload


class DiagnosisStartResponse(BaseModel):
    diagnosis_id: str
    stream_url: str


class DiagnosisReportResponse(BaseModel):
    diagnosis_id: str
    status: Literal["pending", "running", "done", "failed"]
    report: dict | None = None
    error: str | None = None
    mode: Literal["single", "batch", "portfolio"] | None = None
    stocks: list[dict] = Field(default_factory=list)
    events: list[dict] = Field(default_factory=list)


class DiagnosisTaskSummary(BaseModel):
    diagnosis_id: str
    status: Literal["pending", "running", "done", "failed"]
    mode: Literal["single", "batch", "portfolio"] | None = None
    stocks: list[dict] = Field(default_factory=list)
    masters: list[str] = Field(default_factory=list)
    created_at: str
    finished_at: str | None = None
    error: str | None = None


class ShareCreateRequest(BaseModel):
    expires_days: int | None = Field(None, ge=1, le=365)


class ShareCreateResponse(BaseModel):
    code: str
    url: str


class ShareReportResponse(DiagnosisReportResponse):
    share_code: str
    visit_count: int
