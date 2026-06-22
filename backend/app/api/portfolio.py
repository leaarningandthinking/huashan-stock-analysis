"""持仓 / 单股 / 批量入口的统一解析接口。

POST /api/portfolio/parse
- 输入：mode + (manual | text | codes) 三选一
- 输出：portfolio_id + holdings + overview + warnings
- 副作用：持久化一条 portfolio 记录到 Postgres，方便后续诊断引用
"""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_anon, get_database
from app.models.anonymous import AnonymousSession
from app.models.diagnosis import Portfolio
from app.schemas.portfolio import PortfolioParseRequest, PortfolioParseResponse
from app.services.portfolio_parser import (
    compute_overview,
    parse_codes_only,
    parse_manual,
    parse_text,
)

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])


@router.get("/recent")
async def recent_portfolios(
    limit: int = 3,
    anon: AnonymousSession = Depends(get_anon),
    db: AsyncSession = Depends(get_database),
) -> list[dict]:
    result_limit = max(1, min(limit, 10))
    rows = (
        await db.execute(
            select(Portfolio)
            .where(Portfolio.anon_id == anon.id)
            .order_by(desc(Portfolio.created_at))
            .limit(result_limit * 5)
        )
    ).scalars().all()

    result: list[dict] = []
    for pf in rows:
        payload = pf.holdings_json if isinstance(pf.holdings_json, dict) else {}
        if payload.get("mode") != "portfolio":
            continue
        holdings = payload.get("holdings")
        if not isinstance(holdings, list) or not holdings:
            continue
        result.append(
            {
                "portfolio_id": str(pf.id),
                "created_at": pf.created_at.isoformat(),
                "holdings": holdings,
                "overview": payload.get("overview") or {},
            }
        )
        if len(result) >= result_limit:
            break
    return result


@router.post("/parse", response_model=PortfolioParseResponse)
async def parse_portfolio(
    req: PortfolioParseRequest,
    anon: AnonymousSession = Depends(get_anon),
    db: AsyncSession = Depends(get_database),
) -> PortfolioParseResponse:
    if req.mode in ("single", "batch"):
        if not req.codes:
            raise HTTPException(400, f"{req.mode} 模式必须提供 codes")
        if req.mode == "single" and len(req.codes) != 1:
            raise HTTPException(400, "single 模式只接受 1 个代码")
        if req.mode == "batch" and not (1 <= len(req.codes) <= 10):
            raise HTTPException(400, "batch 模式接受 1-10 个代码")
        result = await parse_codes_only(req.codes)
    elif req.mode == "portfolio":
        if req.manual:
            result = await parse_manual(req.manual)
        elif req.text:
            result = await parse_text(req.text, source=req.source)
        else:
            raise HTTPException(400, "portfolio 模式必须提供 manual 或 text")
    else:
        raise HTTPException(400, f"unknown mode: {req.mode}")

    overview = compute_overview(result.holdings)

    # 持久化
    pf = Portfolio(
        anon_id=anon.id,
        holdings_json={
            "mode": req.mode,
            "holdings": [h.model_dump() for h in result.holdings],
            "overview": overview.model_dump(),
        },
        raw_input=(req.text or json.dumps([h.model_dump() for h in (req.manual or [])])
                   or ",".join(req.codes or []))[:5000],
    )
    db.add(pf)
    await db.commit()
    await db.refresh(pf)

    return PortfolioParseResponse(
        portfolio_id=str(pf.id),
        mode=req.mode,
        holdings=result.holdings,
        overview=overview,
        warnings=result.warnings,
    )
