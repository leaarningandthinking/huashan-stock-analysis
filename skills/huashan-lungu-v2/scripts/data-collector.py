#!/usr/bin/env python3
"""
华山论股 V2 数据抓取脚本

功能：
- 抓取股票基本面数据（PE/PB/ROE/现金流等）
- 抓取社交媒体情绪数据（雪球/东方财富）
- 抓取新闻公告数据
- 计算技术指标（MACD/RSI/均线等）

使用方法：
    python data-collector.py --stocks 600519,000858 --output analysis.json
"""

import argparse
import json
import requests
from datetime import datetime, timedelta
from typing import List, Dict, Any
import time


class DataCollector:
    """数据抓取器"""

    def __init__(self):
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        }

    def collect_all(self, stock_codes: List[str]) -> Dict[str, Any]:
        """抓取所有数据"""
        result = {
            "timestamp": datetime.now().isoformat(),
            "stocks": []
        }

        for code in stock_codes:
            print(f"正在抓取 {code} 的数据...")
            stock_data = self.collect_single_stock(code)
            result["stocks"].append(stock_data)
            time.sleep(1)  # 避免请求过快

        return result

    def collect_single_stock(self, code: str) -> Dict[str, Any]:
        """抓取单只股票的所有数据"""
        return {
            "code": code,
            "fundamentals": self.get_fundamentals(code),
            "sentiment": self.get_sentiment(code),
            "news": self.get_news(code),
            "technical": self.get_technical(code)
        }

    def get_fundamentals(self, code: str) -> Dict[str, Any]:
        """获取基本面数据"""
        # 实际实现需要调用真实API
        # 这里返回示例数据结构
        return {
            "pe": None,
            "pb": None,
            "roe": None,
            "fcf": None,
            "debt_ratio": None,
            "dividend_yield": None,
            "data_source": "placeholder"
        }

    def get_sentiment(self, code: str) -> Dict[str, Any]:
        """获取情绪数据"""
        # 实际实现需要爬取雪球/东方财富等平台
        return {
            "score": None,
            "trend": None,
            "discussion_heat": None,
            "data_source": "placeholder"
        }

    def get_news(self, code: str) -> Dict[str, Any]:
        """获取新闻数据"""
        # 实际实现需要调用新闻API
        return {
            "recent_news": [],
            "announcements": [],
            "industry_trend": None,
            "data_source": "placeholder"
        }

    def get_technical(self, code: str) -> Dict[str, Any]:
        """获取技术指标"""
        # 实际实现需要计算技术指标
        return {
            "trend": None,
            "macd": None,
            "rsi": None,
            "ma": None,
            "volume": None,
            "support": None,
            "resistance": None,
            "data_source": "placeholder"
        }


def calculate_technical_indicators(prices: List[float]) -> Dict[str, Any]:
    """计算技术指标"""
    if len(prices) < 30:
        return {"error": "数据不足"}

    # MACD
    ema12 = calculate_ema(prices, 12)
    ema26 = calculate_ema(prices, 26)
    dif = ema12 - ema26
    dea = calculate_ema([dif], 9)
    macd = (dif - dea) * 2

    # RSI
    rsi = calculate_rsi(prices, 14)

    # 均线
    ma5 = sum(prices[-5:]) / 5
    ma20 = sum(prices[-20:]) / 20
    ma60 = sum(prices[-60:]) / 60 if len(prices) >= 60 else None

    return {
        "macd": {
            "dif": round(dif, 2),
            "dea": round(dea, 2),
            "macd": round(macd, 2),
            "signal": "金叉" if macd > 0 else "死叉"
        },
        "rsi": round(rsi, 2),
        "ma": {
            "ma5": round(ma5, 2),
            "ma20": round(ma20, 2),
            "ma60": round(ma60, 2) if ma60 else None,
            "status": "多头排列" if ma5 > ma20 > (ma60 or 0) else "空头排列"
        }
    }


def calculate_ema(prices: List[float], period: int) -> float:
    """计算EMA"""
    if len(prices) < period:
        return sum(prices) / len(prices)

    multiplier = 2 / (period + 1)
    ema = sum(prices[:period]) / period

    for price in prices[period:]:
        ema = (price - ema) * multiplier + ema

    return ema


def calculate_rsi(prices: List[float], period: int = 14) -> float:
    """计算RSI"""
    if len(prices) < period + 1:
        return 50

    gains = []
    losses = []

    for i in range(1, len(prices)):
        change = prices[i] - prices[i-1]
        if change > 0:
            gains.append(change)
            losses.append(0)
        else:
            gains.append(0)
            losses.append(abs(change))

    avg_gain = sum(gains[-period:]) / period
    avg_loss = sum(losses[-period:]) / period

    if avg_loss == 0:
        return 100

    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))

    return rsi


def main():
    parser = argparse.ArgumentParser(description="华山论股数据抓取脚本")
    parser.add_argument("--stocks", required=True, help="股票代码，逗号分隔")
    parser.add_argument("--output", default="analysis.json", help="输出文件名")

    args = parser.parse_args()

    stock_codes = [code.strip() for code in args.stocks.split(",")]

    collector = DataCollector()
    result = collector.collect_all(stock_codes)

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"数据已保存到 {args.output}")


if __name__ == "__main__":
    main()
