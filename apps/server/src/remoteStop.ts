import type { UiStopStage, UiStopStatus } from "@stella/shared";
import { UI_STOP_STAGE_LABEL } from "@stella/shared";
import { prisma } from "./prisma.js";
import { getEffectiveDeploy } from "./deployCredentials.js";
import { mapKiosk, probeKioskById } from "./kioskProbe.js";
import { broadcastKioskUpsert } from "./monitorHub.js";
import { getSiteNetworkSettings, resolveKioskNetwork } from "./networkSettings.js";
import {
  deployCredentialsOk,
  deployTransportError,
  isLocalKiosk,
  runDeployScript,
  summarizeDeployOutput,
} from "./remoteDeploy.js";

type UiStopJob = {
  status: UiStopStatus;
  stage: UiStopStage;
  message: string | null;
};

const jobs = new Map<string, UiStopJob>();

export function isUiStopRunning(id: string) {
  return jobs.get(id)?.status === "running";
}

export function dropUiStopJob(id: string) {
  jobs.delete(id);
}

export const idleUiStopFields = {
  uiStopStatus: "idle" as const,
  uiStopStage: "idle" as const,
  uiStopMessage: null,
};

function parseOkLine(text: string, marker: RegExp, fallback: string) {
  return (
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => marker.test(l))
      ?.replace(/^[^:]+:\s*/i, "") || fallback
  );
}

function isUiStopStage(s: string): s is UiStopStage {
  return s in UI_STOP_STAGE_LABEL;
}

function inferUiStopStage(line: string): UiStopStage | null {
  const m = /STAGE:([a-z_]+)/i.exec(line);
  if (m && isUiStopStage(m[1].toLowerCase())) return m[1].toLowerCase() as UiStopStage;
  if (/Connecting via WinRM|Connecting via SSH/i.test(line)) return "connecting";
  if (/Stopping agent|Edge UI|run_kiosk_local.*Stop/i.test(line)) return "stopping";
  return null;
}

function scheduleJobClear(id: string, delayMs: number) {
  setTimeout(() => {
    const job = jobs.get(id);
    if (job && job.status !== "running") jobs.delete(id);
  }, delayMs);
}

async function loadKioskDto(id: string) {
  const kiosk = await prisma.kiosk.findUnique({
    where: { id },
    include: { exhibit: { select: { title: true } } },
  });
  if (!kiosk) return null;
  const { enrichKioskDto } = await import("./kioskDtoEnrich.js");
  return enrichKioskDto(mapKiosk(kiosk));
}

async function setUiStopJob(id: string, status: UiStopStatus, stage: UiStopStage, message: string | null) {
  jobs.set(id, { status, stage, message });
  const dto = await loadKioskDto(id);
  if (dto) broadcastKioskUpsert(dto);
  return dto;
}

export function applyUiStopToDto<T extends ReturnType<typeof mapKiosk>>(dto: T) {
  const job = jobs.get(dto.id);
  if (!job) return { ...dto, ...idleUiStopFields };
  return {
    ...dto,
    uiStopStatus: job.status,
    uiStopStage: job.stage,
    uiStopMessage: job.message,
  };
}

async function runStopUiJob(id: string) {
  const kiosk = await prisma.kiosk.findUnique({
    where: { id },
    include: { exhibit: { select: { title: true } } },
  });
  if (!kiosk) {
    jobs.delete(id);
    return;
  }

  const isLocal = isLocalKiosk(kiosk.hostname);
  const site = await getSiteNetworkSettings();
  const net = resolveKioskNetwork(kiosk, site);
  const args = [
    "-Hostname",
    kiosk.hostname,
    "-UiPort",
    String(net.uiPort),
    "-HealthPort",
    String(net.healthPort),
  ];
  if (isLocal) args.push("-LocalOnly");
  else {
    const deploy = getEffectiveDeploy();
    args.push("-DeployUser", deploy.user, "-DeployPassword", deploy.password);
  }

  try {
    let lastStage: UiStopStage = "connecting";
    const result = await runDeployScript("remote-stop", args, {
      timeoutMs: 120_000,
      onLine: (line) => {
        const stage = inferUiStopStage(line);
        if (stage && stage !== lastStage && stage !== "done") {
          lastStage = stage;
          void setUiStopJob(id, "running", stage, UI_STOP_STAGE_LABEL[stage]);
        } else if (/^STAGE:done/i.test(line)) {
          lastStage = "done";
        } else if (/Stopping agent|Connecting via/i.test(line.trim())) {
          void setUiStopJob(id, "running", lastStage, line.trim().slice(0, 200));
        }
      },
    });

    const text = `${result.stdout}\n${result.stderr}`.trim();
    if (/STOP_OK/i.test(text)) {
      const msg = parseOkLine(text, /STOP_OK:/i, UI_STOP_STAGE_LABEL.done);
      await setUiStopJob(id, "ok", "done", msg);
      await probeKioskById(id);
      const enriched = await loadKioskDto(id);
      if (enriched) broadcastKioskUpsert(enriched);
      scheduleJobClear(id, 8000);
      return;
    }

    await setUiStopJob(
      id,
      "error",
      "error",
      summarizeDeployOutput(text, result.code) || "Не удалось выключить"
    );
    scheduleJobClear(id, 30_000);
  } catch (e) {
    await setUiStopJob(id, "error", "error", e instanceof Error ? e.message : "Stop failed");
    scheduleJobClear(id, 30_000);
  }
}

export async function requestStopKioskRuntime(id: string): Promise<{
  ok: boolean;
  alreadyRunning: boolean;
  message: string;
  kiosk: ReturnType<typeof applyUiStopToDto<ReturnType<typeof mapKiosk>>> | null;
}> {
  const transportErr = deployTransportError();
  if (transportErr) return { ok: false, alreadyRunning: false, message: transportErr, kiosk: null };

  const kiosk = await prisma.kiosk.findUnique({
    where: { id },
    include: { exhibit: { select: { title: true } } },
  });
  if (!kiosk) return { ok: false, alreadyRunning: false, message: "Not found", kiosk: null };

  const isLocal = isLocalKiosk(kiosk.hostname);
  if (!isLocal && !deployCredentialsOk()) {
    return {
      ok: false,
      alreadyRunning: false,
      message: "Задайте DEPLOY_USER / DEPLOY_PASSWORD в .env",
      kiosk: applyUiStopToDto(mapKiosk(kiosk)),
    };
  }

  const existing = jobs.get(id);
  if (existing?.status === "running") {
    return {
      ok: true,
      alreadyRunning: true,
      message: "Остановка выполняется…",
      kiosk: applyUiStopToDto(mapKiosk(kiosk)),
    };
  }

  await setUiStopJob(id, "running", "connecting", UI_STOP_STAGE_LABEL.connecting);
  void runStopUiJob(id);

  const dto = await loadKioskDto(id);
  return {
    ok: true,
    alreadyRunning: false,
    message: "Остановка начата",
    kiosk: dto,
  };
}

/** @deprecated use requestStopKioskRuntime */
export async function stopKioskRuntime(id: string) {
  const result = await requestStopKioskRuntime(id);
  return {
    ok: result.ok,
    message: result.message,
    kiosk: result.kiosk,
  };
}
