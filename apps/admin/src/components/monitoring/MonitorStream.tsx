import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { KioskDto } from "@stella/shared";
import { getToken } from "../../api";
import { probeBadgeClass, probeLabel } from "../kiosk/status";
import { Card } from "../ui/Card";
import { Stat, StatGrid } from "../ui/StatGrid";

type ConnState = "connecting" | "live" | "reconnecting" | "error";

function formatAgo(iso: string | null, now: number) {
  if (!iso) return "—";
  const ms = now - new Date(iso).getTime();
  if (ms < 15000) return "сейчас";
  if (ms < 60000) return `${Math.floor(ms / 1000)} с назад`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)} мин назад`;
  return new Date(iso).toLocaleString("ru-RU");
}

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

type MonitorStreamProps = {
  compact?: boolean;
  showStats?: boolean;
};

export function MonitorStream({ compact = false, showStats = true }: MonitorStreamProps) {
  const [kiosks, setKiosks] = useState<KioskDto[]>([]);
  const [conn, setConn] = useState<ConnState>("connecting");
  const [error, setError] = useState("");
  const [flashIds, setFlashIds] = useState<Record<string, number>>({});

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
          const data = JSON.parse((ev as MessageEvent).data) as { kiosks: KioskDto[] };
          setKiosks(data.kiosks);
          setConn("live");
          setError("");
          attempt = 0;
        } catch {
          setError("Ошибка разбора данных");
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
          setConn("live");
        } catch {
          /* ignore */
        }
      });

      es.addEventListener("kiosk_removed", (ev) => {
        try {
          const { id } = JSON.parse((ev as MessageEvent).data) as { id: string };
          setKiosks((prev) => prev.filter((k) => k.id !== id));
        } catch {
          /* ignore */
        }
      });

      es.onerror = () => {
        es?.close();
        es = null;
        if (closed) return;
        setConn("reconnecting");
        setError("Переподключение…");
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
  const problems = kiosks.filter(
    (k) =>
      k.probeStatus === "no_software" ||
      k.probeStatus === "unreachable" ||
      k.syncStatus === "error" ||
      k.installStatus === "error"
  ).length;

  const connLabel = useMemo(() => {
    if (conn === "live") return "в эфире";
    if (conn === "connecting") return "подключение…";
    if (conn === "reconnecting") return "переподключение…";
    return "нет связи";
  }, [conn]);

  return (
    <div className="cx-monitor">
      <div className="cx-monitor__head">
        {showStats ? (
          <StatGrid columns={compact ? 3 : 4}>
            <Stat label="Всего" value={kiosks.length} />
            <Stat label="Онлайн" value={online} tone="ok" />
            <Stat
              label="Проблемы"
              value={problems}
              tone={problems ? "bad" : "default"}
            />
            {!compact ? (
              <Stat
                label="Офлайн"
                value={kiosks.length - online}
                tone={kiosks.length - online ? "warn" : "default"}
              />
            ) : null}
          </StatGrid>
        ) : null}
        <div className={`live-pill ${conn}`}>
          <span className="live-dot" />
          {connLabel}
        </div>
      </div>

      {error && conn !== "live" ? <p className="cx-monitor__err muted">{error}</p> : null}

      <Card
        title="Киоски в реальном времени"
        subtitle="Клик по строке — карточка киоска"
        padding="none"
      >
        <div className="cx-table-wrap">
          <table className="data-table monitor-table cx-table">
            <thead>
              <tr>
                <th>Киоск</th>
                <th>Статус</th>
                <th>Сеть</th>
                {!compact ? <th>Экспонат</th> : null}
                <th>Контакт</th>
              </tr>
            </thead>
            <tbody>
              {kiosks.map((k) => (
                <RowFlash key={k.id} flashAt={flashIds[k.id]}>
                  <td>
                    <Link to={`/kiosks?id=${encodeURIComponent(k.id)}`} className="cx-dash-list__link">
                      <div className="cx-cell-title">{k.name}</div>
                      <div className="muted cx-cell-sub">{k.hostname}</div>
                    </Link>
                  </td>
                  <td>
                    <span className={`badge ${probeBadgeClass(k.probeStatus)}`}>
                      {probeLabel(k.probeStatus)}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${k.online ? "online" : "offline"}`}>
                      {k.online ? "онлайн" : "офлайн"}
                    </span>
                  </td>
                  {!compact ? <td>{k.exhibitTitle || "—"}</td> : null}
                  <td className="monitor-ago muted">
                    <RelativeTime iso={k.lastSeenAt} />
                  </td>
                </RowFlash>
              ))}
              {!kiosks.length ? (
                <tr>
                  <td colSpan={compact ? 4 : 5}>
                    <div className="cx-empty">
                      <p className="cx-empty__title">
                        {conn === "live" ? "Киосков пока нет" : "Загрузка…"}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
