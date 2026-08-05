import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

export type DeployScriptName =
  | "remote-install"
  | "remote-start"
  | "remote-stop"
  | "remote-uninstall"
  | "remote-clear-policies"
  | "remote-push-config";

export type DeployTransportKind = "winrm" | "ssh";

export type DeployRuntime = {
  platform: NodeJS.Platform;
  transport: DeployTransportKind;
  transportConfigured: "auto" | DeployTransportKind;
  powerShell: string | null;
  sshClient: boolean;
  sshpass: boolean;
  scriptsDir: string;
  message: string;
};

export type RunDeployOptions = {
  timeoutMs?: number;
  onLine?: (line: string) => void;
  onSpawn?: (proc: ChildProcess) => void;
};

export type DeployRunResult = {
  code: number;
  stdout: string;
  stderr: string;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const deployScriptsDir = path.join(repoRoot, "apps/server/scripts");

const psCandidates = (): string[] => {
  const fromEnv = (config.deployPowerShell || "").trim();
  if (fromEnv) return [fromEnv];
  if (process.platform === "win32") return ["powershell.exe", "pwsh", "pwsh.exe"];
  return ["pwsh", "/usr/bin/pwsh", "powershell.exe"];
};

function commandExists(bin: string): boolean {
  if (path.isAbsolute(bin) && existsSync(bin)) return true;
  if ((bin.includes("/") || bin.includes("\\")) && existsSync(bin)) return true;
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [bin], {
    encoding: "utf8",
    windowsHide: true,
  });
  return r.status === 0;
}

/** Sync-ish probe: spawn which/where and wait briefly */
function resolveBinary(candidates: string[]): string | null {
  for (const c of candidates) {
    if (commandExists(c)) return c;
  }
  return null;
}

export function resolvePowerShell(): string | null {
  return resolveBinary(psCandidates());
}

export function resolveSshClient(): boolean {
  return Boolean(resolveBinary(["ssh", "/usr/bin/ssh"]));
}

export function resolveSshpass(): boolean {
  return Boolean(resolveBinary(["sshpass", "/usr/bin/sshpass"]));
}

export function resolveTransport(): DeployTransportKind {
  const configured = config.deployTransport;
  if (configured === "winrm" || configured === "ssh") return configured;

  // Debian/Linux server → Windows kiosks: WinRM via pwsh if available, else SSH
  if (resolvePowerShell()) return "winrm";
  if (resolveSshClient()) return "ssh";
  return "winrm";
}

export function getDeployRuntime(): DeployRuntime {
  const ps = resolvePowerShell();
  const ssh = resolveSshClient();
  const transport = resolveTransport();
  let message = "";
  if (transport === "winrm") {
    if (!ps) {
      message =
        "Установите PowerShell 7 (pwsh) и модуль PSWSMan на Debian, либо задайте DEPLOY_TRANSPORT=ssh и включите OpenSSH на киосках.";
    } else if (process.platform !== "win32") {
      message = "Удалённое управление Windows-киосками через WinRM (pwsh + PSWSMan).";
    }
  } else if (!ssh) {
    message = "Клиент ssh не найден. Установите openssh-client на сервере.";
  } else if (!config.deployPassword && !config.deploySshKeyPath) {
    message = "Для SSH задайте DEPLOY_PASSWORD (и sshpass) или DEPLOY_SSH_KEY_PATH.";
  } else {
    message = "Удалённое управление Windows-киосками через OpenSSH (scp + powershell на киоске).";
  }

  return {
    platform: process.platform,
    transport,
    transportConfigured: config.deployTransport,
    powerShell: ps,
    sshClient: ssh,
    sshpass: resolveSshpass(),
    scriptsDir: deployScriptsDir,
    message,
  };
}

export function deployCredentialsOk(): boolean {
  return Boolean(
    config.deployUser &&
      !/^domain\\/i.test(config.deployUser) &&
      config.deployUser.toLowerCase() !== "domain\\admin" &&
      (config.deployPassword || config.deploySshKeyPath)
  );
}

export function isLocalKiosk(hostname: string): boolean {
  const localHost = os.hostname().toLowerCase();
  const h = hostname.toLowerCase();
  return h === localHost || h === "localhost" || h === "127.0.0.1";
}

export function decodeDeployChunk(buf: Buffer): string {
  const asUtf8 = buf.toString("utf8");
  if (!asUtf8.includes("\uFFFD")) return asUtf8;
  return buf.toString("latin1");
}

export function killDeployProcessTree(proc: ChildProcess) {
  if (!proc.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } else {
    try {
      proc.kill("SIGTERM");
    } catch {
      /* already exited */
    }
  }
}

export function summarizeDeployOutput(text: string, code: number, extraSkip?: RegExp) {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        l &&
        !l.startsWith("At ") &&
        !l.startsWith("+ ") &&
        !/^STAGE:/i.test(l) &&
        !l.includes("CategoryInfo") &&
        !l.includes("FullyQualifiedErrorId") &&
        !(extraSkip && extraSkip.test(l))
    );
  return (lines.slice(-6).join(" | ") || text.slice(-500) || `exit ${code}`).slice(0, 700);
}

