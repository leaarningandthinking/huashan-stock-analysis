"""情绪 service：千股千评（机构参与度 / 关注指数 / 主力成本）。

数据源：stock_comment_em（东财源，已测稳定）。
注意：行业情绪数据（板块涨跌/换手）信息量低，已移除；行业层面请看 data/industry.py
里的行业估值（PE/PB/股息率），由基本面分析师使用。
"""

from __future__ import annotations

import logging

import akshare as ak
import pandas as pd

from app.data.akshare_client import DataSourceError, call
from app.data.cache import cache_get, cache_set

logger = logging.getLogger(__name__)

CACHE_TTL = 60 * 60 * 6  # 6 小时

# 全量 comment 表很大，整张缓存
ALL_COMMENT_KEY = "sentiment:all_comment"


def _safe_float(v) -> float | None:
    if v is None or pd.isna(v):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


async def _fetch_all_comment() -> list[dict] | None:
    cached = await cache_get(ALL_COMMENT_KEY)
    if cached is not None:
        return cached

    try:
        df: pd.DataFrame = await call(ak.stock_comment_em)
    except DataSourceError as e:
        logger.warning("stock_comment_em failed: %s", e)
        return None

    if df is None or df.empty:
        return None

    items = []
    for _, row in df.iterrows():
        code = str(row.get("代码", "")).strip().zfill(6)
        if not code:
            continue
        items.append({
            "code": code,
            "name": str(row.get("名称", "")).strip(),
            "institution_participation": _safe_float(row.get("机构参与度")),
            "attention_index": _safe_float(row.get("关注指数")),
            "main_force": _safe_float(row.get("主力成本")),
            "current": _safe_float(row.get("最新价")),
        })

    await cache_set(ALL_COMMENT_KEY, items, CACHE_TTL)
    return items


async def get_sentiment(code: str) -> dict | None:
    """返回个股情绪：机构参与度 / 关注指数 / 主力成本 / 最新价。"""
    items = await _fetch_all_comment()
    if items is None:
        return None
    for item in items:
        if item["code"] == code:
            return item
    return None
