# 华山论股 Web

华山论股 Web 是一个面向股票研究和持仓诊断的多 Agent 演示项目。系统会把用户输入的单股、批量股票或持仓组合交给分析师 Agent、大师圆桌、风控审核和投资经理决策模块，生成可追溯的研究报告。

> 免责声明：本项目仅用于技术演示和投研流程研究，不构成任何投资建议、收益承诺或交易指令。

## 功能特性

- 单股论股、批量分析、持仓诊断、短线分析四类入口
- A 股、港股、美股代码校验与基础数据接入
- A 股使用 akshare，港美股优先使用 yfinance
- 4 位分析师并行分析：基本面、技术面、新闻、情绪
- 大师圆桌观点、风控审核、投资经理决策
- 短线分析：A 股技术面规则判断、近一年 K 线、支撑/压力区、任务管理
- SSE 实时进度 + 2 分钟轮询兜底恢复
- 完整报告支持摘要、Tab 浏览、Markdown / PDF 导出、分享链接
- 多 LLM Provider 配置，API Key 仅保存在浏览器 localStorage

## 技术栈

- Frontend：Next.js 14、React 18、Tailwind CSS、lucide-react
- Backend：FastAPI、SQLAlchemy、PostgreSQL、Redis、SSE
- Data：akshare、yfinance
- Runtime：Docker Compose

## 快速开始

### 1. 准备环境

普通用户只需要安装：

- Docker Desktop

### 2. 配置环境变量

```bash
bash scripts/install.sh
```

安装脚本会自动创建 `.env`、生成本地安全密钥、拉取已发布镜像、启动 PostgreSQL/Redis/前后端，并检查后端和联网数据源状态。

本地开发默认端口：

- Frontend：http://localhost:3000
- Backend 仅在 Docker 内网提供服务

如果使用 Windows PowerShell：

```bash
.\scripts\install.ps1
```

安装完成后打开 http://localhost:3000，在设置页配置自己的 LLM Provider、API Key 和模型。A 股、港股、美股数据会在运行时通过互联网获取。

### 3. 源码开发

开发者可以使用源码构建和热重载：

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

源码开发需要 Node.js 20+ 和 Python 3.11+。生产镜像已经预构建，普通用户不需要这些运行时。

### 4. 停止和查看日志

```bash
docker compose ps
docker compose logs -f backend
docker compose down
```

PostgreSQL 数据保存在 Docker volume 中，执行 `docker compose down` 不会删除历史报告。

### 5. 数据源检查

后端启动后可以访问：

```text
/api/datasource/health
```

该接口会检查 akshare 和 yfinance。第三方免费数据源可能受到限流、地区网络和服务波动影响；部署成功不代表第三方接口永久可用。

### 6. 前端本地开发

```bash
cd frontend
npm ci
npm run dev
```

本项目把 Next.js 开发和生产构建目录隔离：

- `npm run dev` 使用 `.next-dev`
- `npm run build` 使用 `.next-build`

这样可以避免 dev server 和 build 同时写 `.next` 导致 CSS/JS 静态资源 500。

### 7. 后端本地开发

```bash
cd backend
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

## 常用命令

```bash
# 前端类型检查
cd frontend && npm run typecheck

# 前端生产构建
cd frontend && npm run build

# 后端语法检查
cd backend && python3 -m compileall app

# 后端测试
cd backend && pytest
```

## 目录结构

```text
backend/             FastAPI 后端、数据源、诊断编排、SSE
frontend/            Next.js 前端
docker-compose.yml   普通用户使用的预构建镜像部署
docker-compose.dev.yml  源码开发覆盖配置
scripts/             安装和启动检查脚本
backend/alembic/     数据库迁移
.github/workflows/   多架构镜像发布流水线
docs/                维护说明和发布检查清单
skills/              内置 huashan-lungu-v2 大师方法论与工作流
ARCHITECTURE.md      架构说明
```

短线分析模块的维护说明见 [docs/SHORT_TERM_ANALYSIS.md](./docs/SHORT_TERM_ANALYSIS.md)。

## 数据与密钥

- `.env` 不应提交到 GitHub。
- LLM API Key 保存在浏览器 localStorage，发起诊断时随请求发送到后端，后端用完即弃，不入库。
- 数据源来自第三方免费接口，可能存在缺失、延迟、统计口径差异或限流。

## 开源前注意

提交前建议执行：

```bash
git status --short
git check-ignore -v .env frontend/node_modules frontend/.next-dev frontend/.next-build backend/.venv
cd frontend && npm run typecheck && npm run build
cd ../backend && python3 -m compileall app
```

## License

MIT License. See [LICENSE](./LICENSE).
