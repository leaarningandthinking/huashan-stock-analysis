"""新闻 service：个股近期新闻。

数据源：stock_news_em（东财源）。
"""

from __future__ import annotations

import logging

import akshare as ak
import pandas as pd

from app.data.akshare_client import DataSourceError, call
from app.data.cache import cache_get, cache_set

logger = logging.getLogger(__name__)

CACHE_TTL = 60 * 30  # 30 分钟

MARKET_SIGNAL_KEYWORDS = (
    "主力资金",
    "资金流",
    "净流入",
    "净流出",
    "融资融券",
    "融资余额",
    "融券",
    "龙虎榜",
    "大宗交易",
    "沪深股通",
    "北向资金",
    "行情异动",
    "异动",
    "涨停",
    "跌停",
    "涨幅",
    "跌幅",
    "收盘",
    "换手率",
)


def _is_market_signal(item: dict) -> bool:
    text = f"{item.get('title', '')} {item.get('summary', '')}"
    return any(keyword in text for keyword in MARKET_SIGNAL_KEYWORDS)


async def _fetch_news_items(code: str, limit: int) -> list[dict] | None:
    try:
        df: pd.DataFrame = await call(ak.stock_news_em, symbol=code)
    except DataSourceError as e:
        logger.warning("news %s failed: %s", code, e)
        return None

    if df is None or df.empty:
        return None

    items = []
    for _, row in df.head(limit).iterrows():
        items.append({
            "title": str(row.get("新闻标题", "")).strip(),
            "time": str(row.get("发布时间", "")).strip(),
            "source": str(row.get("文章来源", "")).strip(),
            "url": str(row.get("新闻链接", "")).strip(),
            "summary": str(row.get("新闻内容", ""))[:200].strip(),
        })
    return items


async def get_news(code: str, limit: int = 15) -> list[dict] | None:
    cache_key = f"news:v2:{code}:{limit}"
    if (c := await cache_get(cache_key)) is not None:
        return c

    raw_items = await _fetch_news_items(code, limit)
    if not raw_items:
        return None

    items = [item for item in raw_items if not _is_market_signal(item)]
    await cache_set(cache_key, items, CACHE_TTL)
    return items


async def get_market_signal_news(code: str, limit: int = 15) -> list[dict] | None:
    """返回新闻源中偏交易情绪/资金行为的资讯，供情绪分析师使用。"""
    cache_key = f"market_signal_news:v1:{code}:{limit}"
    if (c := await cache_get(cache_key)) is not None:
        return c

    raw_items = await _fetch_news_items(code, limit)
    if not raw_items:
        return None

    items = [item for item in raw_items if _is_market_signal(item)]
    await cache_set(cache_key, items, CACHE_TTL)
    return items
