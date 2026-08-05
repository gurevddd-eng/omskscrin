import type { InstallStage, KioskDto } from "@stella/shared";
import {
  INSTALL_STAGE_LABEL,
  INSTALL_STAGE_STEPS,
  POLICY_CLEAR_STAGE_LABEL,
  POLICY_CLEAR_STAGE_STEPS,
  UI_START_STAGE_LABEL,
  UI_START_STAGE_STEPS,
  UI_STOP_STAGE_LABEL,
  UI_STOP_STAGE_STEPS,
} from "@stella/shared";

function stageIndex(steps: { id: string }[], stage: string) {
  const i = steps.findIndex((s) => s.id === stage);
  return i < 0 ? -1 : i;
}

function TaskSteps({
  steps,
  active,
  failed,
  done,
  busy,
  label,
}: {
  steps: { id: string; label: string }[];
  active: number;
  failed: boolean;
  done: boolean;
  busy: boolean;
  label: string;
}) {
  if (!busy && !failed && !done) return null;
  return (
    <div className={`kx-task ${failed ? "is-error" : done ? "is-done" : "is-run"}`}>
      <div className="kx-task__head">
        {busy ? <span className="kx-task__spin" aria-hidden /> : null}
        <strong>{label}</strong>
      </div>
      {(busy || failed) && (
        <ol className="kx-task__steps" aria-label={label}>
          {steps.map((step, i) => {
            let cls = "kx-task__step";
            if (failed && (active < 0 ? i === 1 : i === active)) cls += " is-error";
            else if (done || (active >= 0 && i < active)) cls += " is-done";
            else if (active >= 0 && i === active && !failed) cls += " is-current";
            return (
              <li key={step.id} className={cls} title={step.label}>
                <span>{i + 1}</span>
                <small>{step.label}</small>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export function InstallTaskProgress({ kiosk }: { kiosk: KioskDto }) {
  const rawStage = (kiosk.installStage || "idle") as InstallStage;
  const failed = kiosk.installStatus === "error";
  const done = kiosk.installStatus === "ok" || rawStage === "done";
  const busy = kiosk.installStatus === "running" || kiosk.installStatus === "queued";

  let stage: InstallStage = rawStage;
  if (done) stage = "done";
  else if (failed) stage = rawStage !== "idle" ? rawStage : "error";
  else if (rawStage === "idle" && kiosk.installStatus === "queued") stage = "queued";
  else if (rawStage === "idle" && kiosk.installStatus === "running") stage = "connecting";

  const active = stageIndex(INSTALL_STAGE_STEPS, stage === "error" ? rawStage : stage);
  if (!busy && !failed && !done) return null;
  if (kiosk.installStatus === "idle" && rawStage === "idle" && !kiosk.installMessage) return null;

  const label = failed
    ? `Ошибка установки${rawStage !== "idle" && rawStage !== "error" ? ` · ${INSTALL_STAGE_LABEL[rawStage]}` : ""}`
    : done
      ? INSTALL_STAGE_LABEL.done
      : INSTALL_STAGE_LABEL[stage] || "Установка…";

  return (
    <div className="kx-tasks">
      <TaskSteps
        steps={INSTALL_STAGE_STEPS}
        active={active}
        failed={failed}
        done={done}
        busy={busy}
        label={label}
      />
      {kiosk.installMessage ? <p className="kx-task__msg">{kiosk.installMessage}</p> : null}
    </div>
  );
}

export function PolicyClearTaskProgress({ kiosk }: { kiosk: KioskDto }) {
  const status = kiosk.policyClearStatus || "idle";
  const stage = kiosk.policyClearStage || "idle";
  const failed = status === "error";
  const done = status === "ok";
  const busy = status === "running";

  const active = stageIndex(POLICY_CLEAR_STAGE_STEPS, stage === "error" ? "clearing" : stage);
  const label = failed
    ? "Ошибка снятия политик"
    : done
      ? POLICY_CLEAR_STAGE_LABEL.done
      : POLICY_CLEAR_STAGE_LABEL[stage as keyof typeof POLICY_CLEAR_STAGE_LABEL] || "Снятие политик…";

  if (!busy && !failed && !done) return null;

  return (
    <div className="kx-tasks">
      <TaskSteps
        steps={POLICY_CLEAR_STAGE_STEPS}
        active={active}
        failed={failed}
        done={done}
        busy={busy}
        label={label}
      />
      {kiosk.policyClearMessage ? <p className="kx-task__msg">{kiosk.policyClearMessage}</p> : null}
    </div>
  );
}

export function UiStartTaskProgress({ kiosk }: { kiosk: KioskDto }) {
  const status = kiosk.uiStartStatus || "idle";
  const stage = kiosk.uiStartStage || "idle";
  const failed = status === "error";
  const done = status === "ok";
  const busy = status === "running";

  const active = stageIndex(UI_START_STAGE_STEPS, stage === "error" ? "starting" : stage);
  const label = failed
    ? "Ошибка запуска UI"
    : done
      ? UI_START_STAGE_LABEL.done
      : UI_START_STAGE_LABEL[stage as keyof typeof UI_START_STAGE_LABEL] || "Запуск UI…";

  if (!busy && !failed && !done) return null;

  return (
    <div className="kx-tasks">
      <TaskSteps
        steps={UI_START_STAGE_STEPS}
        active={active}
        failed={failed}
        done={done}
        busy={busy}
        label={label}
      />
      {kiosk.uiStartMessage ? <p className="kx-task__msg">{kiosk.uiStartMessage}</p> : null}
    </div>
  );
}

export function UiStopTaskProgress({ kiosk }: { kiosk: KioskDto }) {
  const status = kiosk.uiStopStatus || "idle";
  const stage = kiosk.uiStopStage || "idle";
  const failed = status === "error";
  const done = status === "ok";
  const busy = status === "running";

  const active = stageIndex(UI_STOP_STAGE_STEPS, stage === "error" ? "stopping" : stage);
  const label = failed
    ? "Ошибка остановки"
    : done
      ? UI_STOP_STAGE_LABEL.done
      : UI_STOP_STAGE_LABEL[stage as keyof typeof UI_STOP_STAGE_LABEL] || "Остановка…";

  if (!busy && !failed && !done) return null;

  return (
    <div className="kx-tasks">
      <TaskSteps
        steps={UI_STOP_STAGE_STEPS}
        active={active}
        failed={failed}
        done={done}
        busy={busy}
        label={label}
      />
      {kiosk.uiStopMessage ? <p className="kx-task__msg">{kiosk.uiStopMessage}</p> : null}
    </div>
  );
}
