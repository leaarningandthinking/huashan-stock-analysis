# 华山论股 Web

华山论股 Web 是一个面向股票研究和持仓诊断的多 Agent 演示项目。系统会把用户输入的单股、批量股票或持仓组合交给分析师 Agent、大师圆桌、风控审核和投资经理决策模块，生成可追溯的研究报告。

> 免责声明：本项目仅用于技术演示和投研流程研究，不构成任何投资建议、收益承诺或交易指令。

## 功能特性

- 单股论股、批量分析、持仓诊断三种入口
- A 股、港股、美股代码校验与基础数据接入
- A 股使用 akshare，港美股优先使用 yfinance
- 4 位分析师并行分析：基本面、技术面、新闻、情绪
- 大师圆桌观点、风控审核、投资经理决策
- SSE 实时进度 + 2 分钟轮询兜底恢复
- 完整报告支持摘要、Tab 浏览、Markdown / PDF 导出
- 多 LLM Provider 配置，API Key 仅保存在浏览器 localStorage

## 技术栈

- Frontend：Next.js 14、React 18、Tailwind CSS、lucide-react
- Backend：FastAPI、SQLAlchemy、PostgreSQL、Redis、SSE
- Data：akshare、yfinance
- Runtime：Docker Compose

## 快速开始

### 1. 准备环境

需要安装：

- Docker Desktop
- Node.js 20+
- Python 3.11+

### 2. 配置环境变量

```bash
cp .env.example .env
```

本地开发默认端口：

- Frontend：http://localhost:3000
- Backend：http://localhost:8000
- API Docs：http://localhost:8000/docs

如果 3000 被占用，Next.js 会自动切到 3001。`.env.example` 已默认允许 3000 和 3001。

### 3. Docker 启动

```bash
docker compose up --build
```

### 4. 前端本地开发

```bash
cd frontend
npm install
npm run dev
```

本项目把 Next.js 开发和生产构建目录隔离：

- `npm run dev` 使用 `.next-dev`
- `npm run build` 使用 `.next-build`

这样可以避免 dev server 和 build 同时写 `.next` 导致 CSS/JS 静态资源 500。

### 5. 后端本地开发

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
docker/              Postgres 初始化脚本
skills/              本地 skill 入口，默认可挂载外部 huashan-lungu-v2
ARCHITECTURE.md      架构说明
docker-compose.yml   本地一键启动
```

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
