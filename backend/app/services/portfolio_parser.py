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

from app.data.symbols import (
    POPULAR_HK_US,
    detect_exchange,
    fetch_all_codes,
    fetch_all_hk_codes,
    normalize_symbol,
    validate_code,
)
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
# 行内"裸"6 位代码（用于同花顺"名称换行代码"合并）
BARE_CODE_RE = re.compile(r"(?<!\d)(\d{6})(?!\d)")
HAS_CJK_RE = re.compile(r"[一-鿿]")

# 同花顺持仓页固定字段词（用于自动判别截图来源）。
THS_KEYWORDS = (
    "持仓盈亏", "浮动盈亏", "当日盈亏", "参考市值", "成本价", "市值",
    "现价", "持仓", "可用", "冻结", "盈亏", "摊薄", "同花顺",
)
# 纯表头 / 汇总噪声行（不含个股，归一化后整行就是这些词时丢弃）。
THS_NOISE_TOKENS = (
    "持仓盈亏", "浮动盈亏", "当日盈亏", "参考市值", "总资产", "总市值",
    "可用", "可取", "冻结", "成本价", "现价", "市值", "盈亏", "数量",
    "持仓", "名称", "代码", "摊薄成本", "持仓占比", "仓位",
)


def _looks_like_ths(text: str) -> bool:
    """关键词指纹：命中 >=2 个同花顺持仓页字段词即判定为同花顺截图。"""
    hits = sum(1 for kw in THS_KEYWORDS if kw in text)
    return hits >= 2


def _is_ths_noise_line(line: str) -> bool:
    """整行只由表头/汇总词构成（无 6 位代码、无中文股名残留）→ 噪声，丢弃。"""
    if BARE_CODE_RE.search(line):
        return False
    stripped = re.sub(r"[\s,，.。:：%+\-/|()（）0-9]", "", line)
    if not stripped:
        return True  # 纯数字/符号行（如单独一列盈亏%），交给合并逻辑前先不丢
    # 去掉所有噪声词后还剩中文 → 可能是股名，保留
    leftover = stripped
    for tok in THS_NOISE_TOKENS:
        leftover = leftover.replace(tok, "")
    return leftover == ""


def _normalize_ths_text(text: str) -> str:
    """同花顺截图文本归一化：
    1) 丢弃纯表头/汇总噪声行；
    2) "股票名称" 单独成行、6 位代码在下一行时，合并成一行（同花顺常见排版）。
    """
    raw_lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    kept = [ln for ln in raw_lines if not _is_ths_noise_line(ln)]

    merged: list[str] = []
    i = 0
    while i < len(kept):
        cur = kept[i]
        nxt = kept[i + 1] if i + 1 < len(kept) else ""
        cur_has_code = bool(BARE_CODE_RE.search(cur))
        cur_has_cjk = bool(HAS_CJK_RE.search(cur))
        # 当前行是"纯中文名（无代码）"，下一行带 6 位代码 → 合并
        if cur_has_cjk and not cur_has_code and BARE_CODE_RE.search(nxt):
            merged.append(f"{cur} {nxt}")
            i += 2
            continue
        merged.append(cur)
        i += 1
    return "\n".join(merged)


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


CJK_ONLY_RE = re.compile(r"[一-鿿]+")


def _cjk_only(s: str) -> str:
    return "".join(CJK_ONLY_RE.findall(s))


def _fuzzy_find_name(line_cjk: str, sorted_names: list[str]) -> str | None:
    """OCR 名字容错匹配：字序颠倒（长江电力↔长电力江）、个别字认错（制药↔制约）也能命中。

    仅对 >=3 字的股名启用：3 字名要求全字命中（只容颠倒），4 字及以上容 1 字错，
    避免 2 字名误匹配。返回命中的标准股名或 None。
    """
    if len(line_cjk) < 3:
        return None
    best: tuple[int, int, str] | None = None  # (重合字数, 名字长度, 名字)
    for nm in sorted_names:
        L = len(nm)
        if L < 3 or L > len(line_cjk):
            continue
        need = L if L == 3 else L - 1
        local = 0
        for i in range(0, len(line_cjk) - L + 1):
            window = line_cjk[i : i + L]
            common = sum(1 for c in nm if c in window)
            if common > local:
                local = common
            if local == L:
                break
        if local >= need:
            cand = (local, L, nm)
            if best is None or (cand[0], cand[1]) > (best[0], best[1]):
                best = cand
    return best[2] if best else None


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


async def parse_text(text: str, source: str | None = None) -> ParseResult:
    """文本粘贴 / OCR 输出路径。

    - source="ths"：强制走同花顺归一化；"generic"：强制通用；None/"auto"：关键词指纹自动判别。
    - 同花顺路径会先做文本归一化，再与通用解析结果比对，谁识别出的有效持仓多就用谁
      （自动回退，避免归一化把版面规则套坏后比通用还差）。
    """
    is_ths = source == "ths" or (source in (None, "auto") and _looks_like_ths(text))
    if not is_ths:
        return await _parse_holding_lines(text)

    ths_result = await _parse_holding_lines(_normalize_ths_text(text))
    plain_result = await _parse_holding_lines(text)
    ths_valid = sum(1 for h in ths_result.holdings if h.valid)
    plain_valid = sum(1 for h in plain_result.holdings if h.valid)
    return ths_result if ths_valid >= plain_valid else plain_result


async def _parse_holding_lines(text: str) -> ParseResult:
    """逐行解析（通用核心）：

    多 stage 兜底：
      1) 行内含 6 位代码 → 用代码（最准）
      2) 没代码 → 在归一化后的行里搜全量股票名（按名字长度倒序）
      3) 都失败 → warning，跳过
    """
    holdings: list[HoldingItem] = []
    warnings: list[str] = []

    # 拉全量股票名 → 代码 索引（缓存里有，毫秒级）。A 股 + 港股 + 常用美股，
    # 因为同花顺持仓页只显示名字不显示代码，必须靠名字反查（港股名录也要在内）。
    try:
        all_codes = await fetch_all_codes()
    except Exception:
        all_codes = []
    try:
        hk_codes = await fetch_all_hk_codes()
    except Exception:
        hk_codes = []

    name_to_info: dict[str, dict] = {}

    def _add(code: str, name: str, exchange: str) -> None:
        nm = _normalize_for_match(name)
        if nm and nm not in name_to_info:
            name_to_info[nm] = {"code": code, "name": name, "exchange": exchange}

    for it in all_codes:
        try:
            _add(it["code"], it["name"], detect_exchange(it["code"]))
        except ValueError:
            continue
    for it in hk_codes:
        _add(it["code"], it["name"], it.get("exchange", "hk"))
    for it in POPULAR_HK_US:
        _add(it["code"], it["name"], it["exchange"])

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

        # Stage 2: 名字兜底（先精确子串，再 OCR 容错模糊匹配）
        if info is None:
            line_norm = _normalize_for_match(line)
            for nm in sorted_names:
                if len(nm) >= 2 and nm in line_norm:
                    info = dict(name_to_info[nm])  # 已含 code / name / exchange
                    break
            if info is None:
                fuzzy = _fuzzy_find_name(_cjk_only(line_norm), sorted_names)
                if fuzzy:
                    info = dict(name_to_info[fuzzy])

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
