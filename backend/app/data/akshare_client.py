"""akshare 同步→异步包装。

要点：
- akshare 是同步库，FastAPI 中要用 to_thread 跑
- 接口易碎，统一用 DataSourceError 包装异常
- 全局并发信号量避免打爆数据源
- 抑制 akshare 的 tqdm 进度条（污染日志）
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
import warnings
from contextlib import contextmanager
from typing import Any, Callable, TypeVar

logger = logging.getLogger(__name__)

# akshare 启动时初始化进度条到 stderr，全局抑制
warnings.filterwarnings("ignore")
os.environ.setdefault("TQDM_DISABLE", "1")

# 并发上限：单 IP 太快会被 ban
_semaphore = asyncio.Semaphore(4)


class DataSourceError(Exception):
    """所有数据源调用失败统一抛这个，外层好做降级。"""


T = TypeVar("T")


@contextmanager
def _silence_stderr():
    """临时把 stderr 重定向到 devnull，吞掉 tqdm 进度条。"""
    saved = sys.stderr
    try:
        sys.stderr = open(os.devnull, "w")
        yield
    finally:
        sys.stderr.close()
        sys.stderr = saved


async def call(fn: Callable[..., T], *args, **kwargs) -> T:
    """异步跑一个同步 akshare 函数，限流 + 错误包装。"""
    async with _semaphore:
        try:
            return await asyncio.to_thread(_run_sync, fn, *args, **kwargs)
        except DataSourceError:
            raise
        except Exception as e:
            logger.warning("akshare call failed: %s.%s -> %s",
                           getattr(fn, "__module__", "?"),
                           getattr(fn, "__name__", "?"),
                           e)
            raise DataSourceError(f"{type(e).__name__}: {str(e)[:200]}") from e


def _run_sync(fn: Callable[..., T], *args, **kwargs) -> T:
    with _silence_stderr():
        return fn(*args, **kwargs)
