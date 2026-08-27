import type { GameCopyStatus, InstallStage, KioskDto } from "@stella/shared";
import {
  GAME_COPY_STATUS_LABEL,
  GAME_COPY_STATUS_STEPS,
  INSTALL_STAGE_LABEL,
  INSTALL_STAGE_STEPS,
  POLICY_CLEAR_STAGE_LABEL,
  POLICY_CLEAR_STAGE_STEPS,
  UI_START_STAGE_LABEL,
  UI_START_STAGE_STEPS,
  UI_STOP_STAGE_LABEL,
  UI_STOP_STAGE_STEPS,
} from "@stella/shared";
import {
  otaStateLabel,
  resolveOtaState,
  type OtaUiState,
} from "./KioskOtaStatus";

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

function stageIndex(steps: { id: string }[], stage: string) {
  const i = steps.findIndex((s) => s.id === stage);
  return i < 0 ? -1 : i;
}

function syncLabel(status: string | null | undefined): string {
  const s = String(status || "").toLowerCase();
  if (s === "ok") return "ОК";
  if (s === "error") return "Ошибка";
  if (s === "syncing" || s === "pending") return "Синхронизация…";
  if (!s || s === "unknown") return "Нет данных";
  return status || "—";
}

type LaneTone = "idle" | "run" | "done" | "error";

type Lane = {
  id: string;
  title: string;
  subtitle: string | null;
  tone: LaneTone;
  steps?: { id: string; label: string }[];
  active?: number;
  message?: string | null;
  progressPct?: number | null;
};

function buildInstallLane(k: KioskDto): Lane | null {
  const rawStage = (k.installStage || "idle") as InstallStage;
  const failed = k.installStatus === "error";
  const done = k.installStatus === "ok" || rawStage === "done";
  const busy = k.installStatus === "running" || k.installStatus === "queued";

  if (!busy && !failed && !done) return null;
  if (k.installStatus === "idle" && rawStage === "idle" && !k.installMessage) return null;

  let stage: InstallStage = rawStage;
  if (done) stage = "done";
  else if (failed) stage = rawStage !== "idle" ? rawStage : "error";
  else if (rawStage === "idle" && k.installStatus === "queued") stage = "queued";
  else if (rawStage === "idle" && k.installStatus === "running") stage = "connecting";

  const active = stageIndex(INSTALL_STAGE_STEPS, stage === "error" ? rawStage : stage);
  const title = failed
    ? "Установка · ошибка"
    : done
      ? "Установка · готово"
      : "Установка";
  const subtitle = failed
    ? rawStage !== "idle" && rawStage !== "error"
      ? INSTALL_STAGE_LABEL[rawStage]
      : "Сбой"
    : done
      ? INSTALL_STAGE_LABEL.done
      : INSTALL_STAGE_LABEL[stage] || "В процессе…";

  return {
    id: "install",
    title,
    subtitle,
    tone: failed ? "error" : done ? "done" : "run",
    steps: INSTALL_STAGE_STEPS,
    active,
    message: k.installMessage,
  };
}

function buildSimpleLane(
  id: string,
  title: string,
  status: string | null | undefined,
  stage: string | null | undefined,
  message: string | null | undefined,
  steps: { id: string; label: string }[],
  labels: Record<string, string>,
  errorStageFallback: string
): Lane | null {
  const st = status || "idle";
  const sg = stage || "idle";
  const failed = st === "error";
  const done = st === "ok";
  const busy = st === "running" || st === "queued";
  if (!busy && !failed && !done) return null;

  const active = stageIndex(steps, sg === "error" ? errorStageFallback : sg);
  const subtitle = failed
    ? "Ошибка"
    : done
      ? labels.done || "Готово"
      : labels[sg] || "В процессе…";

  return {
    id,
    title: failed ? `${title} · ошибка` : done ? `${title} · готово` : title,
    subtitle,
    tone: failed ? "error" : done ? "done" : "run",
    steps,
    active,
    message,
  };
}

