"""把 4 个 analyst 的输出整合成喂给大师 / 风控的"数据卡片"。

设计原则：
- 不让大师再次去查 akshare（数据已经过 analyst 的眼）
- 卡片简洁：每个 analyst 给一个段落标题
- 失败的 analyst 标"数据缺失"，不混入垃圾
"""

from __future__ import annotations

from app.prompts.analysts import ANALYST_LABELS


def build_report_for_debate(
    holdings: list[dict],
    analyst_results: dict[str, dict],
) -> str:
    """生成一份给大师辩论用的 markdown 数据卡片。"""
    parts: list[str] = []

    # 持仓概览
    parts.append("# 用户持仓")
    for h in holdings:
        line = f"- {h['name']}（{h['code']}"
        if h.get("weight") is not None:
            line += f", 占比 {h['weight']*100:.1f}%"
        if h.get("pnl") is not None:
            sign = "+" if h["pnl"] >= 0 else ""
            line += f", 浮盈 {sign}{h['pnl']*100:.1f}%"
        line += "）"
        parts.append(line)
    parts.append("")

    # 每个 analyst 一段
    for role in ("fundamental", "sentiment", "news", "technical"):
        label = ANALYST_LABELS.get(role, role)
        result = analyst_results.get(role)
        parts.append(f"## {label}的报告")
        if result is None or result.get("failed") or not result.get("text", "").strip():
            parts.append("（该维度数据暂时缺失）")
        else:
            text = result["text"].strip()
            # 限长，避免 prompt 太大
            if len(text) > 2500:
                text = text[:2500] + "\n…（已截断）"
            parts.append(text)
        parts.append("")

    return "\n".join(parts)
