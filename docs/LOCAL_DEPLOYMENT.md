# 本地部署

## 普通用户

前置条件：Docker Desktop 已安装并启动。

```bash
bash scripts/install.sh
```

打开 http://localhost:3000。

Windows PowerShell：

```powershell
.\scripts\install.ps1
```

脚本会创建 `.env`、生成本地密钥、拉取 GHCR 镜像、启动数据库和缓存、执行迁移，并等待后端健康检查通过。

## LLM 配置

进入前端设置页填写自己的 Provider、API Key、Base URL 和模型。API Key 保存在浏览器 localStorage，不写入数据库和 Docker 镜像。

## 数据源

行情数据运行时联网获取：

- A 股：akshare
- 港股/美股：yfinance

可在 `/api/datasource/health` 查看探活结果。数据源异常时不影响容器启动，但对应市场的分析可能不可用。

## 更新

修改 `.env` 中的 `APP_VERSION` 后执行：

```bash
docker compose pull
docker compose up -d
```

## 源码开发

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

## 故障排查

```bash
docker compose ps
docker compose logs --tail=100 backend
docker compose logs --tail=100 frontend
```

如果第三方数据源失败，先查看 `/api/datasource/health` 的具体 service 和 error 字段。
