"""基本面 service：财务摘要 + 估值。

数据源选型：
- 财务摘要：stock_financial_abstract（新浪源，稳定）
- 估值：stock_zh_valuation_baidu（百度源，稳定）
  - 总市值、PE-TTM、PE-静、PB、市现率
  - 市销率/股息率百度源不稳，跳过
"""

from __future__ import annotations

import asyncio
import logging

import akshare as ak
import pandas as pd
import yfinance as yf

from app.data.akshare_client import DataSourceError, call
from app.data.cache import cache_get, cache_set
from app.data.symbols import CODE_RE

logger = logging.getLogger(__name__)

CACHE_TTL = 60 * 60 * 6  # 6 小时
VALUATION_TTL = 60 * 60  # 估值数据 1 小时（盘中可能变）

VALUATION_INDICATORS = ["总市值", "市盈率(TTM)", "市盈率(静)", "市净率", "市现率"]

YF_PREFERRED_INDICATORS = [
    "Total Revenue",
    "Gross Profit",
    "Operating Income",
    "Pretax Income",
    "Net Income",
    "EBITDA",
    "Operating Cash Flow",
    "Free Cash Flow",
    "Capital Expenditure",
    "Cash And Cash Equivalents",
    "Cash Cash Equivalents And Short Term Investments",
    "Total Debt",
    "Net Debt",
    "Total Assets",
    "Total Liabilities Net Minority Interest",
    "Stockholders Equity",
    "Current Assets",
    "Current Liabilities",
]


async def _fetch_one_valuation(code: str, indicator: str) -> dict | None:
    """单个估值指标。"""
    try:
        df: pd.DataFrame = await call(
            ak.stock_zh_valuation_baidu,
            symbol=code, indicator=indicator, period="近一年",
        )
    except DataSourceError as e:
        logger.warning("valuation %s/%s failed: %s", code, indicator, e)
        return None
    if df is None or df.empty:
        return None
    last = df.iloc[-1]
    return {
        "indicator": indicator,
        "latest": float(last.iloc[1]) if pd.notna(last.iloc[1]) else None,
        "date": str(last.iloc[0]),
    }


async def get_valuation(code: str) -> dict | None:
    """近一年估值快照：总市值 / PE / PB / 市现率。"""
    cache_key = f"fundamentals:valuation:{code}"
    if not CODE_RE.match(code):
        cache_key = f"fundamentals:valuation:yf:v3:{code}"
    if (c := await cache_get(cache_key)) is not None:
        return c

    if not CODE_RE.match(code):
        try:
            info = yf.Ticker(code).get_info()
        except Exception as e:
            logger.warning("yfinance valuation %s failed: %s", code, e)
            return None
        metrics = {
            "总市值": _to_yi(info.get("marketCap")),
            "市盈率(TTM)": info.get("trailingPE"),
            "市净率": info.get("priceToBook"),
            "股息率": _normalize_dividend_yield(info.get("dividendYield")),
        }
        quality_flags = []
        dividend_yield = metrics.get("股息率")
        if dividend_yield is not None and dividend_yield > 20:
            quality_flags.append({
                "field": "股息率",
                "value": dividend_yield,
                "message": "股息率显著高于常规水平，可能是特别股息、统计口径差异或数据源异常；分析时只能作为待核实信息。",
            })
        result = {
            "code": code,
            "as_of": None,
            "source": "yfinance",
            "metrics": metrics,
            "quality_flags": quality_flags,
        }
        await cache_set(cache_key, result, VALUATION_TTL)
        return result

    results = await asyncio.gather(
        *(_fetch_one_valuation(code, ind) for ind in VALUATION_INDICATORS),
        return_exceptions=False,
    )
    metrics: dict[str, float | None] = {}
    date = None
    for ind, item in zip(VALUATION_INDICATORS, results):
        if item is not None:
            metrics[ind] = item["latest"]
            date = date or item["date"]

    if not metrics:
        return None

    result = {"code": code, "as_of": date, "metrics": metrics}
    await cache_set(cache_key, result, VALUATION_TTL)
    return result


