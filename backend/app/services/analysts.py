"""分析师业务逻辑。每位分析师 = 拉数据 + 喂 LLM + 流式输出。

W5a：先实现 fundamental analyst 端到端。其他三位结构相同，复用框架。
"""

from __future__ import annotations

import json
import logging

from app.core.sse import EventQueue
from app.data.fundamentals import get_financial_abstract, get_industry_valuation, get_valuation
from app.data.news import get_news
from app.data.sentiment import get_sentiment
from app.data.technical import get_technical
from app.llm.base import LLMClient, Message
from app.prompts.analysts import ANALYST_LABELS, SYSTEM_PROMPTS

logger = logging.getLogger(__name__)


def _truncate_json(obj, max_chars: int = 4000) -> str:
    """把 dict / list 转成中文友好 JSON，并裁掉超长部分。"""
    s = json.dumps(obj, ensure_ascii=False, indent=2)
    if len(s) <= max_chars:
        return s
    return s[:max_chars] + "\n…（数据过长已截断）"


def _format_financial_card(fin: dict) -> str:
    """把关键财务指标压成稳定可读的 markdown，避免原始 JSON 截断丢掉现金流/负债。"""
    rows = fin.get("rows") or []
    if not rows:
        return _truncate_json(fin, 4500)

    lines = []
    source = fin.get("source")
    periods = fin.get("periods") or []
    if source:
        lines.append(f"- 数据源: {source}")
    if periods:
        lines.append(f"- 覆盖期间: {' / '.join(periods[:4])}")
    lines.append("")

    for category in ("利润表", "现金流量表", "资产负债表"):
        category_rows = [row for row in rows if row.get("category") == category]
        if not category_rows:
            lines.append(f"### {category}")
            lines.append("- 数据缺失")
            lines.append("")
            continue
        lines.append(f"### {category}")
        for row in category_rows:
            values = row.get("values") or {}
            value_text = "；".join(f"{period}: {value}" for period, value in values.items())
            lines.append(f"- {row.get('indicator')}: {value_text}")
        lines.append("")
    return "\n".join(lines).strip()


async def _build_data_card(role: str, code: str, name: str) -> tuple[str, dict]:
    """根据 analyst 角色拉对应数据，返回 (markdown 数据卡片, 原始 dict)。"""
    if role == "fundamental":
        import asyncio as _aio
        fin, val, ind_val = await _aio.gather(
            get_financial_abstract(code), get_valuation(code),
            get_industry_valuation(code),
            return_exceptions=False,
        )
        if not fin and not val:
            return "（基本面数据暂时拉不到）", {}
        parts = [f"# 基本面数据卡片 · {name}（{code}）", ""]
        if val and val.get("metrics"):
            source = f" · {val.get('source')}" if val.get("source") else ""
            parts.append(f"## 当前估值（{val.get('as_of', '')}{source}）")
            for k, v in val["metrics"].items():
                if v is None:
                    continue
                if k == "总市值":
                    parts.append(f"- {k}: {v:.0f} 亿元")
                elif k == "股息率":
                    parts.append(f"- {k}: {v:.2f}%")
                else:
                    parts.append(f"- {k}: {v:.2f}")
            for flag in val.get("quality_flags") or []:
                parts.append(f"- 数据质量提示: {flag.get('message')}")
            parts.append("")
        if ind_val:
            parts.append(f"## 行业估值对标（{ind_val.get('industry_name', '')} · {ind_val.get('parent', '')}）")
            parts.append(f"- 行业 PE(静): {ind_val.get('pe_static') or '—'}")
            parts.append(f"- 行业 PE(TTM): {ind_val.get('pe_ttm') or '—'}")
            parts.append(f"- 行业 PB: {ind_val.get('pb') or '—'}")
            parts.append(f"- 行业股息率: {ind_val.get('dividend_yield') or '—'}%")
            parts.append(f"- 成分股数: {ind_val.get('count', 0)}")
            parts.append("")
        elif "." in code or not code.isdigit():
            parts.append("## 行业估值对标")
            parts.append("- 港美股暂未提供可比行业估值对标；估值判断仅基于个股 yfinance 指标，不能与行业 PE/PB 直接比较。")
            parts.append("")
        if fin:
            parts.append("## 财务摘要（近 4 期）")
            parts.append(_format_financial_card(fin))
        return "\n".join(parts), {"financial": fin, "valuation": val, "industry": ind_val}

    if role == "sentiment":
        stock_sentiment = await get_sentiment(code)
        if not stock_sentiment:
            return "（情绪数据暂时拉不到）", {}
        return f"# 情绪数据卡片 · {name}（{code}）\n\n{_truncate_json(stock_sentiment)}", stock_sentiment

    if role == "news":
        data = await get_news(code, limit=10)
        if not data:
            return "（新闻数据暂时拉不到）", {}
        return f"# 近期新闻 · {name}（{code}）\n\n{_truncate_json(data)}", {"items": data}

    if role == "technical":
        data = await get_technical(code, days=60)
        if not data:
            return "（技术数据暂时拉不到）", {}
        return f"# 技术指标卡片 · {name}（{code}）\n\n{_truncate_json(data, 6000)}", data

    raise ValueError(f"unknown analyst role: {role}")


async def run_analyst(
    role: str,
    *,
    holdings: list[dict],
    queue: EventQueue,
    llm: LLMClient,
    model: str,
) -> dict:
    """运行一个分析师。
    - holdings: list of {code, name}（valid only），按持仓清单逐个分析
    - 每个 token 通过 queue.emit('analyst.delta')
    - 完成后 emit 'analyst.done' 并返回 summary
    """
    label = ANALYST_LABELS[role]
    await queue.emit("analyst.start", analyst=role, label=label,
                     stocks=[{"code": h["code"], "name": h["name"]} for h in holdings])

    full_text_parts: list[str] = []
    show_stock_heading = len(holdings) > 1

    for h in holdings:
        code, name = h["code"], h["name"]
        if show_stock_heading:
            await queue.emit("analyst.delta", analyst=role,
                             text=f"\n\n## {name}（{code}）\n\n", marker=True)

        try:
            card, _raw = await _build_data_card(role, code, name)
        except Exception as e:
            logger.warning("[%s] build_data_card failed for %s: %s", role, code, e)
            await queue.emit("analyst.delta", analyst=role,
                             text=f"⚠️ 数据获取异常：{type(e).__name__}\n")
            continue

        messages = [
            Message(role="system", content=SYSTEM_PROMPTS[role]),
            Message(role="user", content=card),
        ]

        chunk_count = 0
        try:
            async for delta in llm.stream(messages, model, temperature=0.4, max_tokens=600):
                full_text_parts.append(delta)
                await queue.emit("analyst.delta", analyst=role, text=delta)
                chunk_count += 1
        except Exception as e:
            logger.warning("[%s] LLM stream failed for %s: %s", role, code, e)
            err = f"\n\n⚠️ LLM 调用失败：{type(e).__name__}: {str(e)[:120]}\n"
            full_text_parts.append(err)
            await queue.emit("analyst.delta", analyst=role, text=err)

    summary = "".join(full_text_parts)
    await queue.emit("analyst.done", analyst=role, label=label,
                     length=len(summary))
    return {"role": role, "label": label, "text": summary}
