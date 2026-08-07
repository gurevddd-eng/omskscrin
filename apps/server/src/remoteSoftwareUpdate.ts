import { prisma } from "./prisma.js";
import { getEffectiveDeploy } from "./deployCredentials.js";
import { getDeployMeta } from "./deployMeta.js";
import { mapKiosk, probeKioskById } from "./kioskProbe.js";
import { broadcastKioskUpsert } from "./monitorHub.js";
import {
  deployCredentialsOk,
  deployTransportError,
  isLocalKiosk,
  runDeployScript,
  summarizeDeployOutput,
} from "./remoteDeploy.js";
import {
  clearSoftwareUpdatePending,
  markSoftwareUpdatePending,
} from "./softwareUpdatePending.js";

const running = new Set<string>();

export type SoftwareUpdateMode =
  | "pending"
  | "signaled"
  | "already-current"
  | "no-package"
  | "offline-pending"
  | "error";

export type SoftwareUpdateResult = {
  ok: boolean;
  mode: SoftwareUpdateMode;
  message: string;
  targetSoftwareVersion: string | null;
  localSoftwareVersion: string | null;
  kiosk: ReturnType<typeof mapKiosk> | null;
};

function parseOk(text: string) {
  return (
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => /FORCE_OK:/i.test(l))
      ?.replace(/^[^:]+:\s*/i, "") || "FORCE_UPDATE written"
  );
}

async function signalForceUpdateViaWinRm(
  id: string,
  hostname: string,
  target: string
): Promise<{ ok: boolean; message: string }> {
  if (running.has(id)) {
    return { ok: false, message: "Обновление уже запущено" };
  }
  const isLocal = isLocalKiosk(hostname);
  const transportErr = deployTransportError();
  const canWinRm = !transportErr && (isLocal || deployCredentialsOk());
  if (!canWinRm) {
    return {
      ok: false,
      message: transportErr || "WinRM недоступен",
    };
  }

  running.add(id);
  try {
    const args = ["-Hostname", hostname, "-TargetVersion", target];
    if (isLocal) args.push("-LocalOnly");
    else {
      const deploy = getEffectiveDeploy();
      args.push("-DeployUser", deploy.user, "-DeployPassword", deploy.password);
    }
    const result = await runDeployScript("remote-force-update", args, { timeoutMs: 45_000 });
    const text = `${result.stdout}\n${result.stderr}`.trim();
    if (/FORCE_OK/i.test(text)) {
      const msg = parseOk(text);
      console.log(`[software-update] ${hostname}: ${msg}`);
      await probeKioskById(id).catch(() => null);
      return { ok: true, message: msg };
    }
    const detail = summarizeDeployOutput(text, result.code);
    console.warn(`[software-update] ${hostname}: WinRM nudge failed — ${detail}`);
    return { ok: false, message: detail };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[software-update] ${hostname}:`, msg);
    return { ok: false, message: msg };
  } finally {
    running.delete(id);
  }
}

export async function requestKioskSoftwareUpdate(
  id: string,
  opts?: { force?: boolean; waitWinRm?: boolean }
): Promise<SoftwareUpdateResult> {
  const force = opts?.force !== false;
  const waitWinRm = opts?.waitWinRm !== false; // default: wait so kiosk starts immediately
  const meta = getDeployMeta();
  const target = meta.softwareVersion && meta.softwareVersion !== "0" ? meta.softwareVersion : null;
  const hasZip = Boolean(meta.updateZipPath || meta.packageZipPath);

  if (!target || !hasZip) {
    return {
      ok: false,
      mode: "no-package",
      message: "Нет update.zip / package.zip. Соберите: pnpm pack:kiosk-deploy",
      targetSoftwareVersion: target,
      localSoftwareVersion: null,
      kiosk: null,
    };
  }

  const kiosk = await prisma.kiosk.findUnique({
    where: { id },
    include: { exhibit: { select: { title: true } } },
  });
  if (!kiosk) {
    return {
      ok: false,
      mode: "error",
      message: "Not found",
      targetSoftwareVersion: target,
      localSoftwareVersion: null,
      kiosk: null,
    };
  }

  const local = kiosk.softwareVersion?.trim() || null;
  if (!force && local && local === target) {
    clearSoftwareUpdatePending(kiosk.kioskId);
    return {
      ok: true,
      mode: "already-current",
      message: `Уже на версии ${target}`,
      targetSoftwareVersion: target,
      localSoftwareVersion: local,
      kiosk: mapKiosk(kiosk),
    };
  }

  markSoftwareUpdatePending(kiosk.kioskId, target);
  if (kiosk.hostname && kiosk.hostname !== kiosk.kioskId) {
    markSoftwareUpdatePending(kiosk.hostname, target);
  }
  const dto = mapKiosk(kiosk);
  broadcastKioskUpsert(dto);

  const transportErr = deployTransportError();

  if (waitWinRm) {
    const signal = await signalForceUpdateViaWinRm(id, kiosk.hostname, target);
    if (signal.ok) {
      return {
        ok: true,
        mode: "signaled",
        message: `OTA → ${target}: сигнал на киоск отправлен (${signal.message})`,
        targetSoftwareVersion: target,
        localSoftwareVersion: local,
        kiosk: dto,
      };
    }
    return {
      ok: true,
      mode: "pending",
      message: `OTA → ${target}: ждём агент по heartbeat (~30 с). WinRM: ${signal.message}`,
      targetSoftwareVersion: target,
      localSoftwareVersion: local,
      kiosk: dto,
    };
  }

  void signalForceUpdateViaWinRm(id, kiosk.hostname, target);
  return {
    ok: true,
    mode: "pending",
    message: transportErr
      ? `OTA → ${target}: ждём агент (~30 с). WinRM: ${transportErr}`
      : `OTA → ${target}: сигнал уходит, киоск обновится сразу после WinRM / heartbeat`,
    targetSoftwareVersion: target,
    localSoftwareVersion: local,
    kiosk: dto,
  };
}

export async function requestBulkSoftwareUpdate(ids?: string[]): Promise<{
  targetSoftwareVersion: string | null;
  results: Array<{
    id: string;
    hostname: string;
    ok: boolean;
    mode: SoftwareUpdateMode;
    message: string;
  }>;
}> {
  const meta = getDeployMeta();
  const target = meta.softwareVersion && meta.softwareVersion !== "0" ? meta.softwareVersion : null;

  let list = await prisma.kiosk.findMany({
    include: { exhibit: { select: { title: true } } },
    orderBy: { name: "asc" },
  });

  if (ids && ids.length) {
    const set = new Set(ids);
    list = list.filter((k) => set.has(k.id));
  } else {
    const threshold = Date.now() - 90_000;
    list = list.filter((k) => k.lastSeenAt && k.lastSeenAt.getTime() > threshold);
  }

  // Parallel WinRM so fleet updates start together without N×serial wait
  const settled = await Promise.all(
    list.map(async (k) => {
      const r = await requestKioskSoftwareUpdate(k.id, { force: true, waitWinRm: true });
      return {
        id: k.id,
        hostname: k.hostname,
        ok: r.ok,
        mode: r.mode,
        message: r.message,
      };
    })
  );

  return { targetSoftwareVersion: target, results: settled };
}
