# 短线分析模块维护说明

> 最后更新：2026-05-23

短线分析是独立于「论股 Agent」的单股技术面分析入口。用户选择一只 A 股后，系统使用 akshare 拉取日线数据，计算均线、MACD、RSI、量能、支撑/压力等指标，再复用当前前端配置的 LLM Provider 生成短线分析报告。

## 功能边界

- 当前仅支持 6 位 A 股代码。
- 数据源使用 `ak.stock_zh_a_daily(symbol=with_prefix(code), adjust="qfq")`。
- LLM 配置复用浏览器中的模型配置，请求时临时传给后端，不落库。
- 分析任务会进入「分析任务」页面，支持进行中查看、完成后查看原文、PDF / Markdown 下载和分享。
- 页面和 PDF 都会展示近一年 K 线图，叠加 MA20、MA60、核心支撑区和压力区。

## 主要文件

| 位置 | 说明 |
| --- | --- |
| `backend/app/api/short_term.py` | 短线分析 REST API、任务创建、任务查询、分享链接 |
| `backend/app/services/short_term.py` | akshare 取数、指标计算、规则上下文、LLM 调用 |
| `backend/app/schemas/short_term.py` | 请求 / 响应 Pydantic 模型 |
| `backend/app/models/diagnosis.py` | `ShortTermAnalysisTask`、`ShortTermShareLink` 表模型 |
| `frontend/src/app/short-term/page.tsx` | 短线分析入口页、股票选择、最近股票、任务轮询 |
| `frontend/src/app/short-term/[taskId]/page.tsx` | 短线任务详情页，支持轮询进行中任务 |
| `frontend/src/app/share/short-term/[code]/page.tsx` | 短线报告分享页 |
| `frontend/src/components/short-term/ShortTermAnalysisResult.tsx` | 短线分析结果组件、K 线图、关键价位展示 |
| `frontend/src/lib/short-term-api.ts` | 前端短线分析 API client |
| `frontend/src/lib/short-term-report.ts` | PDF / Markdown 导出模板，包含打印版 K 线 SVG |
| `frontend/src/app/tasks/page.tsx` | 分析任务页，合并展示论股任务和短线任务 |
| `frontend/src/components/AppShell.tsx` | 控制台菜单，包含「短线分析」入口 |

## 后端 API

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/short-term/analyze` | 同步分析并返回报告；仍会落一条任务记录 |
| `POST` | `/api/short-term/start` | 创建任务后后台分析，推荐前端使用 |
| `GET` | `/api/short-term` | 当前匿名会话的短线任务列表 |
| `GET` | `/api/short-term/{task_id}` | 查询任务状态和报告 |
| `POST` | `/api/short-term/{task_id}/share` | 生成短线报告分享链接 |
| `GET` | `/api/short-term/share/{code}` | 访问分享报告 |

任务状态沿用 `pending | running | done | failed`。`/start` 会立即创建 `running` 任务，所以用户切换页面后仍能在「分析任务」里看到进行中任务。

## 数据模型

`short_term_analysis_tasks`

- `id`：UUID 主键
- `anon_id`：匿名会话
- `code` / `name`：股票代码和名称
- `status`：任务状态
- `report_json`：最终短线报告 JSON
- `error_message`：失败原因
- `created_at` / `finished_at`

`short_term_share_links`

- `code`：分享码
- `task_id`：短线任务 ID
- `expires_at`
- `visit_count`
- `created_at`

开发环境仍依赖 `Base.metadata.create_all` 自动建表；生产迁移时需要为这两张表补 alembic migration。

## 分析流程

1. 前端选择股票，读取当前 LLM Provider 配置。
2. `POST /api/short-term/start` 创建任务，页面进入轮询。
3. 后端加载前复权日线，至少需要 80 根 K 线。
4. 计算 MA5/10/20/30/60/120、VMA20、MACD、RSI14。
5. 日线取最近 160 根用于规则判断，周线重采样后补充多周期信息。
6. 生成 `snapshot`、`levels`、`chart`、规则上下文。
7. 调用 LLM 输出 `ai_analysis`；LLM 失败时保留规则生成的 fallback 分析。
8. 任务完成后写入 `report_json`，前端展示结果并开放下载 / 分享。

## 技术规则口径

短线分析固定使用「技术分析规则书」口径：

- 趋势：价格与 MA20 / MA60 / MA120 的相对位置，短均线排列，是否站回关键均线。
- 位置：近 20 / 60 / 120 日高低点、阶段区间上下沿。
- 动量：MACD DIF / DEA / 柱体方向，RSI14 所处区域。
- 量能：成交量与 VMA20 的比例，判断缩量、放量或正常。
- 多周期：日线为主，周线用于确认大级别压力或趋势背景。
- 触发条件：明确写出转强、转弱、继续观察的价格和量能条件。

不要只输出泛泛结论。短线报告至少应包含：结论、事实数据、规则判断、关键价位、后续触发。

## 关键价位和 K 线图

后端 `levels` 会返回当前价、均线、20/60/120 日高低点等候选价位。前端图表不会把所有候选价位都画出来，只突出核心支撑和核心压力。

图表规则：

- 支撑使用橙色，压力使用绿色。
- MA20 使用蓝色，MA60 使用紫色。
- 多个相近支撑 / 压力合并为一个区间色带。
- 相距较远的价位不强行合并，避免把整张图涂成大区间。
- 正常情况下图上只画一个核心支撑区和一个核心压力区。
- 压力位等于或略接近当前价时，也要纳入压力候选，避免涨停或接近高点时丢失压力位。
- 页面 K 线支持鼠标 / 触控滑动查看每日开高低收；PDF 使用静态 SVG，不包含交互。

如果修改图表逻辑，要同时检查：

- `frontend/src/components/short-term/ShortTermAnalysisResult.tsx`
- `frontend/src/lib/short-term-report.ts`

两处都有支撑/压力聚类和 SVG 渲染逻辑，PDF 打印版需要与页面版保持一致。

## 前端交互约定

- 短线分析入口位于控制台菜单「短线分析」，路由为 `/short-term`。
- 最近股票模块复用论股历史，并合并短线分析历史；按时间去重。
- 开始分析后最近股票模块隐藏，任务完成或失败后重新展示。
- 任务创建后即进入「分析任务」，用户切换菜单不会丢任务。
- 完成前只展示进行中状态和任务 ID；完成后展示报告、PDF / Markdown 下载和分享入口。
- 分享页路径为 `/share/short-term/{code}`。

## 导出约定

短线报告支持两种导出：

- Markdown：输出标题、核心指标、关键价位、原文分析、风险提示。
- PDF：通过浏览器打印窗口生成，打印 HTML 内嵌 K 线 SVG。

PDF 模板在 `frontend/src/lib/short-term-report.ts::buildShortTermPrintHtml`。改 K 线样式、颜色或关键价位规则时，不要只改页面组件，也要同步 PDF 模板。

## 验证清单

改动短线分析模块后建议执行：

```bash
cd frontend && npm run typecheck
cd backend && python3 -m compileall app
curl -I http://127.0.0.1:3000/short-term
curl -sS http://127.0.0.1:8000/api/health
```

手工检查：

- `/short-term` 能选择股票并创建任务。
- 分析中切到其他菜单后，任务仍出现在 `/tasks`。
- 完成后可以从 `/tasks` 查看原文、下载、分享。
- PDF 中包含 K 线图。
- 图上只有核心支撑区和压力区，不出现 MA5/10/20/60 等一堆价位线。
