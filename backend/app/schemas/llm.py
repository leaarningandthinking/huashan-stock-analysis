from pydantic import BaseModel, Field


class ModelOption(BaseModel):
    id: str
    label: str
    notes: str = ""


class ProviderMeta(BaseModel):
    id: str
    name: str
    description: str
    homepage: str
    default_base_url: str
    base_url_editable: bool
    models: list[ModelOption]
    api_key_format_hint: str
    docs_url: str


class LLMTestRequest(BaseModel):
    """前端把用户填的 key 发过来做一次最小连通性测试。"""

    provider: str = Field(..., description="provider id, e.g. 'deepseek' / 'spark_maas'")
    api_key: str = Field(..., min_length=1)
    model: str = Field(..., min_length=1)
    base_url: str | None = Field(None, description="自定义 base_url，留空用默认")


class LLMTestResponse(BaseModel):
    ok: bool
    latency_ms: int
    sample: str = ""
    model: str = ""
    error: str | None = None
