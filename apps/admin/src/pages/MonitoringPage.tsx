import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { KioskDto } from "@stella/shared";
import { getToken } from "../api";
import { probeBadgeClass, probeLabel } from "../components/kiosk/status";
import { PageShell } from "../components/ui/PageShell";
import { Alert } from "../components/ui/Alert";
import { Card } from "../components/ui/Card";
import { Stat, StatGrid } from "../components/ui/StatGrid";

type ConnState = "connecting" | "live" | "reconnecting" | "error";

function formatAgo(iso: string | null, now: number) {
  if (!iso) return "—";
  const ms = now - new Date(iso).getTime();
  if (ms < 15000) return "сейчас";
  if (ms < 60000) return `${Math.floor(ms / 1000)} с назад`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)} мин назад`;
  return new Date(iso).toLocaleString("ru-RU");
}

/** Isolated so relative-time ticks do not re-render the whole monitoring table. */
function RelativeTime({ iso }: { iso: string | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  return <>{formatAgo(iso, now)}</>;
}

function RowFlash({ flashAt, children }: { flashAt?: number; children: ReactNode }) {
  const [flashing, setFlashing] = useState(false);
  useEffect(() => {
    if (!flashAt) return;
    setFlashing(true);
    const t = setTimeout(() => setFlashing(false), 1200);
    return () => clearTimeout(t);
  }, [flashAt]);
  return <tr className={flashing ? "row-flash" : undefined}>{children}</tr>;
}

export function MonitoringPage() {
  const [kiosks, setKiosks] = useState<KioskDto[]>([]);
  const [conn, setConn] = useState<ConnState>("connecting");
  const [error, setError] = useState("");
  const [flashIds, setFlashIds] = useState<Record<string, number>>({});
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);

  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    function flash(id: string) {
      setFlashIds((prev) => ({ ...prev, [id]: Date.now() }));
    }

    function connect() {
      if (closed) return;
      const token = getToken();
      if (!token) {
        setConn("error");
        setError("Нет токена авторизации");
        return;
      }

      setConn(attempt === 0 ? "connecting" : "reconnecting");
      es = new EventSource(`/api/kiosks/monitor/stream?token=${encodeURIComponent(token)}`);

      es.addEventListener("snapshot", (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as { kiosks: KioskDto[]; at: string };
          setKiosks(data.kiosks);
          setLastEventAt(data.at);
          setConn("live");
          setError("");
          attempt = 0;
        } catch {
          setError("Ошибка разбора snapshot");
        }
      });

      es.addEventListener("kiosk", (ev) => {
        try {
          const kiosk = JSON.parse((ev as MessageEvent).data) as KioskDto;
          setKiosks((prev) => {
            const idx = prev.findIndex((k) => k.id === kiosk.id);
            if (idx === -1) return [...prev, kiosk].sort((a, b) => a.name.localeCompare(b.name, "ru"));
            const next = [...prev];
            next[idx] = kiosk;
            return next;
          });
          flash(kiosk.id);
          setLastEventAt(new Date().toISOString());
          setConn("live");
        } catch {
          /* ignore */
        }
      });

      es.addEventListener("kiosk_removed", (ev) => {
        try {
          const { id } = JSON.parse((ev as MessageEvent).data) as { id: string };
          setKiosks((prev) => prev.filter((k) => k.id !== id));
          setLastEventAt(new Date().toISOString());
        } catch {
          /* ignore */
        }
      });

      es.onerror = () => {
        es?.close();
        es = null;
        if (closed) return;
        setConn("reconnecting");
        setError("Потеряно соединение, переподключение…");
        attempt += 1;
        const delay = Math.min(1000 * 2 ** Math.min(attempt, 4), 15000);
        retryTimer = setTimeout(connect, delay);
      };
    }

    connect();
    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, []);

  const online = kiosks.filter((k) => k.online).length;
  const healthy = kiosks.filter((k) => k.probeStatus === "healthy").length;
  const syncErrors = kiosks.filter((k) => k.syncStatus === "error").length;
  const problems = kiosks.filter(
    (k) => k.probeStatus === "no_software" || k.probeStatus === "unreachable"
  ).length;

  const connLabel = useMemo(() => {
    if (conn === "live") return "В эфире";
    if (conn === "connecting") return "Подключение…";
    if (conn === "reconnecting") return "Переподключение…";
    return "Нет связи";
  }, [conn]);

  return (
    <PageShell
      section="Мониторинг"
      title="Live-поток"
      description="События SSE и актуальные статусы health-агентов киосков."
      wide
      actions={
        <>
          <div className={`live-pill ${conn}`}>
            <span className="live-dot" />
            {connLabel}
          </div>
          {lastEventAt ? (
            <span className="muted monitor-event__value">
              Обновлено <RelativeTime iso={lastEventAt} />
            </span>
          ) : null}
        </>
      }
      banner={
        error && conn !== "live" ? (
          <Alert tone="error">{error}</Alert>
        ) : null
      }
    >
      <StatGrid columns={5}>
        <Stat label="Всего" value={kiosks.length} />
        <Stat label="Онлайн" value={online} tone="ok" />
        <Stat label="Healthy" value={healthy} tone="ok" />
        <Stat label="Ошибки синка" value={syncErrors} tone={syncErrors ? "warn" : "default"} />
        <Stat label="Нет софта / хост" value={problems} tone={problems ? "bad" : "default"} />
      </StatGrid>

      <Card title="Киоски" subtitle="Перейдите в раздел «Киоски» для управления ПК" padding="none">
        <div className="cx-table-wrap">
          <table className="data-table monitor-table cx-table">
            <thead>
              <tr>
                <th>Киоск</th>
                <th>Софт</th>
                <th>Сеть</th>
                <th>Экспонат</th>
                <th>Синхронизация</th>
                <th>Контакт</th>
              </tr>
            </thead>
            <tbody>
              {kiosks.map((k) => (
                <RowFlash key={k.id} flashAt={flashIds[k.id]}>
                  <td>
                    <div className="cx-cell-title">{k.name}</div>
                    <div className="muted cx-cell-sub">{k.hostname}</div>
                  </td>
                  <td>
                    <span className={`badge ${probeBadgeClass(k.probeStatus)}`}>
                      {probeLabel(k.probeStatus)}
                    </span>
                    {k.probeMessage ? <div className="muted cx-cell-sub">{k.probeMessage}</div> : null}
                  </td>
                  <td>
                    <span className={`badge ${k.online ? "online" : "offline"}`}>
                      {k.online ? "онлайн" : "офлайн"}
                    </span>
                  </td>
                  <td>{k.exhibitTitle || "—"}</td>
                  <td>
                    <span className={`badge ${k.syncStatus === "error" ? "error" : "ok"}`}>
                      {k.syncStatus}
                    </span>
                    {k.syncMessage ? <div className="muted cx-cell-sub">{k.syncMessage}</div> : null}
                  </td>
                  <td className="monitor-ago">
                    <div>
                      HB <RelativeTime iso={k.lastSeenAt} />
                    </div>
                    <div className="muted">
                      опрос <RelativeTime iso={k.lastProbeAt} />
                    </div>
                  </td>
                </RowFlash>
              ))}
              {!kiosks.length && (
                <tr>
                  <td colSpan={6}>
                    <div className="cx-empty">
                      <p className="cx-empty__title">
                        {conn === "live" ? "Киосков пока нет" : "Загрузка…"}
                      </p>
                      <p className="muted">Добавьте ПК в разделе «Киоски»</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </PageShell>
  );
}
