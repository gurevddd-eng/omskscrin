import { prisma } from "./prisma.js";
import { config } from "./config.js";
import { mapKiosk } from "./kioskProbe.js";
import { getSiteNetworkSettings, resolveKioskNetwork } from "./networkSettings.js";
import {
  deployTransportError,
  isLocalKiosk,
  runDeployScript,
  summarizeDeployOutput,
} from "./remoteDeploy.js";

const running = new Set<string>();

export function isUninstallRunning(id: string) {
  return running.has(id);
}

function parseOkLine(text: string, marker: RegExp, fallback: string) {
  return (
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => marker.test(l))
      ?.replace(/^[^:]+:\s*/i, "") || fallback
  );
}

export async function uninstallKioskRuntime(id: string): Promise<{
  ok: boolean;
  message: string;
  kiosk: ReturnType<typeof mapKiosk> | null;
}> {
  const transportErr = deployTransportError();
  if (transportErr) return { ok: false, message: transportErr, kiosk: null };
  if (running.has(id)) return { ok: false, message: "Удаление софта уже выполняется", kiosk: null };

  const kiosk = await prisma.kiosk.findUnique({
    where: { id },
    include: { exhibit: { select: { title: true } } },
  });
  if (!kiosk) return { ok: false, message: "Not found", kiosk: null };

  const isLocal = isLocalKiosk(kiosk.hostname);
  if (
    !isLocal &&
    (!config.deployUser ||
      (!config.deployPassword && !config.deploySshKeyPath) ||
      /^domain\\/i.test(config.deployUser) ||
      config.deployUser.toLowerCase() === "domain\\admin")
  ) {
    return { ok: false, message: "Задайте DEPLOY_USER / DEPLOY_PASSWORD в .env", kiosk: mapKiosk(kiosk) };
  }

  running.add(id);
  try {
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

    const result = await runDeployScript("remote-uninstall", args, { timeoutMs: 180_000 });
    const text = `${result.stdout}\n${result.stderr}`.trim();
    if (/UNINSTALL_OK/i.test(text)) {
      return {
        ok: true,
        message: parseOkLine(text, /UNINSTALL_OK:/i, "Софт удалён с ПК"),
        kiosk: mapKiosk(kiosk),
      };
    }
    return {
      ok: false,
      message: summarizeDeployOutput(text, result.code) || "Не удалось удалить софт с ПК",
      kiosk: mapKiosk(kiosk),
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Uninstall failed",
      kiosk: mapKiosk(kiosk),
    };
  } finally {
    running.delete(id);
  }
}
