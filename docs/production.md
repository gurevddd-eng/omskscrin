# Боевой запуск (без Docker)

Сервер: Node.js + PostgreSQL (установленные на хосте). Админка раздаётся самим API с одного порта.

## Требования

- Windows Server / Linux в LAN
- **Node.js 20+**, **pnpm 9+**
- **PostgreSQL 14+** (служба на хосте или в сети)
- Для сборки киоска (MSI): Rust + WebView2 Runtime на машине сборки

## 1. База данных

Создайте пользователя и БД (пример `psql`):

```sql
CREATE USER stella WITH PASSWORD 'CHANGE_ME';
CREATE DATABASE stella OWNER stella;
```

## 2. Конфиг

```powershell
cd C:\path\to\stella-udhb
Copy-Item .env.example .env
# отредактируйте .env: NODE_ENV=production, DATABASE_URL, JWT_SECRET, пароли
```

## 3. Сборка и миграции

```powershell
pnpm install
pnpm build:prod
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

После seed **смените пароль admin** в админке (или задайте сильный `ADMIN_PASSWORD` до seed).

## 4. Запуск API + админка

```powershell
pnpm start:prod
```

Откройте в LAN: `http://<IP-сервера>:8080/` — админка и API на одном порту.

Проверка: `http://<IP>:8080/api/health` → `{"ok":true,"mode":"production","admin":true}`.

Если `admin: false` — не собрали админку (`pnpm --filter @stella/admin build`).

### Автозапуск Windows

Пример через Task Scheduler / NSSM: команда  
`pnpm start:prod` (или `node apps/server/dist/index.js`) из корня репо, рабочая папка = корень, переменная `NODE_ENV=production` уже в `.env`.

Откройте входящий **TCP 8080** в firewall для подсети киосков и рабочих мест админов.

## 5. Киоски (Windows в зале, сервер на Debian)

Сервер Stella на **Debian** управляет **Windows-киосками** из админки (установка, старт, стоп, удаление).

### На Debian-сервере

```bash
# .env: SERVER_PUBLIC_URL, DEPLOY_USER, DEPLOY_PASSWORD
# Рекомендуется для Debian (проще WinRM):
# DEPLOY_TRANSPORT=ssh

apt install -y openssh-client sshpass zip unzip curl   # для SSH-транспорта
pnpm pack:kiosk-deploy   # собирает data/deploy/current/package.zip
```

Альтернатива — WinRM с Debian: `apt install powershell`, в pwsh: `Install-Module PSWSMan; Install-WSMan`.

### На каждом Windows-киоске

- **SSH-транспорт:** включить *OpenSSH Server* (Параметры → Приложения → Дополнительные компоненты).
- **WinRM-транспорт:** `Enable-PSRemoting`, firewall 5985.
- Учётка из `DEPLOY_USER` — локальный или доменный **администратор** на ПК.
- Microsoft Edge, интерактивный вход пользователя (для полноэкранного UI).

В админке: Киоски → hostname → «Установить софт на ПК».

Подробнее: **[kiosk-remote-install.md](kiosk-remote-install.md)**.

## Чеклист перед залом

- [ ] `NODE_ENV=production`, сильный `JWT_SECRET`
- [ ] PostgreSQL бэкапится
- [ ] `ADMIN_PASSWORD` / пароль admin не дефолтный
- [ ] `MEDIA_DIR` на диске с запасом места под видео
- [ ] Киоски резолвят сервер по IP/DNS, heartbeat и probe в норме в мониторинге
- [ ] Порт 8080 (сервер) и 47821 (киоски) открыты в LAN

## Обновление

```powershell
git pull   # или копирование релиза
pnpm install
pnpm build:prod
pnpm db:migrate
# перезапуск службы / pnpm start:prod
```

Контент на киосках обновится sync’ом; обновление самого KioskApp — новым MSI через GPO.
