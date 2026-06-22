"""短线分析服务。

数据源：akshare 新浪日线源。
模型：复用前端传入的 LLM provider/model/api_key。
"""

from __future__ import annotations

import json
import logging
import re

import akshare as ak
import pandas as pd

from app.data.akshare_client import DataSourceError, call
from app.data.symbols import CODE_RE, with_prefix
from app.llm.base import Message
from app.llm.factory import build_client
from app.schemas.diagnosis import LLMConfigPayload
from app.schemas.short_term import (
    KeyPriceLevel,
    ShortTermAnalyzeResponse,
    ShortTermCandle,
    ShortTermSnapshot,
)

logger = logging.getLogger(__name__)


async def analyze_short_term(
    *,
    code: str,
    name: str | None,
    llm: LLMConfigPayload,
) -> ShortTermAnalyzeResponse:
    normalized = code.strip().upper()
    if not CODE_RE.match(normalized):
        raise ValueError("短线分析当前仅支持 6 位 A 股代码")

    df = await _load_daily(normalized)
    if df.empty or len(df) < 80:
        raise DataSourceError("历史行情不足，无法进行短线分析")

    df = _add_indicators(df)
    tail = df.tail(160).copy()
    weekly = _add_indicators(_resample_ohlc(df).tail(120))
    snapshot = _build_snapshot(tail)
    levels = _build_levels(tail)
    chart = _build_chart(df.tail(250))
    context = _build_rule_context(tail, weekly, snapshot, levels)
    fallback = _fallback_analysis(
        name=name or normalized,
        code=normalized,
        snapshot=snapshot,
        levels=levels,
        context=context,
    )
    ai_analysis = await _call_llm(
        llm=llm,
        code=normalized,
        name=name or normalized,
        snapshot=snapshot,
        levels=levels,
        context=context,
        fallback=fallback,
    )
    return ShortTermAnalyzeResponse(
        code=normalized,
        name=name or normalized,
        snapshot=snapshot,
        levels=levels,
        chart=chart,
        ai_analysis=ai_analysis,
    )


