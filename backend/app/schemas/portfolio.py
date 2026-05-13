from typing import Literal

from pydantic import BaseModel, Field


class HoldingInput(BaseModel):
    """单只持仓的用户输入。市值 / 持仓占比 是可选的，缺了我们自己算。"""

    code: str = Field(..., min_length=1, max_length=16)
    shares: float | None = Field(None, ge=0, description="持仓数量")
    cost: float | None = Field(None, ge=0, description="成本价")
    value: float | None = Field(None, ge=0, description="当前市值（如直接给）")
    weight: float | None = Field(None, ge=0, le=1, description="持仓占比 0-1")


class PortfolioParseRequest(BaseModel):
    mode: Literal["single", "batch", "portfolio"]
    # 三种输入方式择一
    manual: list[HoldingInput] | None = None
    text: str | None = None
    # 单股 / 批量 模式只有代码列表
    codes: list[str] | None = None


class HoldingItem(BaseModel):
    code: str
    name: str
    exchange: str
    shares: float | None = None
    cost: float | None = None
    value: float | None = None
    weight: float | None = None
    pnl: float | None = None  # 浮动盈亏率
    valid: bool = True
    warning: str | None = None


class PortfolioOverview(BaseModel):
    total_count: int
    total_value: float | None = None
    concentration_top3: float | None = None  # 前 3 大持仓合计权重
    overall_pnl: float | None = None         # 整体盈亏率（按市值加权）


class PortfolioParseResponse(BaseModel):
    portfolio_id: str
    mode: Literal["single", "batch", "portfolio"]
    holdings: list[HoldingItem]
    overview: PortfolioOverview
    warnings: list[str] = []
