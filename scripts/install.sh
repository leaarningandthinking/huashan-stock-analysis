#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$PROJECT_DIR"

fail() {
  printf '安装失败：%s\n' "$1" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "未找到 Docker，请先安装 Docker Desktop。"
docker info >/dev/null 2>&1 || fail "Docker 未启动，请先启动 Docker Desktop。"
docker compose version >/dev/null 2>&1 || fail "当前 Docker 不支持 docker compose。"

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
  fi
}

set_env_value() {
  key="$1"
  value="$2"
  if grep -q "^${key}=" .env 2>/dev/null; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" .env
    rm -f .env.bak
  else
    printf '\n%s=%s\n' "$key" "$value" >> .env
  fi
}

if [ ! -f .env ]; then
  cp .env.example .env
fi

set_env_value APP_VERSION "${APP_VERSION:-v0.1.0}"
set_env_value DB_PASSWORD "$(grep '^DB_PASSWORD=' .env | cut -d= -f2- | grep -Ev '^(change-me-|huashan_dev$|local-|dev-)' || generate_secret)"
set_env_value SESSION_SECRET "$(grep '^SESSION_SECRET=' .env | cut -d= -f2- | grep -Ev '^(change-me-|local-|dev-)' || generate_secret)"
set_env_value AUTH_SECRET "$(grep '^AUTH_SECRET=' .env | cut -d= -f2- | grep -Ev '^(change-me-|local-|dev-)' || generate_secret)"
set_env_value PASSWORD_HASH_PEPPER "$(grep '^PASSWORD_HASH_PEPPER=' .env | cut -d= -f2- | grep -Ev '^(change-me-|local-|dev-)' || generate_secret)"

printf '拉取应用镜像...\n'
if ! docker compose pull; then
  printf '发布镜像暂不可用，改为本地构建应用镜像...\n'
  docker compose build
fi

printf '启动服务...\n'
docker compose up -d

printf '等待后端就绪...\n'
ready=0
for _ in $(seq 1 60); do
  if docker compose exec -T backend python -c \
    "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3)" \
    >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done

if [ "$ready" -ne 1 ]; then
  docker compose ps
  docker compose logs --tail=80 backend
  fail "后端未能在 120 秒内就绪。"
fi

printf '检查联网数据源（第三方接口异常只提示，不阻止启动）...\n'
if ! docker compose exec -T backend python -c \
  "import json,sys,urllib.request; d=json.load(urllib.request.urlopen('http://127.0.0.1:8000/api/datasource/health', timeout=120)); print(json.dumps({'overall': d.get('overall'), 'services': [(x.get('name'), x.get('status')) for x in d.get('services', [])]}, ensure_ascii=False)); sys.exit(0 if d.get('overall') == 'ok' else 1)"; then
  printf '警告：部分数据源当前不可用，请打开设置页查看具体状态。\n'
fi

docker compose ps
printf '\n部署完成： http://localhost:%s\n' "$(grep '^FRONTEND_PORT=' .env | cut -d= -f2-)"
printf '首次使用请在前端设置页配置你自己的 LLM Provider、API Key 和模型。\n'
