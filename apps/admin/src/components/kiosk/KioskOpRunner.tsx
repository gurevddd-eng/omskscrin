import { useEffect } from "react";

export type KioskOpTone = "default" | "warn" | "danger";

export type KioskOpRunnerState = {
  title: string;
  detail?: string;
  target?: string;
  tone?: KioskOpTone;
  progress?: { current: number; total: number };
};

type Props = {
  op: KioskOpRunnerState | null;
};

/** Blocking progress UI for any kiosk action (delete, OTA, probe, WinRM, …). */
export function KioskOpRunner({ op }: Props) {
  useEffect(() => {
    if (!op) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [op]);

  if (!op) return null;

  const tone = op.tone || "default";
  const pct =
    op.progress && op.progress.total > 0
      ? Math.min(100, Math.round((op.progress.current / op.progress.total) * 100))
      : null;

  return (
    <div
      className="kx-op-runner"
      role="dialog"
      aria-modal="true"
      aria-busy="true"
      aria-labelledby="kx-op-runner-title"
    >
      <div className="kx-op-runner__backdrop" aria-hidden />
      <div className={`kx-op-runner__panel kx-op-runner__panel--${tone}`}>
        <div className="kx-op-runner__head">
          <span className="kx-op-runner__spin" aria-hidden />
          <div className="kx-op-runner__titles">
            <p className="kx-op-runner__kicker">Выполняется</p>
            <h2 id="kx-op-runner-title" className="kx-op-runner__title">
              {op.title}
            </h2>
          </div>
        </div>
        {op.target ? <p className="kx-op-runner__target">{op.target}</p> : null}
        {op.detail ? <p className="kx-op-runner__detail">{op.detail}</p> : null}
        {op.progress && op.progress.total > 0 ? (
          <div className="kx-op-runner__progress" aria-label="Прогресс">
            <div className="kx-op-runner__bar" aria-hidden>
              <div className="kx-op-runner__bar-fill" style={{ width: `${pct ?? 0}%` }} />
            </div>
            <span className="kx-op-runner__count mono">
              {op.progress.current} / {op.progress.total}
              {pct != null ? ` · ${pct}%` : ""}
            </span>
          </div>
        ) : (
          <p className="kx-op-runner__wait">Не закрывайте страницу до завершения.</p>
        )}
      </div>
    </div>
  );
}

export type FleetJob = {
  id: string;
  kioskName: string;
  label: string;
};

/** Compact strip when background WinRM/OTA jobs continue after the request returns. */
export function KioskFleetJobsBanner({ jobs }: { jobs: FleetJob[] }) {
  if (!jobs.length) return null;
  return (
    <div className="kx-fleet-jobs" role="status" aria-live="polite">
      <span className="kx-op-runner__spin kx-fleet-jobs__spin" aria-hidden />
      <div className="kx-fleet-jobs__body">
        <strong>Фоновые задачи ({jobs.length})</strong>
        <ul className="kx-fleet-jobs__list">
          {jobs.map((j) => (
            <li key={j.id}>
              <span className="kx-fleet-jobs__name">{j.kioskName}</span>
              <span className="kx-fleet-jobs__label">{j.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
