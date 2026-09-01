import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import type { KioskDto } from "@stella/shared";
import { PROBE_STATUS_LABEL } from "@stella/shared";
import { api } from "../api";
import type { DeployStatus } from "../components/kiosk/DeployStatusPanel";
import { MonitorStream } from "../components/monitoring/MonitorStream";
import { PageShell } from "../components/ui/PageShell";
import { Alert } from "../components/ui/Alert";
import { Card } from "../components/ui/Card";
import { Stat, StatGrid } from "../components/ui/StatGrid";

function kioskAttentionReason(k: KioskDto): string | null {
  if (!k.online) return "нет связи";
  if (k.installStatus === "error") return "ошибка установки";
  if (k.probeStatus === "unreachable") return "недоступен";
  if (k.probeStatus === "no_software") return "нет софта";
  if (k.syncStatus === "error") return "ошибка контента";
  if (k.gameCopy?.status === "error") return k.gameCopy.message || "ошибка игры";
  if (k.otaPending) return "обновляется ПО";
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
  const [kiosks, setKiosks] = useState<KioskDto[]>([]);
  const [exhibitCount, setExhibitCount] = useState(0);
  const [adCount, setAdCount] = useState(0);
  const [timelineCount, setTimelineCount] = useState(0);
  const [deploy, setDeploy] = useState<DeployStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [ks, exhibits, ads, timeline, dep] = await Promise.all([
        api<KioskDto[]>("/api/kiosks"),
        api<{ id: string }[]>("/api/exhibits?fields=id,title"),
        api<{ ads: { id: string }[] }>("/api/ads"),
        api<{ pages: { id: string }[] }>("/api/timeline"),
        api<DeployStatus>("/api/kiosks/deploy/status"),
      ]);
      setKiosks(ks);
      setExhibitCount(exhibits.length);
      setAdCount(ads.ads?.length ?? 0);
      setTimelineCount(timeline.pages?.length ?? 0);
      setDeploy(dep);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const fleet = useMemo(() => {
    const online = kiosks.filter((k) => k.online).length;
    const attention = kiosks
      .map((k) => ({ k, reason: kioskAttentionReason(k) }))
      .filter((x): x is { k: KioskDto; reason: string } => Boolean(x.reason))
      .slice(0, 10);
    const target = deploy?.softwareVersion || null;
    const otaOutdated = kiosks.filter((k) => {
      const local = k.softwareVersion;
      const tgt = k.otaTarget || target;
      return Boolean(tgt && local && local !== tgt);
    }).length;
    return {
      online,
      offline: kiosks.length - online,
      attention,
      total: kiosks.length,
      otaOutdated,
      target,
      packageReady: deploy?.packageReady ?? false,
    };
  }, [kiosks, deploy]);

  return (
    <PageShell
      section="Обзор"
      title="Парк и контент"
      description="Состояние киосков в реальном времени, проблемы и сводка по контенту."
      wide
      actions={
        <button type="button" className="btn ghost" disabled={loading} onClick={() => void load()}>
          {loading ? "…" : "Обновить"}
        </button>
      }
    >
      {error ? <Alert tone="error">{error}</Alert> : null}

      {fleet.attention.length > 0 ? (
        <Alert tone="info">
          Требуют внимания: {fleet.attention.length}.{" "}
          <Link to="/kiosks">Открыть киоски →</Link>
        </Alert>
      ) : fleet.total > 0 ? (
        <Alert tone="success">Все киоски в норме.</Alert>
      ) : null}

      <section className="cx-dash-block" aria-label="Сводка">
        <StatGrid columns={5}>
          <Stat label="Киосков" value={fleet.total} />
          <Stat label="Онлайн" value={fleet.online} tone="ok" />
          <Stat
            label="Офлайн"
            value={fleet.offline}
            tone={fleet.offline ? "warn" : "default"}
          />
          <Stat label="Экспонатов" value={exhibitCount} />
          <Stat
            label="OTA отстаёт"
            value={fleet.otaOutdated}
            tone={fleet.otaOutdated ? "warn" : "default"}
          />
        </StatGrid>
        {fleet.target ? (
          <p className="cx-dash-note muted">
            Пакет ПО:{" "}
            <code>{fleet.packageReady ? fleet.target : "не собран"}</code>
            {" · "}
            <Link to="/system/settings">настройки</Link>
            {" · "}
            <Link to="/kiosks">управление киосками</Link>
          </p>
        ) : null}
      </section>

      {fleet.attention.length > 0 ? (
        <Card title="Требуют внимания" padding="none" className="cx-dash-report">
          <ul className="cx-dash-list">
            {fleet.attention.map(({ k, reason }) => (
              <li key={k.id}>
                <Link to={`/kiosks?id=${encodeURIComponent(k.id)}`} className="cx-dash-list__row">
                  <span className="cx-dash-list__main">
                    <strong>{k.name}</strong>
                    <span className="muted mono">{k.hostname}</span>
                  </span>
                  <span className="cx-dash-list__meta">
                    <span className={`badge ${k.online ? "online" : "offline"}`}>{reason}</span>
                    <span className="muted">{PROBE_STATUS_LABEL[k.probeStatus]}</span>
                    <span className="muted">{formatSeen(k.lastSeenAt)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <MonitorStream />

      <section className="cx-dash-block" aria-label="Контент">
        <h2 className="cx-dash-block__title">Контент</h2>
        <div className="cx-dash-content-links">
          <Link to="/content/exhibits" className="cx-dash-content-link">
            <strong>{exhibitCount}</strong>
            <span>экспонатов</span>
          </Link>
          <Link to="/content/timeline" className="cx-dash-content-link">
            <strong>{timelineCount}</strong>
            <span>страниц хроники</span>
          </Link>
          <Link to="/content/ads" className="cx-dash-content-link">
            <strong>{adCount}</strong>
            <span>баннеров</span>
          </Link>
        </div>
      </section>
    </PageShell>
  );
}
