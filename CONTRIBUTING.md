# Contributing

感谢你愿意参与华山论股 Web。

## 开发流程

1. Fork 仓库并创建分支。
2. 本地复制 `.env.example` 为 `.env`。
3. 修改代码并补充必要测试。
4. 提交 PR 前运行：

```bash
cd frontend && npm run typecheck && npm run build
cd ../backend && python3 -m compileall app && pytest
```

## 提交规范

建议使用简洁的 Conventional Commits：

- `feat: add provider config`
- `fix: repair sse progress fallback`
- `docs: update setup guide`
- `chore: adjust docker config`

## 代码要求

- 不提交 `.env`、API Key、Token、数据库文件、构建产物。
- 前端遵循现有 Tailwind / React 组件风格。
- 后端保持 FastAPI service / data / api 分层。
- 金融数据缺失或异常时必须显式标注，不能编造。

## 投资内容边界

本项目只能输出研究辅助信息。贡献代码或提示词时，不应把模型输出包装成确定收益、荐股承诺或个人化投资建议。
