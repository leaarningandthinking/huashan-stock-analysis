"""技术面 service：历史行情 + MACD / RSI / 均线。

数据源：stock_zh_a_daily（新浪源，稳定）。需要 sh/sz/bj 前缀。
技术指标自实现（30 行 pandas），不依赖 pandas-ta。
"""

from __future__ import annotations

import logging

import akshare as ak
import pandas as pd
import yfinance as yf

from app.data.akshare_client import DataSourceError, call
from app.data.cache import cache_get, cache_set
from app.data.symbols import CODE_RE, with_prefix

logger = logging.getLogger(__name__)

CACHE_TTL = 60 * 60  # 1 小时（盘中复用）


def _ema(series: pd.Series, span: int) -> pd.Series:
    return series.ewm(span=span, adjust=False).mean()


def _macd(close: pd.Series) -> tuple[pd.Series, pd.Series, pd.Series]:
    ema12 = _ema(close, 12)
    ema26 = _ema(close, 26)
    diff = ema12 - ema26
    dea = _ema(diff, 9)
    hist = (diff - dea) * 2
    return diff, dea, hist


def _rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    up = delta.clip(lower=0)
    down = -delta.clip(upper=0)
    avg_gain = up.ewm(alpha=1 / period, adjust=False).mean()
    avg_loss = down.ewm(alpha=1 / period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, pd.NA)
    return 100 - (100 / (1 + rs))


async def get_technical(code: str, days: int = 120) -> dict | None:
    """近 N 日行情 + 技术指标。"""
    cache_key = f"technical:v2:{code}:{days}"
    if (c := await cache_get(cache_key)) is not None:
        return c

    if CODE_RE.match(code):
        sym = with_prefix(code)
        try:
            df: pd.DataFrame = await call(
                ak.stock_zh_a_daily, symbol=sym, adjust="qfq",
            )
        except DataSourceError as e:
            logger.warning("daily %s failed: %s", code, e)
            return None
    else:
        try:
            df = yf.Ticker(code).history(period="9mo", interval="1d").reset_index()
            df = df.rename(columns={
                "Date": "date",
                "Close": "close",
                "Volume": "volume",
            })
        except Exception as e:
            logger.warning("yfinance daily %s failed: %s", code, e)
            return None

    if df is None or df.empty:
        return None

    df = df.tail(days + 30).copy()  # 多取一些喂给指标计算
    close = df["close"]
    diff, dea, hist = _macd(close)
    rsi14 = _rsi(close, 14)
    ma5 = close.rolling(5).mean()
    ma20 = close.rolling(20).mean()
    ma60 = close.rolling(60).mean()

    df["macd_diff"] = diff
    df["macd_dea"] = dea
    df["macd_hist"] = hist
    df["rsi14"] = rsi14
    df["ma5"] = ma5
    df["ma20"] = ma20
    df["ma60"] = ma60

    tail = df.tail(days).copy()
    tail["date"] = tail["date"].astype(str)

    last = tail.iloc[-1]
    volume = tail["volume"] if "volume" in tail else pd.Series(dtype="float64")
    summary = {
        "last_date": str(last["date"]),
        "last_close": float(last["close"]),
        "change_pct_5d": _pct_change(tail["close"], 5),
        "change_pct_20d": _pct_change(tail["close"], 20),
        "ma5": _safe_float(last["ma5"]),
        "ma20": _safe_float(last["ma20"]),
        "ma60": _safe_float(last["ma60"]),
        "rsi14": _safe_float(last["rsi14"]),
        "macd_diff": _safe_float(last["macd_diff"]),
        "macd_dea": _safe_float(last["macd_dea"]),
        "macd_hist": _safe_float(last["macd_hist"]),
        "latest_volume": _safe_float(last.get("volume")),
        "volume_ma5": _safe_float(volume.rolling(5).mean().iloc[-1]) if len(volume) >= 5 else None,
        "volume_ma20": _safe_float(volume.rolling(20).mean().iloc[-1]) if len(volume) >= 20 else None,
        "volume_ratio_vs_20d": _volume_ratio(volume, 20),
        "trend": _classify_trend(tail),
    }

    series = {
        "date": tail["date"].tolist(),
        "close": [_safe_float(v) for v in tail["close"]],
        "volume": [_safe_float(v) for v in tail["volume"]],
    }

    result = {"code": code, "summary": summary, "series": series}
    await cache_set(cache_key, result, CACHE_TTL)
    return result


def _safe_float(v) -> float | None:
    if v is None or pd.isna(v):
        return None
    return float(v)


def _pct_change(series: pd.Series, periods: int) -> float | None:
    if len(series) <= periods:
        return None
    base = series.iloc[-periods - 1]
    latest = series.iloc[-1]
    if base is None or pd.isna(base) or float(base) == 0:
        return None
    return (float(latest) / float(base) - 1) * 100


def _volume_ratio(series: pd.Series, periods: int) -> float | None:
    if len(series) < periods:
        return None
    latest = series.iloc[-1]
    avg = series.tail(periods).mean()
    if pd.isna(latest) or pd.isna(avg) or float(avg) == 0:
        return None
    return float(latest) / float(avg)


def _classify_trend(df: pd.DataFrame) -> str:
    """简单趋势判断：当前价 vs 20/60 日均线。"""
    last = df.iloc[-1]
    close = last["close"]
    ma20 = last.get("ma20")
    ma60 = last.get("ma60")
    if pd.isna(ma20) or pd.isna(ma60):
        return "数据不足"
    if close > ma20 > ma60:
        return "多头排列"
    if close < ma20 < ma60:
        return "空头排列"
    if close > ma20 and ma20 < ma60:
        return "反弹中"
    return "震荡"
