# 华山论股 · 架构摘要

> 面向 AI / 新开发者的快速导览。目标：**不读代码就能回答 "这个功能在哪里？"**。
> 最后更新：2026-05-10

---

## 1. 项目一句话

**19 位投资大师 AI 持仓诊断 Web 版**——用户输入持仓（单股 / 批量 / 整盘），选 2-3 位大师，后端编排 4 分析师并行 + 多轮大师辩论 + 3 派风控审核，经 SSE 流式吐字返回。

> ⚠️ 实际代码里注册的大师是 **16 位**（华人五绝 5 + 欧美七雄 7 + 技术四杰 4）。README/首页文案写 "19 位" 是早期文案，改动务必同步。见 `backend/app/prompts/masters_meta.py`。

## 2. 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | Next.js 14 (App Router) · React 18 · Tailwind · zustand · lucide-react · Tesseract.js (CDN) |
| 后端 | FastAPI · SQLAlchemy 2.0 (async) · asyncpg · Redis · sse-starlette · httpx · akshare · pandas |
| 数据库 | PostgreSQL 16（JSONB + UUID 主键） |
| LLM | DeepSeek / 讯飞星火 MaaS（OpenAI 兼容协议，统一 `OpenAICompatClient`） |
| 部署 | docker-compose（frontend + backend + postgres + redis） |

## 3. 目录速查

