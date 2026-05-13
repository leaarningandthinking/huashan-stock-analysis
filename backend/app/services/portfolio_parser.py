"""持仓解析 service。

支持三种输入：
- manual：用户手动填的结构化行
- text：复制粘贴的文本（多行，每行一只）
- codes：单股 / 批量场景，只有代码列表

所有路径最终归一到 HoldingItem 列表 + 概览。
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.data.symbols import detect_exchange, fetch_all_codes, normalize_symbol, validate_code
from app.schemas.portfolio import (
    HoldingInput,
    HoldingItem,
    PortfolioOverview,
)


@dataclass
class ParseResult:
    holdings: list[HoldingItem]
    warnings: list[str]


# 文本粘贴解析支持的格式（按行）：
# 600519 贵州茅台 100 1500
# 600519,贵州茅台,100,1500
# 贵州茅台 600519 100股 1500元
# 600519
TEXT_LINE_RE = re.compile(r"[,\s\t]+")
CODE_IN_TEXT_RE = re.compile(r"\b(\d{6}|\d{1,5}\.HK|[A-Z]{3,6})\b")
NUMBER_RE = re.compile(r"-?\d+(?:\.\d+)?")


async def parse_codes_only(codes: list[str]) -> ParseResult:
    """单股 / 批量：只校验代码 + 取名字。"""
    holdings: list[HoldingItem] = []
    warnings: list[str] = []
    for raw in codes:
        code = normalize_symbol(raw)
        info = await validate_code(code)
        if info is None:
            warnings.append(f"代码 {raw} 不存在或非法")
            holdings.append(HoldingItem(
                code=code, name="", exchange="",
                valid=False, warning="代码不存在",
            ))
        else:
            holdings.append(HoldingItem(
                code=info["code"], name=info["name"],
                exchange=info["exchange"], valid=True,
            ))
    return ParseResult(holdings=holdings, warnings=warnings)


async def parse_manual(rows: list[HoldingInput]) -> ParseResult:
    """手动输入路径。"""
    holdings: list[HoldingItem] = []
    warnings: list[str] = []
    for row in rows:
        info = await validate_code(row.code)
        if info is None:
            warnings.append(f"代码 {row.code} 不存在或非法")
            holdings.append(HoldingItem(
                code=row.code, name="", exchange="",
                shares=row.shares, cost=row.cost, value=row.value, weight=row.weight,
                valid=False, warning="代码不存在",
            ))
            continue
        item = HoldingItem(
            code=info["code"],
            name=info["name"],
            exchange=info["exchange"],
            shares=row.shares,
            cost=row.cost,
            value=row.value,
            weight=row.weight,
            valid=True,
        )
        # 简易盈亏估算：value / (shares * cost) - 1
        if row.shares and row.cost and row.value:
            paid = row.shares * row.cost
            if paid > 0:
                item.pnl = row.value / paid - 1
        holdings.append(item)
    return ParseResult(holdings=holdings, warnings=warnings)


def _normalize_for_match(s: str) -> str:
    """归一化：去所有空白、全角转半角、去掉 OCR 常见的杂字符。
    用于"贵 州 茅 台" / "贵州茅台Ａ" 这种情况下还能匹配。
    """
    out = "".join(s.split())
    # 全角字母数字 → 半角
    return out.translate(str.maketrans(
        "０１２３４５６７８９ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ",
        "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    ))


async def parse_text(text: str) -> ParseResult:
    """文本粘贴 / OCR 输出路径。

    多 stage 兜底：
      1) 行内含 6 位代码 → 用代码（最准）
      2) 没代码 → 在归一化后的行里搜全量股票名（按名字长度倒序）
      3) 都失败 → warning，跳过
    """
    holdings: list[HoldingItem] = []
    warnings: list[str] = []

    # 拉全量股票名 → 代码 索引（缓存里有，毫秒级）
    try:
        all_codes = await fetch_all_codes()
    except Exception:
        all_codes = []

    name_to_info: dict[str, dict] = {}
    for it in all_codes:
        nm = _normalize_for_match(it["name"])
        if nm and nm not in name_to_info:
            name_to_info[nm] = it
    # 长名字优先匹配，避免 "万科" 误中 "万科Ａ"（实际是反过来：先匹配 "万科Ａ"）
    sorted_names = sorted(name_to_info.keys(), key=len, reverse=True)

    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    seen: set[str] = set()

    for idx, line in enumerate(lines, 1):
        info: dict | None = None
        matched_code_str: str | None = None

        # Stage 1: 找 6 位代码
        m = CODE_IN_TEXT_RE.search(line)
        if m:
            code = normalize_symbol(m.group(1))
            v = await validate_code(code)
            if v is not None:
                info = v
                matched_code_str = code

        # Stage 2: 名字兜底
        if info is None:
            line_norm = _normalize_for_match(line)
            for nm in sorted_names:
                if len(nm) >= 2 and nm in line_norm:
                    it = name_to_info[nm]
                    info = {
                        "code": it["code"],
                        "name": it["name"],
                        "exchange": detect_exchange(it["code"]),
                    }
                    break

        if info is None:
            warnings.append(f"第 {idx} 行未识别股票：{line[:40]}")
            continue
        if info["code"] in seen:
            continue
        seen.add(info["code"])

        # 数字字段提取：从原行里抠数字
        rest_for_nums = line
        if matched_code_str:
            rest_for_nums = rest_for_nums.replace(matched_code_str, " ")
        # 千分隔符：1,500 → 1500（仅当逗号两侧都是数字时去掉）
        rest_for_nums = re.sub(r"(\d),(\d)", r"\1\2", rest_for_nums)
        # 同样处理可能出现的全角逗号
        rest_for_nums = re.sub(r"(\d),(\d)", r"\1\2", rest_for_nums)
        numbers = [float(x) for x in NUMBER_RE.findall(rest_for_nums)]
        shares = numbers[0] if len(numbers) >= 1 else None
        cost = numbers[1] if len(numbers) >= 2 else None
        value = numbers[2] if len(numbers) >= 3 else None

        item = HoldingItem(
            code=info["code"],
            name=info["name"],
            exchange=info["exchange"],
            shares=shares,
            cost=cost,
            value=value,
            valid=True,
        )
        if shares and cost and value:
            paid = shares * cost
            if paid > 0:
                item.pnl = value / paid - 1
        holdings.append(item)

    return ParseResult(holdings=holdings, warnings=warnings)


def compute_overview(holdings: list[HoldingItem]) -> PortfolioOverview:
    """根据持仓列表算概览。"""
    valid = [h for h in holdings if h.valid]
    count = len(valid)

    # 总市值：用户给了 value 就用，否则 shares*cost 估算
    values: list[float] = []
    for h in valid:
        if h.value is not None:
            values.append(h.value)
        elif h.shares and h.cost:
            values.append(h.shares * h.cost)
    total_value = sum(values) if values else None

    # 集中度：top 3 加权
    concentration_top3: float | None = None
    if total_value and total_value > 0 and len(values) > 0:
        sorted_vals = sorted(values, reverse=True)[:3]
        concentration_top3 = sum(sorted_vals) / total_value

    # 整体盈亏：市值加权
    overall_pnl: float | None = None
    pnl_pairs = [(h.value or (h.shares or 0) * (h.cost or 0), h.pnl)
                 for h in valid if h.pnl is not None]
    pnl_pairs = [p for p in pnl_pairs if p[0] > 0]
    if pnl_pairs:
        total_w = sum(w for w, _ in pnl_pairs)
        if total_w > 0:
            overall_pnl = sum(w * pnl for w, pnl in pnl_pairs) / total_w

    return PortfolioOverview(
        total_count=count,
        total_value=total_value,
        concentration_top3=concentration_top3,
        overall_pnl=overall_pnl,
    )
