"""股票代码工具：normalize / validate / search。

A 股代码 6 位数字：
- 6 / 9 开头：沪市（sh）
- 0 / 3 开头：深市（sz）
- 4 / 8 开头：北交所（bj）

新浪源接口要带交易所前缀（sh600519），东财不需要。
"""

from __future__ import annotations

import logging
import re
from typing import Literal

import asyncio

import akshare as ak
import yfinance as yf

from app.data.akshare_client import DataSourceError, call
from app.data.cache import cache_get, cache_set

logger = logging.getLogger(__name__)

CODE_RE = re.compile(r"^\d{6}$")
HK_CODE_RE = re.compile(r"^\d{1,5}(?:\.HK)?$", re.IGNORECASE)
US_CODE_RE = re.compile(r"^[A-Z][A-Z0-9.-]{0,9}$", re.IGNORECASE)
ALL_CODES_KEY = "symbols:a_share:all"
ALL_CODES_TTL = 60 * 60 * 24  # 1 天
YF_SEARCH_TTL = 60 * 60 * 6

Exchange = Literal["sh", "sz", "bj", "hk", "us"]


POPULAR_HK_US = [
    {"code": "0700.HK", "name": "腾讯控股", "exchange": "hk"},
    {"code": "9988.HK", "name": "阿里巴巴-W", "exchange": "hk"},
    {"code": "3690.HK", "name": "美团-W", "exchange": "hk"},
    {"code": "9618.HK", "name": "京东集团-SW", "exchange": "hk"},
    {"code": "AAPL", "name": "苹果 Apple Inc.", "exchange": "us"},
    {"code": "MSFT", "name": "微软 Microsoft Corporation", "exchange": "us"},
    {"code": "NVDA", "name": "英伟达 NVIDIA Corporation", "exchange": "us"},
    {"code": "TSLA", "name": "特斯拉 Tesla, Inc.", "exchange": "us"},
    {"code": "GOOGL", "name": "谷歌 Alphabet Inc.", "exchange": "us"},
    {"code": "META", "name": "Meta Platforms, Inc.", "exchange": "us"},
]


def detect_exchange(code: str) -> Exchange:
    """按代码首字判断交易所。"""
    if not CODE_RE.match(code):
        raise ValueError(f"非法股票代码: {code}")
    head = code[0]
    if head in {"6", "9"}:
        return "sh"
    if head in {"0", "3"}:
        return "sz"
    if head in {"4", "8"}:
        return "bj"
    raise ValueError(f"无法识别的代码: {code}")


def normalize_symbol(raw: str) -> str:
    code = raw.strip().upper()
    if not code:
        return code
    if CODE_RE.match(code):
        return code
    if HK_CODE_RE.match(code):
        digits = code.replace(".HK", "")
        return f"{digits[-4:].zfill(4)}.HK"
    return code


def detect_market(code: str) -> Exchange:
    symbol = normalize_symbol(code)
    if CODE_RE.match(symbol):
        return detect_exchange(symbol)
    if symbol.endswith(".HK"):
        return "hk"
    if US_CODE_RE.match(symbol):
        return "us"
    raise ValueError(f"无法识别的代码: {code}")


def _is_a_share(code: str) -> bool:
    return bool(CODE_RE.match(code))


def with_prefix(code: str) -> str:
    """600519 -> sh600519。新浪源接口要这个格式。"""
    return f"{detect_exchange(code)}{code}"


async def fetch_all_codes() -> list[dict]:
    """拉全量 A 股代码 + 名字。Redis 缓存 1 天。

    返回: [{"code": "600519", "name": "贵州茅台"}, ...]
    """
    cached = await cache_get(ALL_CODES_KEY)
    if cached is not None:
        return cached

    df = await call(ak.stock_info_a_code_name)
    items = [
        {"code": str(row["code"]).zfill(6), "name": str(row["name"]).strip()}
        for _, row in df.iterrows()
        if str(row.get("code", "")).strip()
    ]
    await cache_set(ALL_CODES_KEY, items, ALL_CODES_TTL)
    return items