```
huashan-lungu-web/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI 入口 + lifespan（建表 + 重启时 pending→failed）
│   │   ├── config.py            # Pydantic Settings
│   │   ├── db.py                # 异步 engine + SessionLocal
│   │   ├── redis_client.py      # Redis 单例
│   │   ├── api/                 # REST 路由（每个 router 挂 /api/xxx）
│   │   │   ├── diagnosis.py     # ★ 诊断主入口 + SSE 流（见 §5）
│   │   │   ├── portfolio.py     # 持仓解析入口
│   │   │   ├── masters.py       # 大师目录
│   │   │   ├── llm.py           # Provider 元信息 + 连通性测试
│   │   │   ├── stock.py         # 代码校验 / 搜索
│   │   │   ├── datasource.py    # akshare 数据源探活
│   │   │   ├── health.py        # DB/Redis 健康
│   │   │   └── deps.py          # FastAPI DI（get_database / get_anon / get_redis_dep）
│   │   ├── services/            # 业务编排
│   │   │   ├── orchestrator.py  # ★ 6-step 主流程编排器（见 §4）
│   │   │   ├── analysts.py      # 4 分析师执行逻辑
│   │   │   ├── debate.py        # 大师多轮辩论（串行）
│   │   │   ├── risk.py          # 3 派风控审核（并发）
│   │   │   ├── structured_report.py  # 数据卡片拼装
│   │   │   └── portfolio_parser.py   # manual/text/codes 三路径持仓解析
│   │   ├── data/                # akshare 数据源封装（每个文件一个领域）
│   │   │   ├── akshare_client.py  # async 包装 + 信号量 + tqdm 抑制
│   │   │   ├── symbols.py         # 代码校验 / 交易所判断 / 全量缓存
│   │   │   ├── fundamentals.py    # 财务摘要 + 估值（新浪源 + 百度源）
│   │   │   ├── sentiment.py       # 千股千评 + 行业板块情绪（东财源）
│   │   │   ├── news.py            # 个股近期新闻（东财源）
│   │   │   ├── technical.py       # 日线 + MACD/RSI/MA（新浪源；指标自实现 30 行）
│   │   │   └── cache.py           # Redis 缓存工具（k/v + TTL）
│   │   ├── llm/                 # LLM 抽象层
│   │   │   ├── base.py            # LLMClient ABC + Message / ChatResult
│   │   │   ├── openai_compat.py   # 唯一实现（仅依赖 httpx）
│   │   │   ├── factory.py         # build_client(provider, api_key, base_url)
│   │   │   └── registry.py        # Provider 静态元信息（PROVIDERS 列表）
│   │   ├── prompts/             # System prompt 组装
│   │   │   ├── analysts.py        # 4 分析师 system prompts
│   │   │   ├── risk.py            # 3 派风控 system prompts
│   │   │   ├── masters_meta.py    # 16 位大师元数据（slug/school/头像）
│   │   │   ├── loader.py          # 解析 skills/...references/masters.md → MasterSection
│   │   │   └── masters_persona.py # 把 MasterSection 渲染为完整 system prompt
│   │   ├── schemas/             # Pydantic 请求/响应模型
│   │   ├── models/              # SQLAlchemy 表（见 §6）
│   │   └── core/
│   │       ├── sse.py             # EventQueue + SSEEvent（见 §5）
│   │       └── anon.py            # hs_anon cookie 匿名会话
│   └── tests/
│       └── test_sse.py
├── frontend/
│   ├── next.config.mjs          # rewrites /api/* → backend（reactStrictMode=false）
│   └── src/
│       ├── app/                 # App Router 页面
│       │   ├── page.tsx           # 首页（三入口卡片）
│       │   ├── masters/page.tsx   # 大师百科（Server Component，用 API_BASE_INTERNAL）
│       │   ├── debate/
│       │   │   ├── single/page.tsx     # 单股入口
│       │   │   ├── batch/page.tsx      # 批量入口
│       │   │   ├── portfolio/page.tsx  # 持仓入口（三 tab：手动/粘贴/OCR）
│       │   │   ├── select/page.tsx     # 选大师（pid query 参数）
│       │   │   ├── [sid]/page.tsx      # ★ SSE 流式诊断页（见 §5）
│       │   │   └── [sid]/report/page.tsx
│       │   ├── share/[code]/page.tsx   # 分享链接页
│       │   └── settings/
│       │       ├── llm/page.tsx        # 配置 LLM Provider
│       │       └── datasource/page.tsx # 查看数据源健康
│       ├── components/
│       │   ├── debate/          # AnalystCard/DebateStage/MasterTurn/RiskPanel/ProgressBar
│       │   ├── report/          # DiagnosisReportView（最终报告渲染）
│       │   ├── portfolio/       # StockAutocomplete/HoldingsTable/ManualHoldingRow/ImageOcrTab
│       │   ├── settings/        # ProviderCard
│       │   └── ui/              # button/card/input/label/select（shadcn 风格）
│       ├── lib/
│       │   ├── api.ts           # apiGet/apiPost（同源代理走 Next rewrites）
│       │   ├── sse.ts           # openSSE 封装 EventSource
│       │   ├── diagnosis-api.ts # 诊断相关 API
│       │   ├── portfolio-api.ts # 持仓解析 + 股票搜索
│       │   ├── llm-api.ts       # Provider 元 + 连通性测试
│       │   ├── llm-config.ts    # LLM 配置 localStorage 读写
│       │   ├── datasource-api.ts
│       │   ├── tesseract.ts     # Tesseract.js 动态加载（CDN）+ worker 单例
│       │   └── cn.ts            # clsx + tailwind-merge
│       ├── stores/llm.ts        # zustand store（wrap localStorage）
│       └── styles/globals.css
└── skills/huashan-lungu-v2 → (symlink 到兄弟目录的 skill 仓库；prompt 源)
```

## 4. 核心流程：6-Step 诊断

入口：`backend/app/services/orchestrator.py::run_diagnosis_w5a`

```
diagnosis.context        # 回传 mode + stocks，前端用来画标题
step.start(1 持仓概览)    # single 模式会 skip
step.done(1)
step.start(2 分析师团队)
  ├ asyncio.gather(
  │    safe_run("fundamental"),  # 拉 财报+估值 → LLM stream
  │    safe_run("sentiment"),    # 拉 个股+行业情绪 → LLM stream
  │    safe_run("news"),         # 拉 新闻列表 → LLM stream
  │    safe_run("technical"),    # 拉 日线+算指标 → LLM stream
  │ )
  ├ 每个 analyst 失败独立隔离（emit analyst.fail 但不抛）
  └ 每只股票喂一次 prompt，多股连续吐
step.done(2)
step.start(3 结构化报告)
  └ structured_report.build_report_for_debate
     = 持仓列表 + 4 个 analyst 文本拼一份 markdown 卡片
step.done(3)
step.start(4 大师辩论)   # 未选大师则 step.skip
  └ debate.run_debate(rounds=2)
     - 每轮按 slug 顺序**串行**发言（后发言的要看到前面内容）
     - 每位大师发言流式：master.start → master.delta (×N) → master.done
     - system prompt = masters_persona.build_master_system_prompt(slug)
       （从 masters.md 抽方法论 + 语录 + checkpoint 等字段）
step.done(4) / step.skip(4)
step.start(5 风控审核)
  └ risk.run_risk_review
     - asyncio.gather 3 派（aggressive/neutral/conservative）
     - 输入：report_card + debate transcript
step.done(5)
report.ready              # 报告就绪
```

