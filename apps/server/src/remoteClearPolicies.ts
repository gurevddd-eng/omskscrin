import type { PolicyClearStage, PolicyClearStatus } from "@stella/shared";
import { POLICY_CLEAR_STAGE_LABEL } from "@stella/shared";
import { prisma } from "./prisma.js";
import { getEffectiveDeploy } from "./deployCredentials.js";
import { mapKiosk } from "./kioskProbe.js";
import { broadcastKioskUpsert } from "./monitorHub.js";
import {
  deployCredentialsOk,
  deployTransportError,
  isLocalKiosk,
  runDeployScript,
  summarizeDeployOutput,
} from "./remoteDeploy.js";

type PolicyClearJob = {
  status: PolicyClearStatus;
  stage: PolicyClearStage;
  message: string | null;
};

const jobs = new Map<string, PolicyClearJob>();

export function isPolicyClearRunning(id: string) {
  return jobs.get(id)?.status === "running";
}

export function dropPolicyClearJob(id: string) {
  jobs.delete(id);
}

const idlePolicyClear = {
  policyClearStatus: "idle" as const,
  policyClearStage: "idle" as const,
  policyClearMessage: null,
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

function isClearStage(s: string): s is PolicyClearStage {
  return s in POLICY_CLEAR_STAGE_LABEL;
}

function inferClearStage(line: string): PolicyClearStage | null {
  const m = /STAGE:([a-z_]+)/i.exec(line);
  if (m && isClearStage(m[1].toLowerCase())) return m[1].toLowerCase() as PolicyClearStage;
  if (/Connecting via WinRM|Connecting via SSH/i.test(line)) return "connecting";
  if (/Clearing lockdown|ClearPolicies|copy_clear_policies/i.test(line)) return "clearing";
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

async function setPolicyClearJob(
  id: string,
  status: PolicyClearStatus,
  stage: PolicyClearStage,
  message: string | null
) {
  jobs.set(id, { status, stage, message });
  const dto = await loadKioskDto(id);
  if (dto) broadcastKioskUpsert(dto);
  return dto;
}

export function applyPolicyClearToDto<T extends ReturnType<typeof mapKiosk>>(dto: T) {
  const job = jobs.get(dto.id);
  if (!job) return { ...dto, ...idlePolicyClear };
  return {
    ...dto,
    policyClearStatus: job.status,
    policyClearStage: job.stage,
    policyClearMessage: job.message,
  };
}

/** @deprecated use applyPolicyClearToDto via kioskDtoEnrich.enrichKioskDto */
export function enrichKioskDto<T extends ReturnType<typeof mapKiosk>>(dto: T) {
  return applyPolicyClearToDto(dto);
}

async function runClearPoliciesJob(id: string) {
  const kiosk = await prisma.kiosk.findUnique({
    where: { id },
    include: { exhibit: { select: { title: true } } },
  });
  if (!kiosk) {
    jobs.delete(id);
    return;
  }

  const isLocal = isLocalKiosk(kiosk.hostname);
  const args = ["-Hostname", kiosk.hostname];
  if (isLocal) args.push("-LocalOnly");
  else {
    const deploy = getEffectiveDeploy();
    args.push("-DeployUser", deploy.user, "-DeployPassword", deploy.password);
  }

  try {
    let lastStage: PolicyClearStage = "connecting";
    const result = await runDeployScript("remote-clear-policies", args, {
      timeoutMs: 120_000,
      onLine: (line) => {
        const stage = inferClearStage(line);
        if (stage && stage !== lastStage && stage !== "done") {
          lastStage = stage;
          void setPolicyClearJob(id, "running", stage, POLICY_CLEAR_STAGE_LABEL[stage]);
        } else if (/^STAGE:done/i.test(line)) {
          lastStage = "done";
        } else if (/Clearing lockdown|Connecting via/i.test(line.trim())) {
          void setPolicyClearJob(id, "running", lastStage, line.trim().slice(0, 200));
        }
      },
    });

    const text = `${result.stdout}\n${result.stderr}`.trim();
    if (/CLEAR_OK/i.test(text)) {
      await setPolicyClearJob(
        id,
        "ok",
        "done",
        parseOkLine(text, /CLEAR_OK:/i, POLICY_CLEAR_STAGE_LABEL.done)
      );
      scheduleJobClear(id, 8000);
      return;
    }

    await setPolicyClearJob(
      id,
      "error",
      "error",
      summarizeDeployOutput(text, result.code) || "Не удалось снять политики"
    );
    scheduleJobClear(id, 30_000);
  } catch (e) {
    await setPolicyClearJob(
      id,
      "error",
      "error",
      e instanceof Error ? e.message : "Clear policies failed"
    );
    scheduleJobClear(id, 30_000);
  }
}

export async function requestClearKioskPolicies(id: string): Promise<{
  ok: boolean;
  alreadyRunning: boolean;
  message: string;
  kiosk: ReturnType<typeof enrichKioskDto<ReturnType<typeof mapKiosk>>> | null;
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
      kiosk: applyPolicyClearToDto(mapKiosk(kiosk)),
    };
  }

  const existing = jobs.get(id);
  if (existing?.status === "running") {
    return {
      ok: true,
      alreadyRunning: true,
      message: "Снятие политик выполняется…",
      kiosk: applyPolicyClearToDto(mapKiosk(kiosk)),
    };
  }

  await setPolicyClearJob(id, "running", "connecting", POLICY_CLEAR_STAGE_LABEL.connecting);
  void runClearPoliciesJob(id);

  const dto = await loadKioskDto(id);
  return {
    ok: true,
    alreadyRunning: false,
    message: "Снятие политик запущено",
    kiosk: dto,
  };
}

/** @deprecated use requestClearKioskPolicies */
export async function clearKioskPolicies(id: string) {
  const result = await requestClearKioskPolicies(id);
  return {
    ok: result.ok,
    message: result.message,
    kiosk: result.kiosk,
  };
}
