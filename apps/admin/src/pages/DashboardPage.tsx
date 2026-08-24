import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { KioskDto } from "@stella/shared";
import { PROBE_STATUS_LABEL } from "@stella/shared";
import { useAuth } from "../auth";
import { api } from "../api";
import type { DeployStatus } from "../components/kiosk/DeployStatusPanel";
import { PageShell } from "../components/ui/PageShell";
import { Alert } from "../components/ui/Alert";
import { Card } from "../components/ui/Card";
import { Stat, StatGrid } from "../components/ui/StatGrid";

type QuickTile = {
  to: string;
  title: string;
  desc: string;
  icon: string;
  tone: "monitor" | "fleet" | "content" | "ads" | "system" | "users" | "timeline";
  adminOnly?: boolean;
};

type QuickGroup = {
  title: string;
  tiles: QuickTile[];
};

const QUICK_GROUPS: QuickGroup[] = [
  {
    title: "Парк и мониторинг",
    tiles: [
      {
        to: "/monitor",
        title: "Мониторинг",
        desc: "Live-статусы и SSE-поток всех ПК",
        icon: "M",
        tone: "monitor",
      },
      {
        to: "/kiosks",
        title: "Киоски",
        desc: "Установка, OTA, старт UI, конфиг",
        icon: "K",
        tone: "fleet",
      },
    ],
  },
  {
    title: "Контент",
    tiles: [
      {
        to: "/exhibits",
        title: "Экспонаты",
        desc: "Тексты, фото, видео, ТТХ",
        icon: "E",
        tone: "content",
      },
      {
        to: "/timeline",
        title: "Хроника",
        desc: "Общие страницы лет для всех киосков",
        icon: "H",
        tone: "timeline",
      },
      {
        to: "/ads",
        title: "Реклама",
        desc: "Баннеры на правом крыле",
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
        desc: "Тема, lockdown, сеть, Windows",
        icon: "S",
        tone: "system",
      },
      {
        to: "/users",
        title: "Пользователи",
        desc: "Учётные записи и роли",
        icon: "U",
        tone: "users",
        adminOnly: true,
      },
    ],
  },
];

function kioskProblemReason(k: KioskDto): string | null {
  if (k.installStatus === "error") return "ошибка установки";
  if (k.probeStatus === "unreachable") return "недоступен";
  if (k.probeStatus === "no_software") return "нет софта";
  if (k.syncStatus === "error") return "ошибка синхронизации";
  return null;
}