async def get_financial_abstract(code: str) -> dict | None:
    """近 N 期财务摘要：营收 / 净利润 / ROE / 毛利率 / 资产负债率 等关键指标。"""
    cache_key = f"fundamentals:abstract:{code}"
    if not CODE_RE.match(code):
        cache_key = f"fundamentals:abstract:yf:v3:{code}"
    if (c := await cache_get(cache_key)) is not None:
        return c

    if not CODE_RE.match(code):
        try:
            ticker = yf.Ticker(code)
            financials = _merge_yfinance_frames(
                ("半年度/季度", ticker.quarterly_financials),
                ("年度", ticker.financials),
            )
            cashflow = _merge_yfinance_frames(
                ("半年度/季度", ticker.quarterly_cashflow),
                ("年度", ticker.cashflow),
            )
            balance_sheet = _merge_yfinance_frames(
                ("半年度/季度", ticker.quarterly_balance_sheet),
                ("年度", ticker.balance_sheet),
            )
        except Exception as e:
            logger.warning("yfinance financial_abstract %s failed: %s", code, e)
            return None
        rows = []
        periods = set()
        for label, frame_rows in [
            ("利润表", financials),
            ("现金流量表", cashflow),
            ("资产负债表", balance_sheet),
        ]:
            for row in frame_rows:
                values = row["values"]
                periods.update(values.keys())
                rows.append({"category": label, **row})
        if not rows:
            return None
        result = {
            "code": code,
            "source": "yfinance",
            "periods": sorted(periods, reverse=True),
            "rows": rows,
        }
        await cache_set(cache_key, result, CACHE_TTL)
        return result

    try:
        df: pd.DataFrame = await call(ak.stock_financial_abstract, symbol=code)
    except DataSourceError as e:
        logger.warning("financial_abstract %s failed: %s", code, e)
        return None

    if df is None or df.empty:
        return None

    # 取近 4 期（最新 4 列）
    period_cols = [c for c in df.columns if c not in ("选项", "指标")]
    period_cols = sorted(period_cols, reverse=True)[:4]

    rows: list[dict] = []
    for _, row in df.iterrows():
        indicator = str(row.get("指标", "")).strip()
        category = str(row.get("选项", "")).strip()
        if not indicator:
            continue
        values: dict[str, str] = {}
        for col in period_cols:
            v = row.get(col)
            if pd.notna(v):
                values[col] = str(v)
        if values:
            rows.append({"category": category, "indicator": indicator, "values": values})

    result = {"code": code, "periods": period_cols, "rows": rows[:30]}
    await cache_set(cache_key, result, CACHE_TTL)
    return result


async def get_industry_valuation(code: str) -> dict | None:
    """个股所属申万二级行业的估值快照（PE/PB/股息率等）。委托 industry 模块。"""
    if not CODE_RE.match(code):
        return None
    from app.data.industry import get_industry_valuation as _get
    return await _get(code)


def _to_yi(value) -> float | None:
    try:
        return float(value) / 100_000_000
    except (TypeError, ValueError):
        return None


def _to_percent(value) -> float | None:
    try:
        return float(value) * 100
    except (TypeError, ValueError):
        return None


def _normalize_dividend_yield(value) -> float | None:
    try:
        raw = float(value)
    except (TypeError, ValueError):
        return None
    if raw <= 0:
        return None
    if raw <= 1:
        return raw * 100
    return raw


def _merge_yfinance_frames(*frames: tuple[str, pd.DataFrame | None], max_periods: int = 4) -> list[dict]:
    merged: dict[str, dict[str, str]] = {}
    period_order_by_frequency: dict[str, list[str]] = {}
    for frequency, frame in frames:
        if frame is None or frame.empty:
            continue
        frequency_periods = period_order_by_frequency.setdefault(frequency, [])
        ordered = [x for x in YF_PREFERRED_INDICATORS if x in frame.index]
        for indicator in ordered:
            series = frame.loc[indicator]
            for period, value in series.items():
                if pd.isna(value):
                    continue
                period_key = _format_period(period, frequency)
                if period_key not in frequency_periods:
                    frequency_periods.append(period_key)
                merged.setdefault(str(indicator), {})[period_key] = _format_number(value)

    selected_periods = []
    per_frequency_limit = max(1, max_periods // max(1, len(period_order_by_frequency)))
    for periods in period_order_by_frequency.values():
        for period in periods[:per_frequency_limit]:
            if period not in selected_periods:
                selected_periods.append(period)
    if len(selected_periods) < max_periods:
        for periods in period_order_by_frequency.values():
            for period in periods:
                if period not in selected_periods:
                    selected_periods.append(period)
                if len(selected_periods) >= max_periods:
                    break
            if len(selected_periods) >= max_periods:
                break

    rows = []
    for indicator in YF_PREFERRED_INDICATORS:
        values = merged.get(indicator)
        if not values:
            continue
        filtered = {period: values[period] for period in selected_periods if period in values}
        if filtered:
            rows.append({"indicator": indicator, "values": filtered})
    return rows


def _format_period(value, frequency: str) -> str:
    date_text = str(value.date() if hasattr(value, "date") else value)
    return f"{date_text}（{frequency}）"


def _format_number(value) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return str(value)
    if abs(number) >= 100_000_000:
        return f"{number / 100_000_000:.2f}亿"
    if abs(number) >= 10_000:
        return f"{number / 10_000:.2f}万"
    return f"{number:.2f}"
