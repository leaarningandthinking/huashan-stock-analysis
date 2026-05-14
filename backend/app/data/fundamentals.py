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
from app.data.symbols import CODE_RE, with_prefix

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

A_SHARE_PREFERRED_KEYWORDS = [
    "营业收入",
    "营业总收入",
    "营收",
    "净利润",
    "归母净利润",
    "扣非净利润",
    "毛利率",
    "净利率",
    "净资产收益率",
    "ROE",
    "每股收益",
    "经营现金流",
    "经营活动产生的现金流量净额",
    "现金流量净额",
    "资产负债率",
    "总资产",
    "总负债",
    "货币资金",
    "股东权益",
    "商誉",
]

A_SHARE_STATEMENT_INDICATORS = {
    "利润表": [
        "营业总收入",
        "营业收入",
        "营业总成本",
        "营业成本",
        "营业利润",
        "利润总额",
        "净利润",
        "归属于母公司所有者的净利润",
        "归母净利润",
        "扣除非经常性损益后的净利润",
        "基本每股收益",
    ],
    "现金流量表": [
        "经营活动产生的现金流量净额",
        "投资活动产生的现金流量净额",
        "筹资活动产生的现金流量净额",
        "现金及现金等价物净增加额",
        "期末现金及现金等价物余额",
    ],
    "资产负债表": [
        "货币资金",
        "应收账款",
        "存货",
        "流动资产合计",
        "资产总计",
        "短期借款",
        "应付账款",
        "流动负债合计",
        "负债合计",
        "所有者权益合计",
        "归属于母公司所有者权益合计",
    ],
}


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
            ticker = yf.Ticker(code)
            info = ticker.get_info()
        except Exception as e:
            logger.warning("yfinance valuation %s failed: %s", code, e)
            return None
        raw_dividend_yield = _normalize_dividend_yield(info.get("dividendYield"))
        dividend_yield = raw_dividend_yield
        quality_flags = []
        if dividend_yield is not None and dividend_yield > 20:
            derived_yield = _derive_dividend_yield_from_history(ticker, info)
            if derived_yield is not None and derived_yield <= 20:
                dividend_yield = derived_yield
                quality_flags.append({
                    "field": "股息率",
                    "value": raw_dividend_yield,
                    "message": (
                        "yfinance 摘要股息率显著高于常规水平，已改用最近现金分红/价格推导的口径；"
                        "仍需结合公告核实是否包含特别股息。"
                    ),
                })
            else:
                dividend_yield = None
                quality_flags.append({
                    "field": "股息率",
                    "value": raw_dividend_yield,
                    "message": (
                        "yfinance 摘要股息率显著高于常规水平，可能是特别股息、统计口径差异或数据源异常；"
                        "本次不把该值作为可靠估值指标。"
                    ),
                })
        metrics = {
            "总市值": _to_yi(info.get("marketCap")),
            "市盈率(TTM)": info.get("trailingPE"),
            "市净率": info.get("priceToBook"),
            "股息率": dividend_yield,
        }
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
    cache_key = f"fundamentals:abstract:v3:{code}"
    if not CODE_RE.match(code):
        cache_key = f"fundamentals:abstract:yf:v3:{code}"
    if (c := await cache_get(cache_key)) is not None:
        return c

    if not CODE_RE.match(code):
        try:
            ticker = yf.Ticker(code)
            financials = _merge_yfinance_frames(
                ("半年度/季度", _first_yfinance_frame(ticker, "quarterly_income_stmt", "quarterly_financials")),
                ("年度", _first_yfinance_frame(ticker, "income_stmt", "financials")),
            )
            cashflow = _merge_yfinance_frames(
                ("半年度/季度", _first_yfinance_frame(ticker, "quarterly_cashflow")),
                ("年度", _first_yfinance_frame(ticker, "cashflow")),
            )
            balance_sheet = _merge_yfinance_frames(
                ("半年度/季度", _first_yfinance_frame(ticker, "quarterly_balance_sheet")),
                ("年度", _first_yfinance_frame(ticker, "balance_sheet")),
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
            "quality_notes": _build_yfinance_quality_notes(rows),
        }
        await cache_set(cache_key, result, CACHE_TTL)
        return result

    try:
        statement_rows, df = await asyncio.gather(
            _fetch_a_share_core_statements(code),
            call(ak.stock_financial_abstract, symbol=code),
            return_exceptions=False,
        )
    except DataSourceError as e:
        logger.warning("financial_abstract %s failed: %s", code, e)
        statement_rows = await _fetch_a_share_core_statements(code)
        df = None

    if (df is None or df.empty) and not statement_rows:
        return None

    abstract_rows: list[dict] = []
    period_cols: list[str] = []
    if df is not None and not df.empty:
        # 取近 4 期（最新 4 列）
        period_cols = [c for c in df.columns if c not in ("选项", "指标")]
        period_cols = sorted(period_cols, reverse=True)[:4]

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
                abstract_rows.append({"category": category, "indicator": indicator, "values": values})

    rows = statement_rows + _select_a_share_financial_rows(abstract_rows, max_rows=30)
    periods = _collect_periods(rows) or period_cols
    result = {
        "code": code,
        "source": "akshare",
        "periods": periods[:4],
        "rows": rows,
    }
    await cache_set(cache_key, result, CACHE_TTL)
    return result