最终落库到 `diagnoses.report_json`：
```json
{
  "status": "done",
  "analysts": {"fundamental": {"role", "label", "text"}, ...},
  "report_card": "<markdown>",
  "debate": {"transcript": [{round, master, name, text}, ...]},
  "risk": {"aggressive": {...}, ...},
  "masters_selected": ["buffett", "soros"]
}
```

## 5. SSE 事件管道

### 服务端
- `app/core/sse.py::EventQueue`：emit 同时 **持久化 + 推 queue**，原子序列号 `id` 递增
- `app/api/diagnosis.py::stream`：**不直接从 queue 读**——每 0.75s 轮询 `Diagnosis.events_jsonb`，按 `Last-Event-ID` 过滤，支持浏览器断线重连
- 为什么轮询而不是桥接 queue？因为后台 task 和 SSE response 在**不同请求**，而事件已经原子落库。这样设计的好处：
  - ✅ 浏览器刷新 / SSE 断线后能无缝续传
  - ✅ uvicorn reload / 多 worker 也能继续（读的是 DB）
  - ❌ 0.75s 延迟（可接受）

### 事件协议
参见 `backend/app/core/sse.py` 顶部注释与 `frontend/src/lib/sse.ts::DEFAULT_EVENTS`：

| 类别 | 事件 | 载荷关键字段 |
| --- | --- | --- |
| 元信息 | `diagnosis.context` | `mode`, `stocks[]` |
| 主流程 | `step.start` / `step.done` / `step.skip` | `step`, `name` |
| 分析师 | `analyst.start` / `analyst.delta` / `analyst.done` / `analyst.fail` | `analyst`, `text`, `label`, `error` |
| 辩论 | `debate.lineup` / `debate.round_start` / `debate.round_done` | `masters[]`, `round`, `total` |
| 大师 | `master.start` / `master.delta` / `master.done` | `master`, `name`, `round`, `text` |
| 风控 | `risk.start` / `risk.delta` / `risk.done` | `school`, `label`, `text`, `failed` |
| 结束 | `report.ready` / `error` | `status`, `code`, `message` |

### 前端
- `frontend/src/lib/sse.ts::openSSE`：注册 DEFAULT_EVENTS 全部 listener
- `frontend/src/app/debate/[sid]/page.tsx`：巨 switch-case 消费所有事件，维护 `analysts / turns / riskStates / steps` 四组状态
- **陷阱**：Next dev 的 StrictMode 会让 useEffect 跑两次导致 SSE 重连——已在 `next.config.mjs` 关掉 `reactStrictMode`

## 6. 数据模型（DB）

`backend/app/models/`

| 表 | 主要字段 | 说明 |
| --- | --- | --- |
| `anonymous_sessions` | `id UUID pk`, `fingerprint`, `created_at`, `last_seen_at` | 基于 `hs_anon` cookie 的匿名身份 |
| `portfolios` | `id UUID pk`, `anon_id fk`, `holdings_json JSONB`, `raw_input` | 每次解析存一份，`holdings_json = {mode, holdings: [{code,name,...valid}], overview}` |
| `diagnoses` | `id UUID pk`, `portfolio_id fk`, `anon_id fk`, `mode`, `masters: ARRAY<str>`, `status`, `events_jsonb JSONB`, `report_json JSONB`, `error_message`, `finished_at` | 事件流水 + 最终报告都在这一行 |
| `share_links` | `code str pk`, `diagnosis_id fk`, `expires_at`, `visit_count` | 10 字符随机 code |

启动时会执行 `Base.metadata.create_all`（开发期够用；生产要上 alembic 再加迁移）。也会把上次进行中的 `pending/running` 标记为 `failed`——避免"假活"。

## 7. 关键不变量 / 隐私约定

