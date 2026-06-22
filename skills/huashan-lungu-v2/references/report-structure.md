# 结构化报告格式

> 所有分析结果以JSON格式存储，确保信息不丢失、可追溯。
> 后续角色可直接查询需要的字段，不需要反复对话。

---

## 全局状态结构

```json
{
  "session_id": "hs20240115001",
  "timestamp": "2024-01-15T10:30:00",
  "user_input": {
    "type": "text|image|table",
    "raw_content": "...",
    "parsed_holdings": [...]
  },
  "portfolio_overview": {
    "total_stocks": 5,
    "total_value": "100万",
    "concentration_top3": "70%",
    "industry_distribution": {
      "白酒": "35%",
      "新能源": "35%",
      "银行": "15%",
      "公用事业": "15%"
    },
    "overall_pnl": "+8%",
    "market": "A股"
  },
  "analyst_reports": {
    "fundamentals": [...],
    "sentiment": [...],
    "news": [...],
    "technical": [...]
  },
  "master_debate": {
    "mode": "single|multi",
    "masters": ["段永平", "芒格", "散户乙"],
    "camps": {
      "bullish": ["段永平", "散户乙"],
      "bearish": ["芒格"]
    },
    "debate_log": [...],
    "consensus": "...",
    "divergence": "..."
  },
  "risk_control": {
    "aggressive": {...},
    "neutral": {...},
    "conservative": {...},
    "final_suggestion": "..."
  },
  "final_report": "..."
}
```

---

## 持仓数据结构

```json
{
  "holdings": [
    {
      "name": "贵州茅台",
      "code": "600519.SH",
      "current_price": 1700,
      "shares": 100,
      "market_value": "17万",
      "weight": "35%",
      "pnl": "+10%",
      "industry": "白酒"
    }
  ]
}
```

---

## 分析师报告结构

### 基本面分析师

```json
{
  "analyst": "基本面分析师",
  "stocks": [
    {
      "name": "贵州茅台",
      "code": "600519.SH",
      "metrics": {
        "pe": 30,
        "pb": 8,
        "ps": 12,
        "roe": 32,
        "roa": 25,
        "gross_margin": "91%",
        "net_margin": "52%",
        "fcf": "500亿",
        "debt_ratio": "20%",
        "dividend_yield": "2.5%"
      },
      "valuation_level": "合理偏高",
      "quality_score": 90,
      "summary": "高ROE、充沛现金流、低负债、品牌护城河强"
    }
  ]
}
```

### 情绪分析师

```json
{
  "analyst": "情绪分析师",
  "stocks": [
    {
      "name": "贵州茅台",
      "code": "600519.SH",
      "sentiment": {
        "score": 0.6,
        "trend": "偏乐观",
        "change_7d": "+0.1"
      },
      "discussion": {
        "heat": "高",
        "change_30d": "+15%",
        "platforms": ["雪球", "东方财富"]
      },
      "institutional": {
        "holding_change": "增持",
        "top_holders": ["北向资金", "公募基金"]
      }
    }
  ]
}
```

### 新闻分析师

```json
{
  "analyst": "新闻分析师",
  "stocks": [
    {
      "name": "贵州茅台",
      "code": "600519.SH",
      "recent_news": [
        {
          "date": "2024-01-10",
          "title": "茅台提价预期升温",
          "sentiment": "positive"
        }
      ],
      "announcements": [
        {
          "date": "2024-01-05",
          "title": "2023年业绩预告",
          "summary": "净利润同比增长15%"
        }
      ],
      "industry_trend": "白酒行业回暖",
      "policy_impact": "中性"
    }
  ]
}
```

### 技术分析师

```json
{
  "analyst": "技术分析师",
  "stocks": [
    {
      "name": "贵州茅台",
      "code": "600519.SH",
      "price": {
        "current": 1700,
        "change_5d": "+3%",
        "change_20d": "+8%"
      },
      "trend": {
        "daily": "上升趋势",
        "weekly": "上升趋势",
        "monthly": "震荡"
      },
      "indicators": {
        "macd": {
          "signal": "金叉",
          "histogram": "正值扩大"
        },
        "rsi": {
          "value": 65,
          "status": "偏强"
        },
        "ma": {
          "ma5": 1680,
          "ma20": 1650,
          "ma60": 1600,
          "status": "多头排列"
        }
      },
      "volume": {
        "trend": "放量",
        "price_volume": "量价配合"
      },
      "levels": {
        "support": [1500, 1450],
        "resistance": [1800, 1900]
      }
    }
  ]
}
```

---

## 大师辩论结构

```json
{
  "master_debate": {
    "mode": "multi",
    "masters": ["段永平", "芒格", "散户乙"],
    "camps": {
      "bullish": ["段永平", "散户乙"],
      "bearish": ["芒格"]
    },
    "debate_log": [
      {
        "round": 1,
        "stock": "贵州茅台",
        "speaker": "段永平",
        "camp": "bullish",
        "content": "茅台的商业模式我看得懂...",
        "key_points": ["品牌护城河", "现金流", "企业文化"]
      },
      {
        "round": 1,
        "stock": "贵州茅台",
        "speaker": "芒格",
        "camp": "bearish",
        "content": "35%仓位是Lollapalooza风险...",
        "key_points": ["集中度风险", "逆向思考"]
      }
    ],
    "consensus": "茅台在裸股+真看懂的前提下可以重仓",
    "divergence": "芒格认为35%风险过高，段永平和散户乙认为合理"
  }
}
```

---

## 风控审核结构

```json
{
  "risk_control": {
    "aggressive": {
      "view": "茅台护城河稳固，建议加到40%",
      "reason": ["品牌优势", "定价权", "现金流充沛"],
      "suggestion": "加仓至40%"
    },
    "neutral": {
      "view": "35%已经很重，维持现状",
      "reason": ["估值合理偏高", "集中度风险存在"],
      "suggestion": "维持35%，设止损位"
    },
    "conservative": {
      "view": "单股35%风险过高，建议降到20%",
      "reason": ["集中度风险", "估值不便宜", "黑天鹅风险"],
      "suggestion": "减仓至20%，分散到其他标的"
    },
    "final_suggestion": "维持35%，但设止损位1500元，跌破减仓"
  }
}
```

---

## 使用说明

1. **分析师团队**：产出报告后存入 `analyst_reports` 字段
2. **大师辩论**：查询 `analyst_reports` 获取数据，辩论结果存入 `master_debate`
3. **风控团队**：查询 `master_debate` 获取大师观点，审核结果存入 `risk_control`
4. **最终报告**：汇总所有字段，生成用户可读的报告

**好处**：
- 信息不丢失
- 可追溯每一步
- 后续角色直接查询，不需要反复对话