async def _fetch_a_share_core_statements(code: str) -> list[dict]:
    fn = getattr(ak, "stock_financial_report_sina", None)
    if fn is None:
        logger.warning("akshare stock_financial_report_sina is not available")
        return []

    async def fetch_one(category: str) -> list[dict]:
        try:
            df: pd.DataFrame = await call(fn, stock=with_prefix(code), symbol=category)
        except DataSourceError as e:
            logger.warning("a_share %s %s failed: %s", code, category, e)
            return []
        return _statement_frame_to_rows(category, df)

    chunks = await asyncio.gather(
        *(fetch_one(category) for category in A_SHARE_STATEMENT_INDICATORS),
        return_exceptions=False,
    )
    rows: list[dict] = []
    for chunk in chunks:
        rows.extend(chunk)
    return rows


def _statement_frame_to_rows(category: str, df: pd.DataFrame | None) -> list[dict]:
    if df is None or df.empty:
        return []
    period_col = _find_period_column(df)
    if period_col is None:
        return []
    working = df.copy()
    working[period_col] = working[period_col].astype(str)
    working = working.sort_values(period_col, ascending=False).head(4)
    periods = working[period_col].tolist()
    rows: list[dict] = []
    for indicator in _match_statement_indicators(category, working.columns):
        values: dict[str, str] = {}
        for _, row in working.iterrows():
            value = row.get(indicator)
            if pd.notna(value):
                values[str(row[period_col])] = _format_number(value)
        if values:
            rows.append({"category": category, "indicator": indicator, "values": values})
    if not rows:
        return []
    return rows


def _find_period_column(df: pd.DataFrame) -> str | None:
    for col in ("报告日", "报表日期", "截止日期", "日期", "REPORT_DATE"):
        if col in df.columns:
            return col
    return str(df.columns[0]) if len(df.columns) else None


def _match_statement_indicators(category: str, columns) -> list[str]:
    matched: list[str] = []
    seen = set()
    for wanted in A_SHARE_STATEMENT_INDICATORS.get(category, []):
        for col in columns:
            col_text = str(col)
            if col_text in seen:
                continue
            if wanted == col_text or wanted in col_text:
                matched.append(col_text)
                seen.add(col_text)
                break
    return matched


def _collect_periods(rows: list[dict]) -> list[str]:
    periods: list[str] = []
    for row in rows:
        for period in (row.get("values") or {}).keys():
            if period not in periods:
                periods.append(period)
    return sorted(periods, reverse=True)


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


def _derive_dividend_yield_from_history(ticker: yf.Ticker, info: dict) -> float | None:
    """用最近一年现金分红 / 当前价格推导股息率，避免 yfinance 摘要口径异常直接污染报告。"""
    price = info.get("currentPrice") or info.get("regularMarketPrice") or info.get("previousClose")
    try:
        price_number = float(price)
    except (TypeError, ValueError):
        return None
    if price_number <= 0:
        return None
    try:
        dividends = ticker.dividends
    except Exception as e:
        logger.warning("yfinance dividends failed for %s: %s", getattr(ticker, "ticker", ""), e)
        return None
    if dividends is None or dividends.empty:
        return None
    recent = dividends.sort_index().tail(8)
    try:
        annual_dividend = float(recent.sum())
    except (TypeError, ValueError):
        return None
    if annual_dividend <= 0:
        return None
    return annual_dividend / price_number * 100


def _first_yfinance_frame(ticker: yf.Ticker, *attrs: str) -> pd.DataFrame | None:
    for attr in attrs:
        try:
            frame = getattr(ticker, attr)
        except Exception as e:
            logger.warning("yfinance %s %s failed: %s", getattr(ticker, "ticker", ""), attr, e)
            continue
        if frame is not None and not frame.empty:
            return frame
    return None


def _build_yfinance_quality_notes(rows: list[dict]) -> list[str]:
    categories = {row.get("category") for row in rows}
    notes = []
    for category in ("利润表", "现金流量表", "资产负债表"):
        if category not in categories:
            notes.append(f"{category}未返回关键字段，相关判断置信度需要下调。")
    return notes


def _select_a_share_financial_rows(rows: list[dict], max_rows: int = 60) -> list[dict]:
    """优先保留模型默认需要的 A 股财务项，避免简单截断丢掉现金流和负债表。"""
    preferred: list[dict] = []
    others: list[dict] = []
    for row in rows:
        text = f"{row.get('category', '')} {row.get('indicator', '')}"
        if any(keyword.lower() in text.lower() for keyword in A_SHARE_PREFERRED_KEYWORDS):
            preferred.append(row)
        else:
            others.append(row)
    selected = preferred[:max_rows]
    if len(selected) < max_rows:
        selected.extend(others[: max_rows - len(selected)])
    return selected


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
