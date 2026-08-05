# Stella UDHB — информационные киоски

Программный комплекс по [ТЗ](docs/TZ-informacionnye-kioski.md): админка, API, киоск-приложение (Tauri + React).

## Стек

| Часть | Технологии |
|-------|------------|
| API | Node.js, Fastify, Prisma, PostgreSQL |
| Админка | Vite + React + TypeScript (в бою раздаётся с API) |
| Киоск | Tauri 2 + React + health-агент |
| Деплой | Bare-metal: Node + PostgreSQL в LAN (**без Docker**) |

## Боевой режим

См. подробную инструкцию: **[docs/production.md](docs/production.md)**.

Кратко:

```powershell
Copy-Item .env.example .env   # NODE_ENV=production, DATABASE_URL, JWT_SECRET
pnpm install
pnpm build:prod
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm start:prod
```

Админка и API: `http://<сервер>:8080/`

## Dev-режим

### Требования

- Node.js 20+, pnpm 9+
- PostgreSQL (локально)
- Для native-сборки киоска: [Rust](https://rustup.rs/) + WebView2

### Установка

```powershell
Copy-Item .env.example .env
# для разработки: NODE_ENV=development, можно оставить JWT_SECRET=dev-secret-change-me
pnpm install
pnpm --filter @stella/shared build
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

### Запуск

```powershell
pnpm dev:server
pnpm dev:admin
pnpm dev:kiosk
pnpm dev:kiosk-health   # опционально, порт 47821
```

- API: http://localhost:8080  
- Админка: http://localhost:5173  
- Киоск: http://localhost:5174  

Конфиг киоска: [`apps/kiosk/public/kiosk.json`](apps/kiosk/public/kiosk.json).

## Роли

- `admin` — всё, включая пользователей  
- `editor` — экспонаты, медиа, киоски  
- `viewer` — просмотр и мониторинг  

## Киоски (GPO / Assigned Access)

[docs/gpo-deployment.md](docs/gpo-deployment.md), [docs/assigned-access.md](docs/assigned-access.md).

## Приёмка

[docs/acceptance-checklist.md](docs/acceptance-checklist.md).

## Документация

- **[Как работает весь софт (подробно)](docs/how-it-works.md)** — архитектура, потоки, lockdown, порты, эксплуатация
- [production.md](docs/production.md) — боевой запуск
- [kiosk-remote-install.md](docs/kiosk-remote-install.md) — удалённая установка
- [TZ-informacionnye-kioski.md](docs/TZ-informacionnye-kioski.md) — исходное ТЗ

## Структура

```
apps/server   — Fastify API (+ раздача admin в production)
apps/admin    — админ-панель
apps/kiosk    — UI киоска + Tauri + health-агент
packages/shared
docs/
```
