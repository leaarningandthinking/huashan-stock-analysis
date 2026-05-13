"""股票相关 API：代码校验 + 模糊搜索。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.data.symbols import search_codes, validate_code

router = APIRouter(prefix="/api/stock", tags=["stock"])


@router.get("/validate/{code}")
async def validate(code: str) -> dict:
    """校验单个代码。返回 {ok, code, name, exchange} 或 {ok: False, reason}。"""
    info = await validate_code(code)
    if info is None:
        raise HTTPException(404, f"代码不存在或非法: {code}")
    return {"ok": True, **info}


@router.get("/search")
async def search(q: str = Query(..., min_length=1, max_length=20),
                 limit: int = Query(20, ge=1, le=50)) -> list[dict]:
    """按代码或名字模糊搜索。例: ?q=茅台 / ?q=600519"""
    return await search_codes(q, limit=limit)
