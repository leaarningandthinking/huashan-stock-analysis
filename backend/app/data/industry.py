"""申万二级行业 service：股票代码 → 二级行业 映射 + 行业估值快照。

数据源：
- `sw_index_second_info`    131 个二级行业 + PE静 / PE-TTM / PB / 股息率（稳定）
- `index_component_sw(行业代码)`  二级行业成分股（构建 股票→行业 映射）

缓存策略：
- 映射表：Redis 1 天（申万分类变化慢；首次冷启动约 30 秒）
- 估值快照：Redis 1 小时（盘中可能变）

为什么不从 `stock_individual_info_em` 拿东财行业再名字匹配？
- 东财行业名（"白酒"）与申万二级（"饮料乳品"二级下 "白酒Ⅲ"三级）不对齐
- stock_individual_info_em 接口不稳，经常 ConnectionError
"""

from __future__ import annotations

import asyncio
import logging

import akshare as ak
import pandas as pd

from app.data.akshare_client import DataSourceError, call
from app.data.cache import cache_get, cache_set

logger = logging.getLogger(__name__)

MAPPING_KEY = "industry:sw_second:stock_to_industry"
MAPPING_TTL = 60 * 60 * 24  # 1 day

VALUATION_KEY = "industry:sw_second:valuation"
VALUATION_TTL = 60 * 60  # 1 hour


def _safe_float(v) -> float | None:
    if v is None or pd.isna(v):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


async def _load_second_info() -> pd.DataFrame | None:
    """拉取申万二级行业全表（131 行）。"""
    try:
        df = await call(ak.sw_index_second_info)
    except DataSourceError as e:
        logger.warning("sw_index_second_info failed: %s", e)
        return None
    return df if df is not None and not df.empty else None


async def get_industry_valuation_table() -> dict[str, dict] | None:
    """返回 {'801016.SI': {industry_code, industry_name, parent, pe_static,
    pe_ttm, pb, dividend_yield, count}, ...}

    以 Redis 缓存 1 小时。
    """
    cached = await cache_get(VALUATION_KEY)
    if cached is not None:
        return cached

    df = await _load_second_info()
    if df is None:
        return None

    table: dict[str, dict] = {}
    for _, row in df.iterrows():
        code = str(row.get("行业代码", "")).strip()
        if not code:
            continue
        table[code] = {
            "industry_code": code,
            "industry_name": str(row.get("行业名称", "")).strip(),
            "parent": str(row.get("上级行业", "")).strip(),
            "pe_static": _safe_float(row.get("静态市盈率")),
            "pe_ttm": _safe_float(row.get("TTM(滚动)市盈率")),
            "pb": _safe_float(row.get("市净率")),
            "dividend_yield": _safe_float(row.get("静态股息率")),
            "count": int(row.get("成份个数") or 0),
        }

    await cache_set(VALUATION_KEY, table, VALUATION_TTL)
    return table


async def _fetch_one_industry_members(industry_code_with_si: str) -> list[str]:
    """某个二级行业的成分股代码列表。 '801120.SI' → ['000596', ...]"""
    # 接口要去掉 .SI 后缀
    sym = industry_code_with_si.replace(".SI", "").strip()
    if not sym:
        return []
    try:
        df = await call(ak.index_component_sw, symbol=sym)
    except DataSourceError as e:
        # 申万数据里偶有历史代码不存在（如 801020 煤炭已废），静默降级
        logger.debug("index_component_sw(%s) failed: %s", sym, e)
        return []
    if df is None or df.empty:
        return []
    try:
        return [str(c).zfill(6) for c in df["证券代码"].tolist()]
    except KeyError:
        return []


async def get_stock_to_industry_mapping() -> dict[str, str] | None:
    """返回 {stock_code: industry_code}。首次冷启动约 30 秒。

    注意：131 次 API 调用受 akshare_client.call 的全局 Semaphore(4) 限流约束。
    """
    cached = await cache_get(MAPPING_KEY)
    if cached is not None:
        return cached

    df = await _load_second_info()
    if df is None:
        return None

    industry_codes = [str(c).strip() for c in df["行业代码"].tolist() if str(c).strip()]
    logger.info("Building SW second-industry mapping: %d industries", len(industry_codes))

    all_members = await asyncio.gather(
        *(_fetch_one_industry_members(c) for c in industry_codes),
        return_exceptions=False,
    )

    mapping: dict[str, str] = {}
    for industry_code, members in zip(industry_codes, all_members):
        for code in members:
            # 申万二级行业之间互斥，但历史迁移可能存在重复——保留首次遇到的
            mapping.setdefault(code, industry_code)

    logger.info(
        "SW mapping built: %d stocks mapped across %d industries (cached %d s)",
        len(mapping), len(industry_codes), MAPPING_TTL,
    )
    if not mapping:
        # 全失败就别缓存空表
        return None

    await cache_set(MAPPING_KEY, mapping, MAPPING_TTL)
    return mapping


async def get_industry_valuation(code: str) -> dict | None:
    """个股 → 所属二级行业的估值快照。

    返回结构:
        {
          "industry_code": "801016.SI",
          "industry_name": "种植业",
          "parent": "农林牧渔",
          "pe_static": 38.07,
          "pe_ttm": 34.58,
          "pb": 2.57,
          "dividend_yield": 1.39,
          "count": 20
        }
    或 None（映射失败 / 数据源挂了）。
    """
    mapping = await get_stock_to_industry_mapping()
    if mapping is None:
        return None
    industry_code = mapping.get(code)
    if industry_code is None:
        return None
    table = await get_industry_valuation_table()
    if table is None:
        return None
    return table.get(industry_code)
