"""解析 skills/huashan-lungu-v2/references/masters.md，按大师拆 section。

启动时一次性加载到内存。后端通过 slug 查询。
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from app.config import get_settings
from app.prompts.masters_meta import MASTERS, find_meta_by_name


@dataclass
class MasterSection:
    slug: str
    name: str
    tagline: str
    methodology: str
    keywords: list[str]
    quotes: list[str]
    checkpoints: list[str]
    typical_critique: str
    output_style: str
    raw_markdown: str


_HEADING_RE = re.compile(r"^### ([^\n]+?) · (.+)$", re.MULTILINE)


def _split_sections(md: str) -> list[tuple[str, str, str]]:
    """从 markdown 切出 (name, tagline, body) 三元组。"""
    headings = list(_HEADING_RE.finditer(md))
    sections: list[tuple[str, str, str]] = []
    for i, m in enumerate(headings):
        name = m.group(1).strip()
        tagline = m.group(2).strip()
        body_start = m.end()
        body_end = headings[i + 1].start() if i + 1 < len(headings) else len(md)
        body = md[body_start:body_end].strip()
        # 去掉末尾的 `---` 分隔符
        body = re.sub(r"\n---\s*$", "", body).strip()
        sections.append((name, tagline, body))
    return sections


def _extract_field(body: str, label: str) -> str:
    """提取 `**Label**：内容` 格式的单行字段。"""
    pattern = re.compile(rf"\*\*{re.escape(label)}\*\*[：:]\s*(.+)")
    m = pattern.search(body)
    return m.group(1).strip() if m else ""


def _extract_list_field(body: str, label: str) -> list[str]:
    """提取 `**Label ...**：` 后跟着的 - 列表 或 1. 列表。
    label 后可能跟数字、量词等（如 `**分析必查 6 条**`），用 [^*]* 兼容。
    """
    pattern = re.compile(
        rf"\*\*{re.escape(label)}[^*]*\*\*[^\n]*\n((?:\s*[-\d].+\n?)+)",
        re.MULTILINE,
    )
    m = pattern.search(body)
    if not m:
        return []
    block = m.group(1)
    items: list[str] = []
    for line in block.splitlines():
        line = line.strip()
        if not line:
            continue
        # 去掉 "- " / "1. " 前缀
        line = re.sub(r"^[-•]\s*", "", line)
        line = re.sub(r"^\d+\.\s*", "", line)
        line = line.strip().strip("\"“”")
        if line:
            items.append(line)
    return items


def _parse_keywords(body: str) -> list[str]:
    raw = _extract_field(body, "关键术语")
    if not raw:
        return []
    return [k.strip() for k in raw.split("/") if k.strip()]


@lru_cache(maxsize=1)
def load_master_sections() -> dict[str, MasterSection]:
    settings = get_settings()
    md_path: Path = settings.skill_dir / "references" / "masters.md"
    if not md_path.exists():
        # 开发期外部直接跑（非 docker），尝试相对路径
        fallback = Path(__file__).resolve().parents[3] / "skills" / "huashan-lungu-v2" / "references" / "masters.md"
        if fallback.exists():
            md_path = fallback
    md = md_path.read_text(encoding="utf-8")

    sections: dict[str, MasterSection] = {}
    for name, tagline, body in _split_sections(md):
        meta = find_meta_by_name(name)
        if meta is None:
            continue
        sections[meta["slug"]] = MasterSection(
            slug=meta["slug"],
            name=meta["name"],
            tagline=tagline,
            methodology=_extract_field(body, "核心方法论"),
            keywords=_parse_keywords(body),
            quotes=_extract_list_field(body, "代表语录"),
            checkpoints=_extract_list_field(body, "分析必查"),
            typical_critique=_extract_field(body, "典型批评对象"),
            output_style=_extract_field(body, "输出风格"),
            raw_markdown=body,
        )
    return sections


def get_master_section(slug: str) -> MasterSection | None:
    return load_master_sections().get(slug)


def list_all_slugs() -> list[str]:
    return [m["slug"] for m in MASTERS]
