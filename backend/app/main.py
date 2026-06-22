from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import update

from app.api import (
    auth,
    datasource,
    diagnosis,
    health,
    llm,
    masters,
    portfolio,
    profile,
    revise,
    short_term,
    signals,
    stock,
)
from app.config import get_settings
from app.db import engine
from app.models.base import Base
from app.models.diagnosis import Diagnosis
from app.redis_client import close_redis, get_redis

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动：建表 + 预热 Redis
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(
            update(Diagnosis)
            .where(Diagnosis.status.in_(["pending", "running"]))
            .values(
                status="failed",
                error_message="服务已重启，进行中的诊断无法继续。请重新发起诊断。",
            )
        )
    await get_redis()
    yield
    # 关闭
    await close_redis()
    await engine.dispose()


app = FastAPI(
    title="华山论股 API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(auth.router)
app.include_router(masters.router)
app.include_router(llm.router)
app.include_router(stock.router)
app.include_router(short_term.router)
app.include_router(datasource.router)
app.include_router(portfolio.router)
app.include_router(diagnosis.router)
app.include_router(diagnosis.share_router)
app.include_router(revise.router)
app.include_router(profile.router)
app.include_router(signals.router)


@app.get("/")
async def root() -> dict:
    return {"name": "华山论股 API", "version": "0.1.0", "docs": "/docs"}
