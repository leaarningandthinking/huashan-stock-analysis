$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "未找到 Docker，请先安装 Docker Desktop。"
}
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  throw "Docker 未启动，请先启动 Docker Desktop。"
}
docker compose version *> $null
if ($LASTEXITCODE -ne 0) {
  throw "当前 Docker 不支持 docker compose。"
}

function New-Secret {
  return ((New-Guid).ToString("N") + (New-Guid).ToString("N"))
}

if (-not (Test-Path .env)) {
  Copy-Item .env.example .env
}

function Set-EnvValue([string]$Name, [string]$Value) {
  $content = Get-Content .env -Raw
  $pattern = "(?m)^" + [regex]::Escape($Name) + "=.*$"
  if ($content -match $pattern) {
    $content = [regex]::Replace($content, $pattern, "$Name=$Value")
  } else {
    $content += "`n$Name=$Value`n"
  }
  Set-Content -Path .env -Value $content -Encoding utf8
}

$content = Get-Content .env -Raw
if (-not [regex]::IsMatch($content, "(?m)^APP_VERSION=")) {
  Set-EnvValue "APP_VERSION" "v0.1.0"
  $content = Get-Content .env -Raw
}
foreach ($name in @("DB_PASSWORD", "SESSION_SECRET", "AUTH_SECRET", "PASSWORD_HASH_PEPPER")) {
  $match = [regex]::Match($content, "(?m)^" + $name + "=(.*)$")
  $value = if ($match.Success) { $match.Groups[1].Value } else { "" }
  if (-not $match.Success -or $value.StartsWith("change-me-") -or $value.StartsWith("local-") -or $value.StartsWith("dev-") -or $value -eq "huashan_dev") {
    Set-EnvValue $name (New-Secret)
  }
}

docker compose pull
if ($LASTEXITCODE -ne 0) {
  Write-Host "发布镜像暂不可用，改为本地构建应用镜像..."
  docker compose build
}
docker compose up -d

$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  docker compose exec -T backend python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3)" *> $null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  Start-Sleep -Seconds 2
}

if (-not $ready) {
  docker compose ps
  docker compose logs --tail=80 backend
  throw "后端未能在 120 秒内就绪。"
}

docker compose ps
Write-Host "部署完成：http://localhost:3000"
Write-Host "首次使用请在前端设置页配置自己的 LLM Provider、API Key 和模型。"
