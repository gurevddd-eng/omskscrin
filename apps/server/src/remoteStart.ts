import type { UiStartStage, UiStartStatus } from "@stella/shared";
import { UI_START_STAGE_LABEL } from "@stella/shared";
import { prisma } from "./prisma.js";
import { config } from "./config.js";
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

type UiStartJob = {
  status: UiStartStatus;
  stage: UiStartStage;
  message: string | null;
};

const jobs = new Map<string, UiStartJob>();

export function isUiStartRunning(id: string) {
  return jobs.get(id)?.status === "running";
}

export function dropUiStartJob(id: string) {
  jobs.delete(id);
}

export const idleUiStartFields = {
  uiStartStatus: "idle" as const,
  uiStartStage: "idle" as const,
  uiStartMessage: null,
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

function isUiStartStage(s: string): s is UiStartStage {
  return s in UI_START_STAGE_LABEL;
}

function inferUiStartStage(line: string): UiStartStage | null {
  const m = /STAGE:([a-z_]+)/i.exec(line);
  if (m && isUiStartStage(m[1].toLowerCase())) return m[1].toLowerCase() as UiStartStage;
  if (/Connecting via WinRM|Connecting via SSH/i.test(line)) return "connecting";
  if (/Starting agent|Edge UI|run_kiosk_local.*Start/i.test(line)) return "starting";
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

async function setUiStartJob(id: string, status: UiStartStatus, stage: UiStartStage, message: string | null) {
  jobs.set(id, { status, stage, message });
  const dto = await loadKioskDto(id);
  if (dto) broadcastKioskUpsert(dto);
  return dto;
}

export function applyUiStartToDto<T extends ReturnType<typeof mapKiosk>>(dto: T) {
  const job = jobs.get(dto.id);
  if (!job) return { ...dto, ...idleUiStartFields };
  return {
    ...dto,
    uiStartStatus: job.status,
    uiStartStage: job.stage,
    uiStartMessage: job.message,
  };
}

async function runStartUiJob(id: string) {
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
  else args.push("-DeployUser", config.deployUser, "-DeployPassword", config.deployPassword);

  try {
    let lastStage: UiStartStage = "connecting";
    const result = await runDeployScript("remote-start", args, {
      timeoutMs: 120_000,
      onLine: (line) => {
        const stage = inferUiStartStage(line);
        if (stage && stage !== lastStage && stage !== "done") {
          lastStage = stage;
          void setUiStartJob(id, "running", stage, UI_START_STAGE_LABEL[stage]);
        } else if (/^STAGE:done/i.test(line)) {
          lastStage = "done";
        } else if (/Starting agent|Connecting via/i.test(line.trim())) {
          void setUiStartJob(id, "running", lastStage, line.trim().slice(0, 200));
        }
      },
    });

    const text = `${result.stdout}\n${result.stderr}`.trim();
    if (/START_OK/i.test(text)) {
      const msg = parseOkLine(text, /START_OK:/i, UI_START_STAGE_LABEL.done);
      await setUiStartJob(id, "ok", "done", msg);
      await probeKioskById(id);
      const enriched = await loadKioskDto(id);
      if (enriched) broadcastKioskUpsert(enriched);
      scheduleJobClear(id, 8000);
      return;
    }

    await setUiStartJob(
      id,
      "error",
      "error",
      summarizeDeployOutput(text, result.code) || "Не удалось запустить"
    );
    scheduleJobClear(id, 30_000);
  } catch (e) {
    await setUiStartJob(id, "error", "error", e instanceof Error ? e.message : "Start failed");
    scheduleJobClear(id, 30_000);
  }
}

export async function requestStartKioskRuntime(id: string): Promise<{
  ok: boolean;
  alreadyRunning: boolean;
  message: string;
  kiosk: ReturnType<typeof applyUiStartToDto<ReturnType<typeof mapKiosk>>> | null;
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
      kiosk: applyUiStartToDto(mapKiosk(kiosk)),
    };
  }

  const existing = jobs.get(id);
  if (existing?.status === "running") {
    return {
      ok: true,
      alreadyRunning: true,
      message: "Запуск UI выполняется…",
      kiosk: applyUiStartToDto(mapKiosk(kiosk)),
    };
  }

  await setUiStartJob(id, "running", "connecting", UI_START_STAGE_LABEL.connecting);
  void runStartUiJob(id);

  const dto = await loadKioskDto(id);
  return {
    ok: true,
    alreadyRunning: false,
    message: "Запуск UI начат",
    kiosk: dto,
  };
}

/** @deprecated use requestStartKioskRuntime */
export async function startKioskRuntime(id: string) {
  const result = await requestStartKioskRuntime(id);
  return {
    ok: result.ok,
    message: result.message,
    kiosk: result.kiosk,
  };
}
