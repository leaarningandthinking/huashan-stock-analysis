from pydantic import BaseModel


class MasterSummary(BaseModel):
    slug: str
    name: str
    tagline: str
    school: str  # 'huaren' | 'western' | 'technical'
    school_label: str
    avatar_url: str | None = None


class MasterDetail(MasterSummary):
    methodology: str
    keywords: list[str]
    quotes: list[str]
    checkpoints: list[str]
    typical_critique: str
    output_style: str
    raw_markdown: str  # 原始 markdown，前端可选展示