async def validate_code(code: str) -> dict | None:
    """校验代码是否存在。返回 {code, name, exchange} 或 None。"""
    code = normalize_symbol(code)
    if not code:
        return None
    if not _is_a_share(code):
        return await validate_yfinance_symbol(code)
    try:
        all_codes = await fetch_all_codes()
    except DataSourceError as e:
        logger.warning("fetch all codes failed during validate: %s", e)
        # 数据源挂了：退回只校验格式
        try:
            return {"code": code, "name": "", "exchange": detect_exchange(code)}
        except ValueError:
            return None

    for item in all_codes:
        if item["code"] == code:
            return {
                "code": code,
                "name": item["name"],
                "exchange": detect_exchange(code),
            }
    return None


async def search_codes(query: str, limit: int = 20) -> list[dict]:
    """按代码或名字模糊搜索。"""
    q = query.strip()
    if not q:
        return []
    hits: list[dict] = []
    try:
        all_codes = await fetch_all_codes()
        for item in all_codes:
            if q in item["code"] or q in item["name"]:
                hits.append({
                    "code": item["code"],
                    "name": item["name"],
                    "exchange": detect_exchange(item["code"]),
                })
                if len(hits) >= limit:
                    break
    except DataSourceError as e:
        logger.warning("fetch all A share codes failed during search: %s", e)

    q_upper = q.upper()
    seen = {h["code"] for h in hits}
    for item in POPULAR_HK_US:
        if (
            item["code"] not in seen
            and (q_upper in item["code"].upper() or q.lower() in item["name"].lower())
        ):
            hits.append(item)
            seen.add(item["code"])
            if len(hits) >= limit:
                return hits

    if len(hits) < limit:
        for item in await search_yfinance(q, limit - len(hits)):
            if item["code"] not in seen:
                hits.append(item)
                seen.add(item["code"])
                if len(hits) >= limit:
                    break
    return hits


def _yf_search_sync(query: str, limit: int) -> list[dict]:
    if hasattr(yf, "Search"):
        search = yf.Search(query, max_results=limit)
        quotes = getattr(search, "quotes", None) or []
    else:
        quotes = []
    results: list[dict] = []
    for quote in quotes:
        symbol = str(quote.get("symbol") or "").upper()
        if not symbol:
            continue
        quote_type = str(quote.get("quoteType") or quote.get("typeDisp") or "").upper()
        if quote_type and "EQUITY" not in quote_type:
            continue
        exchange = "hk" if symbol.endswith(".HK") else "us"
        if exchange == "us" and "." in symbol and not symbol.endswith(".HK"):
            continue
        name = str(
            quote.get("shortname")
            or quote.get("longname")
            or quote.get("name")
            or symbol
        ).strip()
        results.append({"code": symbol, "name": name, "exchange": exchange})
    return results


async def search_yfinance(query: str, limit: int = 10) -> list[dict]:
    cache_key = f"symbols:yfinance:search:{query.lower()}:{limit}"
    if (cached := await cache_get(cache_key)) is not None:
        return cached
    try:
        results = await asyncio.wait_for(
            asyncio.to_thread(_yf_search_sync, query, limit),
            timeout=6,
        )
    except Exception as e:
        logger.warning("yfinance search failed for %s: %s", query, e)
        results = []
    await cache_set(cache_key, results, YF_SEARCH_TTL)
    return results


def _yf_validate_sync(symbol: str) -> dict | None:
    ticker = yf.Ticker(symbol)
    info = ticker.get_info()
    if not info:
        return None
    quote_type = str(info.get("quoteType") or "").upper()
    if quote_type and quote_type != "EQUITY":
        return None
    name = str(
        info.get("shortName")
        or info.get("longName")
        or info.get("displayName")
        or symbol
    ).strip()
    return {"code": symbol, "name": name, "exchange": detect_market(symbol)}


async def validate_yfinance_symbol(code: str) -> dict | None:
    symbol = normalize_symbol(code)
    cache_key = f"symbols:yfinance:validate:{symbol}"
    if (cached := await cache_get(cache_key)) is not None:
        return cached
    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(_yf_validate_sync, symbol),
            timeout=6,
        )
    except Exception as e:
        logger.warning("yfinance validate failed for %s: %s", symbol, e)
        result = None
    if result is not None:
        await cache_set(cache_key, result, YF_SEARCH_TTL)
    return result