function formatSeen(iso: string | null) {
  if (!iso) return "никогда";
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export function DashboardPage() {
  const { user, isAdmin } = useAuth();
  const [kiosks, setKiosks] = useState<KioskDto[]>([]);
  const [exhibitCount, setExhibitCount] = useState(0);
  const [adCount, setAdCount] = useState(0);
  const [timelineCount, setTimelineCount] = useState(0);
  const [deploy, setDeploy] = useState<DeployStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api<KioskDto[]>("/api/kiosks"),
      api<{ id: string }[]>("/api/exhibits?fields=id,title"),
      api<{ ads: { id: string }[] }>("/api/ads"),
      api<{ pages: { id: string }[] }>("/api/timeline"),
      api<DeployStatus>("/api/kiosks/deploy/status"),
    ])
      .then(([ks, exhibits, ads, timeline, dep]) => {
        if (cancelled) return;
        setKiosks(ks);
        setExhibitCount(exhibits.length);
        setAdCount(ads.ads?.length ?? 0);
        setTimelineCount(timeline.pages?.length ?? 0);
        setDeploy(dep);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Ошибка загрузки");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fleet = useMemo(() => {
    const online = kiosks.filter((k) => k.online).length;
    const offline = kiosks.length - online;
    const healthy = kiosks.filter((k) => k.probeStatus === "healthy").length;
    const problems = kiosks.filter((k) => kioskProblemReason(k)).length;
    const busy = kiosks.filter(
      (k) =>
        k.installStatus === "running" ||
        k.installStatus === "queued" ||
        k.uiStartStatus === "running" ||
        k.uiStopStatus === "running" ||
        k.policyClearStatus === "running" ||
        k.otaPending
    ).length;
    const target = deploy?.softwareVersion || null;
    const otaOutdated = kiosks.filter((k) => {
      const local = k.softwareVersion;
      const tgt = k.otaTarget || target;
      return Boolean(tgt && local && local !== tgt);
    }).length;
    const otaPending = kiosks.filter((k) => k.otaPending).length;
    const problemRows = kiosks
      .map((k) => ({ k, reason: kioskProblemReason(k) }))
      .filter((x): x is { k: KioskDto; reason: string } => Boolean(x.reason))
      .slice(0, 8);
    const staleHeartbeat = kiosks
      .filter((k) => !k.online)
      .sort((a, b) => (b.lastSeenAt || "").localeCompare(a.lastSeenAt || ""))
      .slice(0, 6);
    return {
      online,
      offline,
      healthy,
      problems,
      busy,
      otaOutdated,
      otaPending,
      problemRows,
      staleHeartbeat,
      total: kiosks.length,
      target,
    };
  }, [kiosks, deploy]);

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
      section="Доступ"
      title={`Обзор${user?.login ? ` · ${user.login}` : ""}`}
      description="Сводка по парку киосков, контенту и пакету ПО — отсюда быстрый переход к разделам."
      wide
      actions={
        <button
          type="button"
          className="btn ghost"
          disabled={loading}
          onClick={() => window.location.reload()}
        >
          {loading ? "…" : "Обновить"}
        </button>
      }
    >
      {error ? <Alert tone="error">{error}</Alert> : null}

      {fleet.problems > 0 ? (
        <Alert tone="error">
          Требуют внимания {fleet.problems} из {fleet.total || "—"} киосков.{" "}
          <Link to="/kiosks">Открыть парк ПК →</Link>
        </Alert>
      ) : null}

      <section className="cx-dash-block" aria-label="Парк киосков">
        <h2 className="cx-dash-block__title">Парк киосков</h2>
        <StatGrid columns={5}>
          <Stat label="Всего" value={fleet.total} />
          <Stat label="Онлайн" value={fleet.online} tone="ok" />
          <Stat label="Офлайн" value={fleet.offline} tone={fleet.offline ? "warn" : "default"} />
          <Stat label="Healthy" value={fleet.healthy} tone="ok" />
          <Stat
            label="Проблемы"
            value={fleet.problems}
            tone={fleet.problems ? "bad" : "default"}
          />
        </StatGrid>
      </section>

      <section className="cx-dash-block" aria-label="ПО и операции">
        <h2 className="cx-dash-block__title">ПО и операции</h2>
        <StatGrid columns={4}>
          <Stat
            label="OTA отстаёт"
            value={fleet.otaOutdated}
            tone={fleet.otaOutdated ? "warn" : "default"}
          />
          <Stat
            label="OTA в процессе"
            value={fleet.otaPending}
            tone={fleet.otaPending ? "warn" : "default"}
          />
          <Stat
            label="Активных задач"
            value={fleet.busy}
            tone={fleet.busy ? "warn" : "default"}
          />
          <Stat
            label="Пакет на сервере"
            value={deploy?.packageReady ? deploy.softwareVersion || "есть" : "нет"}
            tone={deploy?.packageReady ? "ok" : "bad"}
          />
        </StatGrid>
        {fleet.target ? (
          <p className="cx-dash-note muted">
            Целевая версия ПО: <code>{fleet.target}</code>
            {deploy?.serverPublicUrl ? (
              <>
                {" "}
                · сервер <code>{deploy.serverPublicUrl}</code>
              </>
            ) : null}
          </p>
        ) : null}
      </section>

      <section className="cx-dash-block" aria-label="Контент">
        <h2 className="cx-dash-block__title">Контент</h2>
        <StatGrid columns={3}>
          <Stat label="Экспонаты" value={exhibitCount} />
          <Stat label="Страницы хроники" value={timelineCount} />
          <Stat label="Рекламные баннеры" value={adCount} />
        </StatGrid>
      </section>

      <div className="cx-dash-split">
        <Card
          title="Отчёт · проблемы"
          padding="none"
          className="cx-dash-report"
        >
          {fleet.problemRows.length ? (
            <ul className="cx-dash-list">
              {fleet.problemRows.map(({ k, reason }) => (
                <li key={k.id}>
                  <Link to={`/kiosks?id=${encodeURIComponent(k.id)}`} className="cx-dash-list__row">
                    <span className="cx-dash-list__main">
                      <strong>{k.name}</strong>
                      <span className="muted mono">{k.hostname}</span>
                    </span>
                    <span className="cx-dash-list__meta">
                      <span className="badge offline">{reason}</span>
                      <span className="muted">{PROBE_STATUS_LABEL[k.probeStatus]}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="cx-dash-empty muted">Критических проблем по парку нет.</p>
          )}
          <div className="cx-dash-list__foot">
            <Link to="/kiosks">Все киоски →</Link>
            <Link to="/monitor">Мониторинг →</Link>
          </div>
        </Card>

        <Card title="Отчёт · офлайн" padding="none" className="cx-dash-report">
          {fleet.staleHeartbeat.length ? (
            <ul className="cx-dash-list">
              {fleet.staleHeartbeat.map((k) => (
                <li key={k.id}>
                  <Link to={`/kiosks?id=${encodeURIComponent(k.id)}`} className="cx-dash-list__row">
                    <span className="cx-dash-list__main">
                      <strong>{k.name}</strong>
                      <span className="muted mono">{k.hostname}</span>
                    </span>
                    <span className="cx-dash-list__meta">
                      <span className="muted">heartbeat {formatSeen(k.lastSeenAt)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="cx-dash-empty muted">Все киоски онлайн или список пуст.</p>
          )}
          <div className="cx-dash-list__foot">
            <Link to="/kiosks">Парк ПК →</Link>
          </div>
        </Card>
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
