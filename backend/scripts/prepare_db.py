from __future__ import annotations

import asyncio
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import get_settings


async def _database_state() -> tuple[bool, bool]:
    settings = get_settings()
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    try:
        async with engine.connect() as conn:
            schema_exists = bool(
                await conn.scalar(text("SELECT to_regclass('public.anonymous_sessions') IS NOT NULL"))
            )
            version_exists = bool(
                await conn.scalar(text("SELECT to_regclass('public.alembic_version') IS NOT NULL"))
            )
            return schema_exists, version_exists
    finally:
        await engine.dispose()


def _alembic_config() -> Config:
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", get_settings().database_url.replace("%", "%%"))
    return config


def main() -> None:
    schema_exists, version_exists = asyncio.run(_database_state())
    config = _alembic_config()

    # 旧版开发环境使用 create_all。首次切换到正式镜像时，先把已存在的同构表标记为基线。
    if schema_exists and not version_exists:
        command.stamp(config, "head")

    command.upgrade(config, "head")


if __name__ == "__main__":
    main()