function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} КБ`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} МБ`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} ГБ`;
}

function buildGameLane(k: KioskDto): Lane | null {
  const gc = k.gameCopy;
  const installed = Array.isArray(k.installedGames) ? k.installedGames : [];
  if (!gc && installed.length === 0) return null;

  const status = (gc?.status || "idle") as GameCopyStatus;
  const busy = status === "copying" || status === "launching" || status === "running";
  const failed = status === "error";
  const onDisk = status === "idle" && Boolean(gc?.folder || installed.length);

  if (!busy && !failed && !onDisk && installed.length === 0) return null;

  const active = stageIndex(GAME_COPY_STATUS_STEPS, status);
  const sizeHint = formatBytes(gc?.copiedBytes);
  const parts = [
    gc?.folder || null,
    sizeHint || null,
    gc?.message || null,
  ].filter(Boolean);

  let title = "Игра";
  let subtitle = GAME_COPY_STATUS_LABEL[status] || status;
  let tone: LaneTone = "idle";

  if (failed) {
    title = "Игра · ошибка";
    subtitle = gc?.folder ? String(gc.folder) : "Сбой";
    tone = "error";
  } else if (busy) {
    title = "Игра";
    subtitle = GAME_COPY_STATUS_LABEL[status];
    tone = "run";
  } else {
    title = "Игра на киоске";
    subtitle =
      installed.length > 0
        ? `${installed.length} на диске`
        : gc?.folder
          ? String(gc.folder)
          : "Установлена";
    tone = "done";
  }

  return {
    id: "game",
    title,
    subtitle,
    tone,
    steps: GAME_COPY_STATUS_STEPS,
    active: busy || failed ? active : undefined,
    message: parts.length ? parts.join(" · ") : null,
    progressPct:
      status === "copying"
        ? gc?.percent != null
          ? gc.percent
          : gc?.totalBytes && gc.totalBytes > 0 && gc.copiedBytes != null
            ? Math.min(99, Math.round((gc.copiedBytes / gc.totalBytes) * 100))
            : null
        : null,
  };
}

function buildOtaLane(state: OtaUiState, local: string | null, target: string | null): Lane {
  if (state === "pending") {
    return {
      id: "ota",
      title: "Обновление ПО (OTA)",
      subtitle: "Агент применяет пакет",
      tone: "run",
      message: "Обычно 10–30 с до нового heartbeat с версией.",
    };
  }
  if (state === "outdated") {
    return {
      id: "ota",
      title: "Обновление ПО (OTA)",
      subtitle: "Есть новая сборка",
      tone: "idle",
      message: `На киоске ${local || "—"} · на сервере ${target || "—"}`,
    };
  }
  if (state === "current") {
    return {
      id: "ota",
      title: "Обновление ПО (OTA)",
      subtitle: "Актуально",
      tone: "done",
      message: null,
    };
  }
  if (state === "unknown") {
    return {
      id: "ota",
      title: "Обновление ПО (OTA)",
      subtitle: "Версия не известна",
      tone: "idle",
      message: "Агент ещё не прислал softwareVersion (нет heartbeat или не установлен).",
    };
  }
  return {
    id: "ota",
    title: "Обновление ПО (OTA)",
    subtitle: "Нет пакета на сервере",
    tone: "idle",
    message: "Соберите пакет: pnpm pack:kiosk-deploy",
  };
}

function ProcessLane({ lane }: { lane: Lane }) {
  const showSteps =
    lane.steps &&
    lane.active !== undefined &&
    (lane.tone === "run" || lane.tone === "error");

  return (
    <article className={`kx-life__lane kx-life__lane--${lane.tone}`}>
      <header className="kx-life__lane-head">
        <div className="kx-life__lane-titles">
          {lane.tone === "run" ? <span className="kx-task__spin" aria-hidden /> : null}
          <div>
            <h4 className="kx-life__lane-title">{lane.title}</h4>
            {lane.subtitle ? <p className="kx-life__lane-sub">{lane.subtitle}</p> : null}
          </div>
        </div>
        <span className={`kx-life__pill kx-life__pill--${lane.tone}`}>
          {lane.tone === "run"
            ? "Идёт"
            : lane.tone === "done"
              ? "Готово"
              : lane.tone === "error"
                ? "Ошибка"
                : "Ожидание"}
        </span>
      </header>

      {showSteps && lane.steps ? (
        <ol className="kx-life__steps" aria-label={lane.title}>
          {lane.steps.map((step, i) => {
            const active = lane.active ?? -1;
            let cls = "kx-life__step";
            if (lane.tone === "error" && (active < 0 ? i === 1 : i === active)) cls += " is-error";
            else if (lane.tone === "done" || (active >= 0 && i < active)) cls += " is-done";
            else if (active >= 0 && i === active && lane.tone === "run") cls += " is-current";
            return (
              <li key={step.id} className={cls} title={step.label}>
                <span className="kx-life__step-dot">{i + 1}</span>
                <span className="kx-life__step-label">{step.label}</span>
              </li>
            );
          })}
        </ol>
      ) : null}

      {lane.message ? <p className="kx-life__lane-msg">{lane.message}</p> : null}

      {lane.tone === "run" && lane.id === "game" && lane.progressPct != null ? (
        <div className="kx-life__progress" role="progressbar" aria-valuenow={lane.progressPct} aria-valuemin={0} aria-valuemax={100}>
          <span className="kx-life__progress-bar" style={{ width: `${lane.progressPct}%` }} />
        </div>
      ) : null}
    </article>
  );
}

type Props = {
  kiosk: KioskDto;
  deployTarget?: string | null;
  updating?: boolean;
};

export function KioskLifecyclePanel({ kiosk, deployTarget, updating }: Props) {
  const k = kiosk;
  const local = k.softwareVersion || null;
  const target = k.otaTarget || deployTarget || null;
  const pending = Boolean(updating || k.otaPending);
  const otaState = resolveOtaState(local, target, pending);

  const lanes: Lane[] = [];
  const install = buildInstallLane(k);
  if (install) lanes.push(install);

  const uiStart = buildSimpleLane(
    "ui-start",
    "Запуск UI",
    k.uiStartStatus,
    k.uiStartStage,
    k.uiStartMessage,
    UI_START_STAGE_STEPS,
    UI_START_STAGE_LABEL,
    "starting"
  );
  if (uiStart) lanes.push(uiStart);

  const uiStop = buildSimpleLane(
    "ui-stop",
    "Остановка UI",
    k.uiStopStatus,
    k.uiStopStage,
    k.uiStopMessage,
    UI_STOP_STAGE_STEPS,
    UI_STOP_STAGE_LABEL,
    "stopping"
  );
  if (uiStop) lanes.push(uiStop);

  const policy = buildSimpleLane(
    "policy",
    "Снятие политик",
    k.policyClearStatus,
    k.policyClearStage,
    k.policyClearMessage,
    POLICY_CLEAR_STAGE_STEPS,
    POLICY_CLEAR_STAGE_LABEL,
    "clearing"
  );
  if (policy) lanes.push(policy);

  const game = buildGameLane(k);
  if (game) lanes.push(game);

  // Always show OTA lane so the block stays informative
  lanes.push(buildOtaLane(otaState, local, target));

  const activeCount = lanes.filter((l) => l.tone === "run" || l.tone === "error").length;

  return (
    <section className={`kx-life kx-life--ota-${otaState}`} aria-live="polite">
      <header className="kx-life__head">
        <div>
          <p className="kx-life__eyebrow">Жизненный цикл</p>
          <h3 className="kx-life__title">Процессы на киоске</h3>
        </div>
        <div className="kx-life__head-meta">
          {activeCount > 0 ? (
            <span className="kx-life__badge is-run">
              Активно · {activeCount}
            </span>
          ) : (
            <span className="kx-life__badge is-idle">Спокойно</span>
          )}
          <span className={`kx-life__badge kx-life__badge--ota-${otaState}`}>
            OTA · {otaStateLabel(otaState)}
          </span>
        </div>
      </header>

      <div className="kx-life__ota">
        <div className="kx-life__ota-cell">
          <span className="kx-life__ota-label">На киоске</span>
          <strong className="kx-life__ota-value">{local || "не сообщалась"}</strong>
        </div>
        <div className="kx-life__ota-bridge" aria-hidden>
          <span className="kx-life__ota-line" />
          <span className="kx-life__ota-arrow">→</span>
          <span className="kx-life__ota-line" />
        </div>
        <div className="kx-life__ota-cell">
          <span className="kx-life__ota-label">Пакет на сервере</span>
          <strong className="kx-life__ota-value">{target || "нет пакета"}</strong>
        </div>
      </div>

      <div className="kx-life__lanes">
        {lanes.map((lane) => (
          <ProcessLane key={lane.id} lane={lane} />
        ))}
      </div>

      {Array.isArray(k.installedGames) && k.installedGames.length > 0 ? (
        <div className="kx-life__games">
          <h4 className="kx-life__status-title">Установленные игры</h4>
          <ul className="kx-life__games-list">
            {k.installedGames.map((name) => (
              <li key={name} className="kx-life__games-item">
                <span className="kx-life__games-name">{name}</span>
                {k.gameCopy?.folder === name && k.gameCopy.status === "running" ? (
                  <span className="kx-life__games-tag is-run">запущена</span>
                ) : k.gameCopy?.folder === name &&
                  (k.gameCopy.status === "copying" || k.gameCopy.status === "launching") ? (
                  <span className="kx-life__games-tag is-run">
                    {GAME_COPY_STATUS_LABEL[k.gameCopy.status]}
                  </span>
                ) : (
                  <span className="kx-life__games-tag">на диске</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="kx-life__status">
        <h4 className="kx-life__status-title">Связь и контент</h4>
        <dl className="kx-life__metrics">
          <div className={`kx-life__metric ${k.online ? "is-ok" : "is-off"}`}>
            <dt>Heartbeat</dt>
            <dd>{formatSeen(k.lastSeenAt)}</dd>
          </div>
          <div className="kx-life__metric">
            <dt>App</dt>
            <dd>{k.appVersion || "—"}</dd>
          </div>
          <div className="kx-life__metric">
            <dt>Контент</dt>
            <dd className="mono">{k.contentVersion || "—"}</dd>
          </div>
          <div
            className={`kx-life__metric ${
              k.syncStatus === "error" ? "is-bad" : k.syncStatus === "ok" ? "is-ok" : ""
            }`}
          >
            <dt>Синхронизация</dt>
            <dd>
              {syncLabel(k.syncStatus)}
              {k.syncMessage ? ` · ${k.syncMessage}` : ""}
            </dd>
          </div>
          <div className="kx-life__metric kx-life__metric--wide">
            <dt>Health</dt>
            <dd className="mono">
              http://{k.hostname}:{k.healthPort}/health
            </dd>
          </div>
          <div className="kx-life__metric kx-life__metric--wide">
            <dt>UI</dt>
            <dd className="mono">http://127.0.0.1:{k.uiPort}/</dd>
          </div>
        </dl>
        {k.probeMessage ? <p className="kx-life__probe">{k.probeMessage}</p> : null}
      </div>
    </section>
  );
}
