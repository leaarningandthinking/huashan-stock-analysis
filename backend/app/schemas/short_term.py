from pydantic import BaseModel, Field

from app.schemas.diagnosis import LLMConfigPayload


class ShortTermAnalyzeRequest(BaseModel):
    code: str = Field(..., min_length=6, max_length=12)
    name: str | None = None
    llm: LLMConfigPayload


class ShortTermStartResponse(BaseModel):
    task_id: str
    status: str


class KeyPriceLevel(BaseModel):
    label: str
    price: float
    kind: str
    note: str


class ShortTermSnapshot(BaseModel):
    date: str
    close: float
    change_pct_5d: float | None = None
    change_pct_20d: float | None = None
    ma5: float | None = None
    ma10: float | None = None
    ma20: float | None = None
    ma60: float | None = None
    ma120: float | None = None
    rsi14: float | None = None
    macd_diff: float | None = None
    macd_dea: float | None = None
    macd_hist: float | None = None
    volume_ratio_vs_20d: float | None = None
    trend: str
    momentum: str
    volume_state: str


class ShortTermCandle(BaseModel):
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: float | None = None
    ma20: float | None = None
    ma60: float | None = None


class ShortTermAnalyzeResponse(BaseModel):
    task_id: str | None = None
    code: str
    name: str
    snapshot: ShortTermSnapshot
    levels: list[KeyPriceLevel]
    chart: list[ShortTermCandle]
    ai_analysis: str
    risk_notice: str = "短线分析只用于研究和交易计划校验，不构成投资建议。"


class ShortTermTaskSummary(BaseModel):
    task_id: str
    status: str
    code: str
    name: str
    created_at: str
    finished_at: str | None = None
    error: str | None = None


class ShortTermTaskReportResponse(BaseModel):
    task_id: str
    status: str
    report: ShortTermAnalyzeResponse | None = None
    error: str | None = None


class ShortTermShareCreateResponse(BaseModel):
    code: str
    url: str


class ShortTermShareReportResponse(ShortTermTaskReportResponse):
    share_code: str
    visit_count: int
