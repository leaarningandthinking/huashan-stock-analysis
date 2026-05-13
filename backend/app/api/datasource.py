"""数据源健康检查。

默认返回 6 小时缓存，避免每次打开页面都直接打免费数据源。
"""

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timedelta, timezone

import akshare as ak
import yfinance as yf
from fastapi import APIRouter

from app.data.akshare_client import DataSourceError, call

router = APIRouter(prefix="/api/datasource", tags=["datasource"])

A_SHARE_PROBE_CODE = "600519"
US_PROBE_SYMBOL = "AAPL"
HK_PROBE_SYMBOL = "0700.HK"
HEALTH_CACHE_TTL = timedelta(hours=6)
_SERVICE_CACHE: dict[str, dict] = {}


async def _probe_akshare(name: str, fn, *args, **kwargs) -> dict:
    t0 = time.perf_counter()
    try:
        await call(fn, *args, **kwargs)
        return {
            "name": name,
            "source": "akshare",
            "market": "A股",
            "status": "ok",
            "latency_ms": int((time.perf_counter() - t0) * 1000),
            "error": None,
        }
    except DataSourceError as e:
        return {
            "name": name,
            "source": "akshare",
            "market": "A股",
            "status": "fail",
            "latency_ms": int((time.perf_counter() - t0) * 1000),
            "error": str(e)[:120],
        }
    except Exception as e:
        return {
            "name": name,
            "source": "akshare",
            "market": "A股",
            "status": "fail",
            "latency_ms": int((time.perf_counter() - t0) * 1000),
            "error": f"{type(e).__name__}: {str(e)[:100]}",
        }


def _fetch_yfinance_history(symbol: str):
    return yf.Ticker(symbol).history(period="5d", interval="1d")


async def _probe_yfinance(name: str, symbol: str, market: str) -> dict:
    t0 = time.perf_counter()
    try:
        df = await asyncio.wait_for(
            asyncio.to_thread(_fetch_yfinance_history, symbol),
            timeout=8,
        )
        if df is None or df.empty:
            raise RuntimeError(f"{symbol} returned empty history")
        return {
            "name": name,
            "source": "yfinance",
            "market": market,
            "status": "ok",
            "latency_ms": int((time.perf_counter() - t0) * 1000),
            "error": None,
        }
    except Exception as e:
        return {
            "name": name,
            "source": "yfinance",
            "market": market,
            "status": "fail",
            "latency_ms": int((time.perf_counter() - t0) * 1000),
            "error": f"{type(e).__name__}: {str(e)[:100]}",
        }


async def _run_probe(name: str) -> dict:
    if name == "a_share_symbol_list":
        return await _probe_akshare(name, ak.stock_info_a_code_name)
    if name == "a_share_fundamentals":
        return await _probe_akshare(
            name,
            ak.stock_financial_abstract,
            symbol=A_SHARE_PROBE_CODE,
        )
    if name == "a_share_technical":
        return await _probe_akshare(
            name,
            ak.stock_zh_a_daily,
            symbol=f"sh{A_SHARE_PROBE_CODE}",
            adjust="qfq",
        )
    if name == "a_share_news":
        return await _probe_akshare(name, ak.stock_news_em, symbol=A_SHARE_PROBE_CODE)
    if name == "a_share_sentiment":
        return await _probe_akshare(name, ak.stock_comment_em)
    if name == "us_stock_quotes":
        return await _probe_yfinance(name, US_PROBE_SYMBOL, "美股")
    if name == "hk_stock_quotes":
        return await _probe_yfinance(name, HK_PROBE_SYMBOL, "港股")
    raise KeyError(name)


SERVICE_NAMES = [
    "a_share_symbol_list",
    "a_share_fundamentals",
    "a_share_technical",
    "a_share_news",
    "a_share_sentiment",
    "us_stock_quotes",
    "hk_stock_quotes",
]


def _with_cache_meta(result: dict, updated_at: datetime, cached: bool) -> dict:
    return {
        **result,
        "cached": cached,
        "updated_at": updated_at.isoformat(),
        "cache_ttl_seconds": int(HEALTH_CACHE_TTL.total_seconds()),
    }


async def _get_service_status(name: str, *, force: bool = False) -> dict:
    now = datetime.now(timezone.utc)
    cached = _SERVICE_CACHE.get(name)
    if (
        not force
        and cached is not None
        and now - cached["updated_at"] < HEALTH_CACHE_TTL
    ):
        return _with_cache_meta(cached["result"], cached["updated_at"], True)

    result = await _run_probe(name)
    _SERVICE_CACHE[name] = {"result": result, "updated_at": now}
    return _with_cache_meta(result, now, False)


def _latest_updated_at(services: list[dict]) -> str | None:
    dates = [s.get("updated_at") for s in services if s.get("updated_at")]
    return max(dates) if dates else None


@router.get("/health")
async def health(force: bool = False) -> dict:
    """各 service 探活。默认 6 小时内复用上次结果，force=true 才重新探活。"""
    results = await asyncio.gather(
        *(_get_service_status(name, force=force) for name in SERVICE_NAMES),
        return_exceptions=False,
    )
    overall_ok = all(r["status"] == "ok" for r in results)
    return {
        "akshare_version": getattr(ak, "__version__", "unknown"),
        "yfinance_version": getattr(yf, "__version__", "unknown"),
        "probe_code": A_SHARE_PROBE_CODE,
        "probes": {
            "a_share": A_SHARE_PROBE_CODE,
            "us": US_PROBE_SYMBOL,
            "hk": HK_PROBE_SYMBOL,
        },
        "overall": "ok" if overall_ok else "degraded",
        "services": results,
        "cached": all(r.get("cached") for r in results),
        "updated_at": _latest_updated_at(results),
        "cache_ttl_seconds": int(HEALTH_CACHE_TTL.total_seconds()),
    }


@router.get("/health/{service_name}")
async def refresh_service(service_name: str) -> dict:
    """只刷新一个 service 的缓存。"""
    if service_name not in SERVICE_NAMES:
        return {"error": f"unknown service: {service_name}", "status": "fail"}
    service = await _get_service_status(service_name, force=True)
    return {"service": service}