async def _load_daily(code: str) -> pd.DataFrame:
    symbol = with_prefix(code)
    df: pd.DataFrame = await call(ak.stock_zh_a_daily, symbol=symbol, adjust="qfq")
    if df is None or df.empty:
        raise DataSourceError("akshare 未返回行情数据")

    required = {"date", "open", "high", "low", "close", "volume"}
    missing = required - set(df.columns)
    if missing:
        raise DataSourceError(f"行情字段缺失: {', '.join(sorted(missing))}")

    df = df.copy()
    df["date"] = pd.to_datetime(df["date"])
    for col in ["open", "high", "low", "close", "volume"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    if "amount" in df.columns:
        df["amount"] = pd.to_numeric(df["amount"], errors="coerce")
    else:
        df["amount"] = pd.NA
    return df.dropna(subset=["date", "open", "high", "low", "close"]).sort_values("date")


def _add_indicators(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    close = out["close"]
    for n in (5, 10, 20, 30, 60, 120):
        out[f"ma{n}"] = close.rolling(n).mean()
    out["vma20"] = out["volume"].rolling(20).mean()
    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    out["macd_diff"] = ema12 - ema26
    out["macd_dea"] = out["macd_diff"].ewm(span=9, adjust=False).mean()
    out["macd_hist"] = (out["macd_diff"] - out["macd_dea"]) * 2
    delta = close.diff()
    up = delta.clip(lower=0)
    down = -delta.clip(upper=0)
    avg_gain = up.ewm(alpha=1 / 14, adjust=False).mean()
    avg_loss = down.ewm(alpha=1 / 14, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, pd.NA)
    out["rsi14"] = 100 - (100 / (1 + rs))
    return out


def _build_snapshot(df: pd.DataFrame) -> ShortTermSnapshot:
    last = df.iloc[-1]
    close = float(last["close"])
    ma5 = _safe_float(last.get("ma5"))
    ma10 = _safe_float(last.get("ma10"))
    ma20 = _safe_float(last.get("ma20"))
    ma60 = _safe_float(last.get("ma60"))
    ma120 = _safe_float(last.get("ma120"))
    volume_ratio = _safe_float(last["volume"] / last["vma20"]) if _safe_float(last.get("vma20")) else None

    trend = _classify_trend(close, ma5, ma10, ma20, ma60)
    momentum = _classify_momentum(
        _safe_float(last.get("macd_diff")),
        _safe_float(last.get("macd_dea")),
        _safe_float(last.get("macd_hist")),
        _safe_float(last.get("rsi14")),
    )
    volume_state = _classify_volume(volume_ratio)

    return ShortTermSnapshot(
        date=str(last["date"].date()),
        close=round(close, 3),
        change_pct_5d=_pct_change(df["close"], 5),
        change_pct_20d=_pct_change(df["close"], 20),
        ma5=_round(ma5),
        ma10=_round(ma10),
        ma20=_round(ma20),
        ma60=_round(ma60),
        ma120=_round(ma120),
        rsi14=_round(_safe_float(last.get("rsi14"))),
        macd_diff=_round(_safe_float(last.get("macd_diff"))),
        macd_dea=_round(_safe_float(last.get("macd_dea"))),
        macd_hist=_round(_safe_float(last.get("macd_hist"))),
        volume_ratio_vs_20d=_round(volume_ratio),
        trend=trend,
        momentum=momentum,
        volume_state=volume_state,
    )


def _build_levels(df: pd.DataFrame) -> list[KeyPriceLevel]:
    last = df.iloc[-1]
    close = float(last["close"])
    candidates: list[KeyPriceLevel] = [
        KeyPriceLevel(label="当前价", price=round(close, 3), kind="current", note="最新收盘价"),
    ]

    for label, price, kind, note in [
        ("5日线", last.get("ma5"), "support" if _safe_float(last.get("ma5")) and _safe_float(last.get("ma5")) < close else "resistance", "短线强弱分界"),
        ("10日线", last.get("ma10"), "support" if _safe_float(last.get("ma10")) and _safe_float(last.get("ma10")) < close else "resistance", "短线回踩观察"),
        ("20日线", last.get("ma20"), "support" if _safe_float(last.get("ma20")) and _safe_float(last.get("ma20")) < close else "resistance", "短线趋势生命线"),
        ("60日线", last.get("ma60"), "support" if _safe_float(last.get("ma60")) and _safe_float(last.get("ma60")) < close else "resistance", "中期趋势参考"),
        ("20日低点", df.tail(20)["low"].min(), "support", "近 20 日低点"),
        ("60日低点", df.tail(60)["low"].min(), "support", "近 60 日低点"),
        ("20日高点", df.tail(20)["high"].max(), "resistance", "近 20 日高点"),
        ("60日高点", df.tail(60)["high"].max(), "resistance", "近 60 日高点"),
        ("120日高点", df.tail(120)["high"].max(), "resistance", "近 120 日高点"),
    ]:
        numeric = _safe_float(price)
        if numeric is None or numeric <= 0:
            continue
        candidates.append(
            KeyPriceLevel(label=label, price=round(numeric, 3), kind=kind, note=note)
        )

    dedup: dict[tuple[str, float], KeyPriceLevel] = {}
    for level in candidates:
        dedup[(level.label, level.price)] = level
    return sorted(dedup.values(), key=lambda item: item.price)


def _build_chart(df: pd.DataFrame) -> list[ShortTermCandle]:
    candles: list[ShortTermCandle] = []
    for _, row in df.iterrows():
        candles.append(
            ShortTermCandle(
                date=str(row["date"].date()),
                open=round(float(row["open"]), 3),
                high=round(float(row["high"]), 3),
                low=round(float(row["low"]), 3),
                close=round(float(row["close"]), 3),
                volume=_round(_safe_float(row.get("volume"))),
                ma20=_round(_safe_float(row.get("ma20"))),
                ma60=_round(_safe_float(row.get("ma60"))),
            )
        )
    return candles


def _resample_ohlc(df: pd.DataFrame) -> pd.DataFrame:
    weekly = (
        df.set_index("date")
        .resample("W-FRI")
        .agg({
            "open": "first",
            "high": "max",
            "low": "min",
            "close": "last",
            "volume": "sum",
            "amount": "sum",
        })
        .dropna(subset=["open", "high", "low", "close"])
        .reset_index()
    )
    return weekly


def _build_rule_context(
    daily: pd.DataFrame,
    weekly: pd.DataFrame,
    snapshot: ShortTermSnapshot,
    levels: list[KeyPriceLevel],
) -> dict:
    last = daily.iloc[-1]
    week_last = weekly.iloc[-1] if not weekly.empty else None
    ranges = {
        "d20": _range_info(daily, 20),
        "d60": _range_info(daily, 60),
        "d120": _range_info(daily, 120),
    }
    common_low = _common_level([ranges["d20"]["low"], ranges["d60"]["low"], ranges["d120"]["low"]])
    common_high = _common_level([ranges["d20"]["high"], ranges["d60"]["high"], ranges["d120"]["high"]])
    supports = [x.model_dump() for x in levels if x.kind == "support" and x.price < snapshot.close]
    resistances = [x.model_dump() for x in levels if x.kind == "resistance" and x.price >= snapshot.close]
    daily_judgement = {
        "trend": snapshot.trend,
        "price_below_ma5": _below(snapshot.close, snapshot.ma5),
        "price_below_ma10": _below(snapshot.close, snapshot.ma10),
        "price_below_ma20": _below(snapshot.close, snapshot.ma20),
        "price_below_ma60": _below(snapshot.close, snapshot.ma60),
        "price_below_ma120": _below(snapshot.close, snapshot.ma120),
        "ma5_lt_ma10_lt_ma20": (
            snapshot.ma5 is not None
            and snapshot.ma10 is not None
            and snapshot.ma20 is not None
            and snapshot.ma5 < snapshot.ma10 < snapshot.ma20
        ),
        "macd_hist_expanding_down": _macd_hist_expanding_down(daily),
        "rsi_zone": _rsi_zone(snapshot.rsi14),
        "near_range_low": _near(snapshot.close, ranges["d20"]["low"], pct=0.025)
        or _near(snapshot.close, ranges["d60"]["low"], pct=0.025),
        "volume_ratio_vs_20d": snapshot.volume_ratio_vs_20d,
    }
    weekly_summary = None
    if week_last is not None:
        weekly_summary = {
            "date": str(week_last["date"].date()),
            "close": _round(_safe_float(week_last.get("close"))),
            "ma5": _round(_safe_float(week_last.get("ma5"))),
            "ma10": _round(_safe_float(week_last.get("ma10"))),
            "ma20": _round(_safe_float(week_last.get("ma20"))),
            "ma60": _round(_safe_float(week_last.get("ma60"))),
            "macd_diff": _round(_safe_float(week_last.get("macd_diff"))),
            "macd_dea": _round(_safe_float(week_last.get("macd_dea"))),
            "macd_hist": _round(_safe_float(week_last.get("macd_hist"))),
            "rsi14": _round(_safe_float(week_last.get("rsi14"))),
            "trend": _classify_trend(
                float(week_last["close"]),
                _safe_float(week_last.get("ma5")),
                _safe_float(week_last.get("ma10")),
                _safe_float(week_last.get("ma20")),
                _safe_float(week_last.get("ma60")),
            ),
        }

    return {
        "ranges": ranges,
        "common_low": common_low,
        "common_high": common_high,
        "supports": supports,
        "resistances": resistances,
        "daily_judgement": daily_judgement,
        "weekly_summary": weekly_summary,
        "last_ohlc": {
            "open": _round(_safe_float(last.get("open"))),
            "high": _round(_safe_float(last.get("high"))),
            "low": _round(_safe_float(last.get("low"))),
            "close": _round(_safe_float(last.get("close"))),
            "volume": _round(_safe_float(last.get("volume"))),
            "amount": _round(_safe_float(last.get("amount"))),
        },
    }


def _range_info(df: pd.DataFrame, days: int) -> dict:
    tail = df.tail(days)
    high = float(tail["high"].max())
    low = float(tail["low"].min())
    return {
        "high": round(high, 3),
        "low": round(low, 3),
        "high_date": str(tail.loc[tail["high"].idxmax(), "date"].date()),
        "low_date": str(tail.loc[tail["low"].idxmin(), "date"].date()),
    }


def _common_level(values: list[float], tolerance: float = 0.02) -> float | None:
    if not values:
        return None
    if max(values) - min(values) <= tolerance:
        return round(sum(values) / len(values), 3)
    return None


def _below(price: float, level: float | None) -> bool:
    return level is not None and price < level


def _near(price: float, level: float, *, pct: float) -> bool:
    if level == 0:
        return False
    return abs(price / level - 1) <= pct


def _macd_hist_expanding_down(df: pd.DataFrame) -> bool:
    if len(df) < 2:
        return False
    latest = _safe_float(df.iloc[-1].get("macd_hist"))
    prev = _safe_float(df.iloc[-2].get("macd_hist"))
    return latest is not None and prev is not None and latest < 0 and latest < prev


def _rsi_zone(rsi: float | None) -> str:
    if rsi is None:
        return "数据不足"
    if rsi < 30:
        return "短线超跌区"
    if rsi < 50:
        return "弱势修复区"
    if rsi <= 70:
        return "偏强区"
    return "短线过热区"


async def _call_llm(
    *,
    llm: LLMConfigPayload,
    code: str,
    name: str,
    snapshot: ShortTermSnapshot,
    levels: list[KeyPriceLevel],
    context: dict,
    fallback: str,
) -> str:
    client = build_client(llm.provider, llm.api_key, llm.base_url)
    payload = {
        "code": code,
        "name": name,
        "snapshot": snapshot.model_dump(),
        "levels": [level.model_dump() for level in levels],
        "rule_context": context,
    }
    system = (
        "你是A股短线技术分析助手。只基于给定数据分析，不编造行情。"
        "输出中文，结构必须严格贴合固定技术分析skill模板，避免作者名和书名。"
        "不要给确定性预测，不要直接建议买入卖出。"
        "不要省略结论、事实数据、规则判断、关键价位、后续触发。"
    )
    user = (
        "按以下固定格式生成短线分析，格式和标题必须保留：\n\n"
        "结论：一句话概括技术状态，必须包含趋势、日线/周线状态、支撑附近或压力附近、是否有反抽/过热、是否有转强信号。\n\n"
        "事实数据：\n"
        "- 收盘：...\n"
        "- MA5/10/20/60/120：...\n"
        "- MACD：DIF ...，DEA ...，柱体 ...，并解释增强/减弱\n"
        "- RSI14：...，解释所处区间\n"
        "- 成交量 / VMA20：... / ...，量比约 ...，解释放量/缩量\n"
        "- 近 20/60/120 日区间：高点 ... / ... / ...，低点 ... / ... / ...\n\n"
        "规则判断：\n"
        "- 趋势：...\n"
        "- 价格阶段：...\n"
        "- 位置：...\n"
        "- 动量：...\n"
        "- 量能：...\n\n"
        "关键价位：\n"
        "- 支撑：...\n"
        "- 压力：...\n\n"
        "后续触发：\n"
        "- 转强：...\n"
        "- 转弱：...\n"
        "- 观察：...\n\n"
        "规则口径：价格相对MA5/10/20/60/120判断趋势；日线和周线同时参考；"
        "MACD和RSI判断动量；成交量相对20日均量判断放量或缩量；"
        "关键价位必须引用levels和rule_context，不要编造价位。"
        f"\n\n数据：{json.dumps(payload, ensure_ascii=False)}"
    )
    try:
        result = await client.chat(
            [Message(role="system", content=system), Message(role="user", content=user)],
            llm.model,
            temperature=0.25,
            max_tokens=1200,
        )
    except Exception as e:
        logger.warning("short-term llm failed for %s: %s", code, e)
        return fallback
    return _strip_code_fence(result.content.strip()) or fallback


def _fallback_analysis(
    *,
    name: str,
    code: str,
    snapshot: ShortTermSnapshot,
    levels: list[KeyPriceLevel],
    context: dict,
) -> str:
    supports = [x for x in levels if x.kind == "support" and x.price < snapshot.close][-3:]
    resistances = [x for x in levels if x.kind == "resistance" and x.price >= snapshot.close][:3]
    support_text = "、".join(f"{x.label} {x.price}" for x in supports) or "暂无明确下方支撑"
    resistance_text = "、".join(f"{x.label} {x.price}" for x in resistances) or "暂无明确上方压力"
    ranges = context.get("ranges", {})
    d20 = ranges.get("d20", {})
    d60 = ranges.get("d60", {})
    d120 = ranges.get("d120", {})
    last = context.get("last_ohlc", {})
    return (
        f"结论：{name}当前技术面为{snapshot.trend}，动量{snapshot.momentum}，"
        f"量能{snapshot.volume_state}。短线重点看关键支撑是否守住，以及反弹能否重新站回主要均线。\n\n"
        "事实数据：\n"
        f"- 收盘：{snapshot.close}\n"
        f"- MA5/10/20/60/120：{snapshot.ma5} / {snapshot.ma10} / {snapshot.ma20} / {snapshot.ma60} / {snapshot.ma120}\n"
        f"- MACD：DIF {snapshot.macd_diff}，DEA {snapshot.macd_dea}，柱体 {snapshot.macd_hist}\n"
        f"- RSI14：{snapshot.rsi14}，{_rsi_zone(snapshot.rsi14)}\n"
        f"- 成交量 / VMA20：{last.get('volume')} / {_vma20_from_snapshot(snapshot, last)}，量比约 {snapshot.volume_ratio_vs_20d}，{snapshot.volume_state}\n"
        f"- 近 20/60/120 日区间：高点 {d20.get('high')} / {d60.get('high')} / {d120.get('high')}，"
        f"低点 {d20.get('low')} / {d60.get('low')} / {d120.get('low')}\n\n"
        "规则判断：\n"
        f"- 趋势：{snapshot.trend}。价格相对主要均线的位置决定当前趋势评级。\n"
        "- 价格阶段：根据是否突破平台、是否跌到区间下沿、是否站上中长期均线判断。\n"
        f"- 位置：当前价相对区间低点和压力位判断，重点看 {support_text}。\n"
        f"- 动量：{snapshot.momentum}。MACD 和 RSI 用于确认动量是否增强或减弱。\n"
        f"- 量能：{snapshot.volume_state}。成交量相对 20 日均量用于判断突破或反弹是否有确认。\n\n"
        "关键价位：\n"
        f"- 支撑：{support_text}\n"
        f"- 压力：{resistance_text}\n\n"
        "后续触发：\n"
        f"- 转强：先收复最近一档压力，再放量站回 MA20/MA60 区域。\n"
        f"- 转弱：跌破主要支撑且无法快速收回，尤其伴随放量时，短线结构转弱。\n"
        f"- 观察：如果在支撑附近缩量止跌并出现放量阳线，先按反抽修复看；没有站回 MA20 前，不按趋势转强处理。"
    )


def _vma20_from_snapshot(snapshot: ShortTermSnapshot, last_ohlc: dict) -> float | None:
    ratio = snapshot.volume_ratio_vs_20d
    volume = last_ohlc.get("volume")
    if ratio in (None, 0) or volume is None:
        return None
    return _round(float(volume) / float(ratio))


def _classify_trend(close: float, ma5, ma10, ma20, ma60) -> str:
    if all(v is not None for v in [ma5, ma10, ma20, ma60]):
        if close > ma5 > ma10 > ma20 and close > ma60:
            return "强势"
        if close > ma20 and close > ma60:
            return "偏强"
        if close < ma5 and close < ma10 and close < ma20 and close < ma60:
            return "弱势"
        if close < ma5 and close < ma10 and close < ma20:
            return "偏弱"
    return "震荡"


def _classify_momentum(diff, dea, hist, rsi) -> str:
    if diff is not None and dea is not None and hist is not None:
        if diff > dea and hist > 0:
            return "增强但过热" if rsi is not None and rsi >= 70 else "增强"
        if diff < dea and hist < 0:
            return "减弱但超跌" if rsi is not None and rsi <= 30 else "减弱"
    return "修复"


def _classify_volume(ratio: float | None) -> str:
    if ratio is None:
        return "数据不足"
    if ratio > 1.5:
        return "明显放量"
    if ratio >= 1.0:
        return "温和放量"
    if ratio >= 0.7:
        return "正常或略缩量"
    return "明显缩量"


def _pct_change(series: pd.Series, periods: int) -> float | None:
    if len(series) <= periods:
        return None
    base = series.iloc[-periods - 1]
    latest = series.iloc[-1]
    if pd.isna(base) or float(base) == 0:
        return None
    return _round((float(latest) / float(base) - 1) * 100)


def _safe_float(value) -> float | None:
    if value is None or pd.isna(value):
        return None
    return float(value)


def _round(value: float | None) -> float | None:
    return None if value is None else round(float(value), 4)


def _strip_code_fence(text: str) -> str:
    return re.sub(r"^```(?:markdown|text)?\s*|\s*```$", "", text.strip())
