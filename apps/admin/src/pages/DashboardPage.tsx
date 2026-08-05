import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { KioskDto } from "@stella/shared";
import { useAuth } from "../auth";
import { api } from "../api";
import { PageShell } from "../components/ui/PageShell";
import { Alert } from "../components/ui/Alert";

type QuickTile = {
  to: string;
  title: string;
  desc: string;
  icon: string;
  tone: "monitor" | "fleet" | "content" | "ads" | "system" | "users";
  adminOnly?: boolean;
};

type QuickGroup = {
  title: string;
  tiles: QuickTile[];
};

const QUICK_GROUPS: QuickGroup[] = [
  {
    title: "Парк киосков",
    tiles: [
      {
        to: "/monitor",
        title: "Мониторинг",
        desc: "Live-статусы, SSE-поток, health всех ПК",
        icon: "M",
        tone: "monitor",
      },
      {
        to: "/kiosks",
        title: "Киоски",
        desc: "Установка, старт, конфиг, lockdown, экспонаты на ПК",
        icon: "K",
        tone: "fleet",
      },
    ],
  },
  {
    title: "Контент зала",
    tiles: [
      {
        to: "/exhibits",
        title: "Экспонаты",
        desc: "Тексты, фото, видео и характеристики для киосков",
        icon: "E",
        tone: "content",
      },
      {
        to: "/ads",
        title: "Реклама",
        desc: "Глобальные баннеры на всех киосках",
        icon: "A",
        tone: "ads",
      },
    ],
  },
  {
    title: "Система",
    tiles: [
      {
        to: "/settings",
        title: "Настройки",
        desc: "Lockdown, софт киосков, сеть Debian-сервера",
        icon: "S",
        tone: "system",
      },
      {
        to: "/users",
        title: "Пользователи",
        desc: "Учётные записи, роли и пароли админки",
        icon: "U",
        tone: "users",
        adminOnly: true,
      },
    ],
  },
];

export function DashboardPage() {
  const { user, isAdmin } = useAuth();
  const [kiosks, setKiosks] = useState<KioskDto[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<KioskDto[]>("/api/kiosks")
      .then(setKiosks)
      .catch((e) => setError(e instanceof Error ? e.message : "Ошибка"));
  }, []);

  const stats = useMemo(() => {
    const online = kiosks.filter((k) => k.online).length;
    const problems = kiosks.filter(
      (k) =>
        k.installStatus === "error" ||
        k.probeStatus === "unreachable" ||
        k.probeStatus === "no_software" ||
        k.syncStatus === "error"
    ).length;
    const busy = kiosks.filter(
      (k) =>
        k.installStatus === "running" ||
        k.installStatus === "queued" ||
        k.uiStartStatus === "running" ||
        k.uiStopStatus === "running" ||
        k.policyClearStatus === "running"
    ).length;
    return { online, problems, busy, total: kiosks.length };
  }, [kiosks]);

  const groups = useMemo(
    () =>
      QUICK_GROUPS.map((group) => ({
        ...group,
        tiles: group.tiles.filter((tile) => !tile.adminOnly || isAdmin),
      })).filter((group) => group.tiles.length),
    [isAdmin]
  );

  return (
    <PageShell
      section="Быстрый доступ"
      title={`Здравствуйте${user?.login ? `, ${user.login}` : ""}`}
      description="Выберите раздел или задачу — все основные инструменты админки собраны здесь."
      wide
    >
      {error ? <Alert tone="error">{error}</Alert> : null}

      {stats.problems > 0 ? (
        <Alert tone="error">
          Проблемы на {stats.problems} из {stats.total || "—"} киосков.{" "}
          <Link to="/kiosks">Открыть парк ПК →</Link>
        </Alert>
      ) : null}

      <div className="cx-quick-status">
        <Link to="/kiosks" className="cx-quick-pill">
          <span className="cx-quick-pill__value">{stats.total}</span>
          <span className="cx-quick-pill__label">киосков</span>
        </Link>
        <Link to="/monitor" className="cx-quick-pill cx-quick-pill--ok">
          <span className="cx-quick-pill__value">{stats.online}</span>
          <span className="cx-quick-pill__label">онлайн</span>
        </Link>
        <Link to="/kiosks" className={`cx-quick-pill${stats.busy ? " cx-quick-pill--warn" : ""}`}>
          <span className="cx-quick-pill__value">{stats.busy}</span>
          <span className="cx-quick-pill__label">операций</span>
        </Link>
        <Link
          to="/kiosks"
          className={`cx-quick-pill${stats.problems ? " cx-quick-pill--bad" : ""}`}
        >
          <span className="cx-quick-pill__value">{stats.problems}</span>
          <span className="cx-quick-pill__label">проблем</span>
        </Link>
      </div>

      <div className="cx-quick">
        {groups.map((group) => (
          <section key={group.title} className="cx-quick__group">
            <h2 className="cx-quick__heading">{group.title}</h2>
            <div className="cx-quick__grid">
              {group.tiles.map((tile) => (
                <Link
                  key={tile.to}
                  to={tile.to}
                  className={`cx-quick-tile cx-quick-tile--${tile.tone}`}
                >
                  <span className="cx-quick-tile__icon" aria-hidden>
                    {tile.icon}
                  </span>
                  <span className="cx-quick-tile__body">
                    <span className="cx-quick-tile__title">{tile.title}</span>
                    <span className="cx-quick-tile__desc">{tile.desc}</span>
                  </span>
                  <span className="cx-quick-tile__arrow" aria-hidden>
                    →
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </PageShell>
  );
}