1. **API Key 绝不落库**。浏览器 localStorage 持有，`POST /api/diagnosis/start` 的 body 里临时带过去，后端走完用完即弃。
2. **events_jsonb 落库** 是 SSE 可恢复的前提。任何新增事件都要走 `EventQueue.emit`，不要绕过 `on_emit=_append_event` 回调。
3. **4 分析师单独失败不 fatal**；大师辩论 / 风控整体失败走 `emit error`，但主流程继续拼可用部分。
4. **akshare 调用统一走 `data/akshare_client.py::call`**：全局 `asyncio.Semaphore(4)` 限流 + `DataSourceError` 包装。不要在别处裸调 akshare 函数。
5. **股票代码** 6 位数字，前缀按 `symbols.py::detect_exchange` 规则——新浪源接口必须用 `sh600519` 形式。
6. **频率限制**：每匿名 ID 每日 `rate_limit_per_day`（默认 20）次诊断，用 Redis 计数键 `ratelimit:diagnosis:{YYYY-MM-DD}:{anon_id}`，Redis 挂了**不阻断**。
7. **大师人设来源**：`skills/huashan-lungu-v2/references/masters.md` — 这是 prompt 工程的真理来源，改人设改这里。`loader.py` 通过正则抽 `### 大师名 · tagline` 分节。

## 8. 典型改动的"去哪里找"

| 需求 | 入口文件 |
| --- | --- |
| 加一个 LLM provider | `backend/app/llm/registry.py::PROVIDERS`（前端会自动渲染） |
| 新增 provider 非 OpenAI 兼容协议 | `backend/app/llm/factory.py` 加分支 + 新建 Client 类 |
| 加新的数据维度（第 5 位分析师） | `data/xxx.py` 拉数据 + `prompts/analysts.py` 加 system prompt + `services/analysts.py::_build_data_card` 加分支 + `orchestrator.py::ANALYST_ROLES` 加 role |
| 加 / 改大师人设 | `skills/huashan-lungu-v2/references/masters.md` +（如新增） `prompts/masters_meta.py::MASTERS` |
| 改辩论轮数 | `orchestrator.py::run_debate(..., rounds=N)` |
| 改 SSE 事件协议 | `core/sse.py` 注释 + `frontend/src/lib/sse.ts::DEFAULT_EVENTS` + `frontend/src/app/debate/[sid]/page.tsx` switch-case |
| 改进度条权重 | `frontend/src/components/debate/ProgressBar.tsx::WEIGHTS` |
| 加新页面 | `frontend/src/app/xxx/page.tsx`（App Router 文件路由） |
| 改首页三入口 | `frontend/src/app/page.tsx::ENTRIES` |
| 调整 DB schema | `backend/app/models/xxx.py` + 在 `app/main.py::lifespan` 之前考虑是否需要 alembic |
| 调整限流策略 | `backend/app/api/diagnosis.py::_check_daily_limit` + `config.py::rate_limit_per_day` |
| 加缓存策略 | `backend/app/data/cache.py`（key 前缀 `hs:data:`） |
| 改大师勾选上限 | 前端 `debate/select/page.tsx::toggle`（硬编码 3）+ 后端 `diagnosis.py::start` 无限制（共识保留前端层） |

## 9. 已知 TODO / 坑

- [ ] `ShareLink.expires_at` 逻辑存在但前端 UI 没暴露（`createShareLink` 不传 `expires_days`）
- [ ] 港股支持未实现（目前 `detect_exchange` 只返回 sh/sz/bj）
- [ ] OCR 离线包未落地（目前 Tesseract.js 从 unpkg CDN 加载）
- [ ] `DiagnosisReportView` 对 `risk[key]` 还做了旧版 string 兼容（`renderText`），新结构定型后可以删
- [ ] 大师辩论是**串行**的，总耗时 ≈ 大师数 × 轮数 × 单次 LLM 用时——进度条里权重 12 就是认了这个慢
- [ ] 首页 / README 写的 "19 位" 与代码里 16 位不一致
- [ ] `Diagnosis.status` 的文本值在代码里同时出现过 `"single" | "batch" | "portfolio"` 和 schemas 里的 `Literal["pending","running","done","failed"]`——看清楚在指 mode 还是 status
- [ ] lifespan 里 `create_all` 会在生产冲突；迁移到 alembic 是第一步
