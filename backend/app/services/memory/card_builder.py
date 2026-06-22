"""L1 诊股卡片生成器。

把动辄几千 token 的诊股报告(4 分析师 + N 大师辩论 + 风控)蒸馏成
200-500 token 的符号化卡片,作为:
1. L4 画像反思任务的输入(省 80%+ token)
2. 前端"诊股历史时间线"的展示数据源
3. 跨次诊股的经验记忆

策略:规则提取覆盖 80% 字段,失败时退化为纯规则,绝不阻塞主流程。
"""

from __future__ import annotations

import logging
import re
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.diagnosis import Diagnosis
from app.models.memory import DiagnosisCard

logger = logging.getLogger(__name__)


async def build_and_save_card(
    db: AsyncSession,
    diagnosis: Diagnosis,
) -> Optional[DiagnosisCard]:
    """orchestrator 完成诊股后调用。失败不抛,只记日志。"""
    try:
        card_dict = _build_card_dict(diagnosis)
        # 如果已经有卡片(比如 partial_rerun 重生成),原地更新
        existing = (
            await db.execute(
                select(DiagnosisCard).where(
                    DiagnosisCard.diagnosis_id == diagnosis.id
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            existing.card = card_dict
            await db.commit()
            return existing

        card = DiagnosisCard(
            anon_id=diagnosis.anon_id,
            diagnosis_id=diagnosis.id,
            card=card_dict,
        )
        db.add(card)
        await db.commit()
        return card
    except Exception:
        logger.exception(
            "build_and_save_card failed for diagnosis %s", diagnosis.id
        )
        await db.rollback()
        return None


def _build_card_dict(diagnosis: Diagnosis) -> dict:
    report = diagnosis.report_json or {}
    return {
        "version": 1,
        "mode": diagnosis.mode,
        "stocks": _extract_stocks(diagnosis, report),
        "signals": _extract_analyst_signals(report),
        "masters_view": _extract_masters_view(report),
        "consensus": _detect_consensus(report),
        "risk_lean": _detect_risk_lean(report),
        "revision_count": report.get("revision_count", 0),
        "revisions": report.get("user_revisions_summary", []),
    }


def _extract_stocks(diagnosis: Diagnosis, report: dict) -> list[str]:
    """从 diagnosis.context 事件或 report.holdings 提取股票代码列表。"""
    # 优先从 events_jsonb 的 diagnosis.context 找
    for ev in (diagnosis.events_jsonb or []):
        if ev.get("event") == "diagnosis.context":
            stocks = (ev.get("data") or {}).get("stocks") or []
            codes = []
            for s in stocks:
                code = s.get("code") if isinstance(s, dict) else None
                if code:
                    codes.append(str(code))
            if codes:
                return codes
    # 回退:从 report.holdings(老结构)
    holdings = report.get("holdings") or []
    codes = []
    for h in holdings:
        code = h.get("code") if isinstance(h, dict) else None
        if code and re.match(r"^\d{6}$", str(code)):
            codes.append(str(code))
    return codes


def _extract_analyst_signals(report: dict) -> dict:
    analysts = report.get("analysts", {})
    out = {}
    for role in ("fundamental", "sentiment", "news", "technical"):
        data = analysts.get(role)
        if not data:
            out[role] = {"verdict": "missing"}
            continue
        text = data.get("text", "") if isinstance(data, dict) else ""
        out[role] = _classify_analyst_text(role, text)
    return out


def _classify_analyst_text(role: str, text: str) -> dict:
    if not text:
        return {"verdict": "empty"}

    bullish_kw = ["看多", "买入", "推荐", "强势", "上行", "向好", "估值低估", "基本面优", "金叉"]
    bearish_kw = ["看空", "卖出", "回避", "弱势", "下行", "下跌风险", "估值高估", "基本面差", "死叉", "空头排列"]
    cautious_kw = ["中性", "观望", "谨慎", "震荡", "持有"]

    score = 0
    for kw in bullish_kw:
        if kw in text:
            score += 1
    for kw in bearish_kw:
        if kw in text:
            score -= 1

    verdict = (
        "bullish" if score >= 2 else
        "bearish" if score <= -2 else
        "cautious" if any(k in text for k in cautious_kw) else
        "neutral"
    )

    out: dict = {"verdict": verdict, "evidence_score": score}

    if role == "technical":
        rsi_match = re.search(r"RSI[^\d]{0,8}(\d{1,3}(?:\.\d+)?)", text)
        if rsi_match:
            try:
                rsi_val = float(rsi_match.group(1))
                out["rsi"] = rsi_val
                if rsi_val > 70:
                    out["overbought"] = True
                if rsi_val < 30:
                    out["oversold"] = True
            except ValueError:
                pass

    return out


def _extract_masters_view(report: dict) -> dict:
    debate = report.get("debate", {}) or {}
    transcript = debate.get("transcript", []) if isinstance(debate, dict) else []
    if not transcript:
        return {}

    # 取每位大师最新一轮的发言
    latest = {}
    for entry in transcript:
        slug = entry.get("master")
        if slug:
            latest[slug] = entry.get("text", "")

    return {slug: _classify_master_text(text) for slug, text in latest.items()}


def _classify_master_text(text: str) -> str:
    if not text:
        return "unknown"
    sell_kw = ["卖出", "减仓", "清仓", "回避", "不建议", "看空"]
    buy_kw = ["买入", "加仓", "建议持有", "可以买", "看好", "推荐"]
    hold_kw = ["观望", "持有", "暂不操作", "等待", "中性"]

    if any(k in text for k in sell_kw):
        return "sell"
    if any(k in text for k in buy_kw):
        return "buy"
    if any(k in text for k in hold_kw):
        return "hold"
    return "unknown"


def _detect_consensus(report: dict) -> str:
    masters_view = _extract_masters_view(report)
    if not masters_view:
        return "no_data"
    votes = list(masters_view.values())
    buy = sum(1 for v in votes if v == "buy")
    sell = sum(1 for v in votes if v == "sell")
    hold = sum(1 for v in votes if v == "hold")
    total = len(votes)
    if total == 0:
        return "no_data"

    if buy / total >= 0.7:
        return "strong_buy"
    if sell / total >= 0.7:
        return "strong_sell"
    if buy > sell + hold:
        return "lean_buy"
    if sell > buy + hold:
        return "lean_sell"
    return "split"


def _detect_risk_lean(report: dict) -> str:
    risk = report.get("risk", {}) or {}
    leans = []
    # 项目实际只有 aggressive + conservative 两派(没有 neutral)
    for school in ("aggressive", "neutral", "conservative"):
        data = risk.get(school)
        if not data:
            continue
        text = data.get("text", "") if isinstance(data, dict) else str(data)
        if any(k in text for k in ["买入", "加仓", "推荐"]):
            leans.append(("buy", school))
        elif any(k in text for k in ["回避", "减仓", "卖出"]):
            leans.append(("sell", school))
        else:
            leans.append(("neutral", school))

    if not leans:
        return "no_data"

    buys = [l for l in leans if l[0] == "buy"]
    sells = [l for l in leans if l[0] == "sell"]
    if len(buys) == len(leans):
        return "all_buy"
    if len(sells) == len(leans):
        return "all_sell"
    if buys and not sells:
        return f"lean_buy_via_{buys[0][1]}"
    if sells and not buys:
        return f"lean_sell_via_{sells[0][1]}"
    return "mixed"
