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


async def get_news(code: str, limit: int = 15) -> list[dict] | None:
    cache_key = f"news:{code}:{limit}"
    if (c := await cache_get(cache_key)) is not None:
        return c

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

    await cache_set(cache_key, items, CACHE_TTL)
    return items
