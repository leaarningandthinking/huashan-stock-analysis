from fastapi import APIRouter, HTTPException

from app.prompts.loader import get_master_section, load_master_sections
from app.prompts.masters_meta import MASTERS, get_meta
from app.schemas.master import MasterDetail, MasterSummary

router = APIRouter(prefix="/api/masters", tags=["masters"])


@router.get("", response_model=list[MasterSummary])
async def list_masters() -> list[MasterSummary]:
    """返回 16 位大师的概览列表（按显示顺序）。"""
    sections = load_master_sections()
    items: list[MasterSummary] = []
    for meta in sorted(MASTERS, key=lambda m: m["sort"]):
        sec = sections.get(meta["slug"])
        items.append(
            MasterSummary(
                slug=meta["slug"],
                name=meta["name"],
                tagline=sec.tagline if sec else "",
                school=meta["school"],
                school_label=meta["school_label"],
                avatar_url=meta["avatar_url"],
            )
        )
    return items


@router.get("/{slug}", response_model=MasterDetail)
async def get_master(slug: str) -> MasterDetail:
    meta = get_meta(slug)
    if meta is None:
        raise HTTPException(404, f"Unknown master: {slug}")
    sec = get_master_section(slug)
    if sec is None:
        raise HTTPException(404, f"Master section not found: {slug}")
    return MasterDetail(
        slug=meta["slug"],
        name=meta["name"],
        tagline=sec.tagline,
        school=meta["school"],
        school_label=meta["school_label"],
        avatar_url=meta["avatar_url"],
        methodology=sec.methodology,
        keywords=sec.keywords,
        quotes=sec.quotes,
        checkpoints=sec.checkpoints,
        typical_critique=sec.typical_critique,
        output_style=sec.output_style,
        raw_markdown=sec.raw_markdown,
    )
