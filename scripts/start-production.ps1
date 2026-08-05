# Быстрый боевой старт Stella (без Docker). Запускать из корня репозитория.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

if (-not (Test-Path .env)) {
  Write-Host "Нет .env — копирую .env.example. Заполните DATABASE_URL и JWT_SECRET!"
  Copy-Item .env.example .env
  exit 1
}

pnpm install
pnpm build:prod
pnpm db:generate
pnpm db:migrate
pnpm start:prod