function scriptPath(name: DeployScriptName, transport: DeployTransportKind): string {
  const ext = transport === "ssh" ? "-ssh.sh" : ".ps1";
  return path.join(deployScriptsDir, `${name}${ext}`);
}

function spawnProcess(
  bin: string,
  args: string[],
  options: RunDeployOptions
): Promise<DeployRunResult> {
  return new Promise((resolve) => {
    const proc = spawn(bin, args, {
      windowsHide: process.platform === "win32",
      env: { ...process.env },
    });
    options.onSpawn?.(proc);

    let stdout = "";
    let stderr = "";
    let buf = "";
    let settled = false;
    const timeoutMs = options.timeoutMs ?? 120_000;

    const finish = (code: number, extraErr = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr: extraErr ? `${stderr}\n${extraErr}`.trim() : stderr });
    };

    const timer = setTimeout(() => {
      killDeployProcessTree(proc);
      finish(1, `timeout after ${Math.round(timeoutMs / 1000)}s`);
    }, timeoutMs);

    const consume = (chunk: string, isErr: boolean) => {
      if (isErr) stderr += chunk;
      else stdout += chunk;
      if (!options.onLine) return;
      buf += chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const parts = buf.split("\n");
      buf = parts.pop() || "";
      for (const line of parts) {
        if (line.trim()) options.onLine(line);
      }
    };

    proc.stdout.on("data", (d: Buffer) => consume(decodeDeployChunk(d), false));
    proc.stderr.on("data", (d: Buffer) => consume(decodeDeployChunk(d), true));
    proc.on("close", (code) => {
      if (buf.trim() && options.onLine) options.onLine(buf.trim());
      finish(code ?? 1);
    });
    proc.on("error", (err) => finish(1, String(err)));
  });
}

/** Run remote deploy script (WinRM via pwsh on Debian, or SSH fallback). */
export async function runDeployScript(
  name: DeployScriptName,
  psArgs: string[],
  options: RunDeployOptions = {}
): Promise<DeployRunResult> {
  const transport = resolveTransport();
  const script = scriptPath(name, transport);

  if (!existsSync(script)) {
    return {
      code: 1,
      stdout: "",
      stderr: `${path.basename(script)} not found`,
    };
  }

  if (transport === "winrm") {
    const ps = resolvePowerShell();
    if (!ps) {
      return {
        code: 1,
        stdout: "",
        stderr:
          "PowerShell (pwsh) не найден на сервере. На Debian: apt install powershell + Install-Module PSWSMan, или DEPLOY_TRANSPORT=ssh",
      };
    }
    return spawnProcess(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...psArgs], options);
  }

  // SSH transport: bash script, same -Param flags as PowerShell scripts
  const bash = resolveBinary(["bash", "/bin/bash", "sh"]) || "bash";
  const env = {
    ...process.env,
    DEPLOY_USER: config.deployUser,
    DEPLOY_PASSWORD: config.deployPassword,
    DEPLOY_SSH_PORT: String(config.deploySshPort),
    DEPLOY_SSH_KEY_PATH: config.deploySshKeyPath,
    DEPLOY_PACKAGE_DIR: config.deployPackageDir,
  };
  return new Promise((resolve) => {
    const proc = spawn(bash, [script, ...psArgs], {
      env,
      windowsHide: false,
    });
    options.onSpawn?.(proc);

    let stdout = "";
    let stderr = "";
    let buf = "";
    let settled = false;
    const timeoutMs = options.timeoutMs ?? 120_000;

    const finish = (code: number, extraErr = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr: extraErr ? `${stderr}\n${extraErr}`.trim() : stderr });
    };

    const timer = setTimeout(() => {
      killDeployProcessTree(proc);
      finish(1, `timeout after ${Math.round(timeoutMs / 1000)}s`);
    }, timeoutMs);

    const consume = (chunk: string, isErr: boolean) => {
      if (isErr) stderr += chunk;
      else stdout += chunk;
      if (!options.onLine) return;
      buf += chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const parts = buf.split("\n");
      buf = parts.pop() || "";
      for (const line of parts) {
        if (line.trim()) options.onLine(line);
      }
    };

    proc.stdout.on("data", (d: Buffer) => consume(decodeDeployChunk(d), false));
    proc.stderr.on("data", (d: Buffer) => consume(decodeDeployChunk(d), true));
    proc.on("close", (code) => {
      if (buf.trim() && options.onLine) options.onLine(buf.trim());
      finish(code ?? 1);
    });
    proc.on("error", (err) => finish(1, String(err)));
  });
}

export function deployTransportError(): string | null {
  const rt = getDeployRuntime();
  if (rt.transport === "winrm" && !rt.powerShell) {
    return "На Debian-сервере нужен pwsh для WinRM или DEPLOY_TRANSPORT=ssh";
  }
  if (rt.transport === "ssh" && !rt.sshClient) {
    return "Установите openssh-client на Debian-сервере";
  }
  if (rt.transport === "ssh" && !deployCredentialsOk()) {
    return "Задайте DEPLOY_USER и DEPLOY_PASSWORD (sshpass) или DEPLOY_SSH_KEY_PATH";
  }
  return null;
}
