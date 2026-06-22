# GitHub Release Checklist

上传公开仓库前按顺序检查：

## 1. 敏感信息

```bash
git check-ignore -v .env frontend/node_modules frontend/.next-dev frontend/.next-build backend/.venv
```

确认以下内容不会被提交：

- `.env`
- API Key / Token
- `node_modules/`
- `.next/`、`.next-dev/`、`.next-build/`
- `backend/.venv/`
- 数据库、缓存、日志文件
- 指向仓库外部的本地绝对路径软链

同时确认 `skills/huashan-lungu-v2/references/masters.md` 已被 Git 跟踪；它是后端运行时依赖。

## 2. 本地验证

```bash
cd frontend
npm run typecheck
npm run build

cd ../backend
python3 -m compileall app
pytest
```

## 3. 初始化仓库

```bash
git init
git add .
git status --short
git commit -m "chore: prepare github release"
```

## 4. 创建 GitHub 仓库

用 GitHub 网页新建空仓库，或使用 GitHub CLI：

```bash
gh repo create huashan-lungu-web --public --source=. --remote=origin --push
```

如果已经在 GitHub 创建了空仓库：

```bash
git branch -M main
git remote add origin git@github.com:<your-name>/huashan-lungu-web.git
git push -u origin main
```

## 5. 仓库设置建议

- 添加 About 描述和 Topics：`nextjs`, `fastapi`, `agents`, `stock-analysis`, `akshare`, `yfinance`
- 开启 GitHub Actions
- 开启 Dependabot alerts
- 设置默认分支为 `main`
- 如果公开分享，确认 README 免责声明保留
