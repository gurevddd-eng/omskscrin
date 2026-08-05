import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { deployCredentialsOk, getDeployRuntime } from "./remoteDeploy.js";
export type DeployMeta = {
  softwareVersion: string;
  appVersion: string;
  builtAt: string | null;
  updateZipPath: string | null;
  packageZipPath: string | null;
};

export type DeployComponent = {
  id: string;
  label: string;
  ready: boolean;
  detail?: string;
};

export type DeployStatusDetail = {
  packageReady: boolean;
  packageDir: string;
  serverPublicUrl: string | null;
  softwareVersion: string | null;
  deployCredentialsConfigured: boolean;
  deployTransport: string;
  deployRuntimeMessage: string;
  components: DeployComponent[];
  willInstall: string[];
  prerequisites: { id: string; label: string; ok: boolean; hint?: string }[];
};
function readVersionJson(dir: string): { softwareVersion?: string; appVersion?: string; builtAt?: string } | null {
  const file = path.join(dir, "version.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as {
      softwareVersion?: string;
      appVersion?: string;
      builtAt?: string;
    };
  } catch {
    return null;
  }
}

function readVersionText(dir: string): string | null {
  const file = path.join(dir, "VERSION");
  if (!existsSync(file)) return null;
  try {
    return readFileSync(file, "utf8").trim() || null;
  } catch {
    return null;
  }
}

function fileSizeMb(file: string): string | undefined {
  try {
    return `${(statSync(file).size / (1024 * 1024)).toFixed(1)} MB`;
  } catch {
    return undefined;
  }
}

export function getDeployMeta(): DeployMeta {
  const dir = config.deployPackageDir;
  const json = readVersionJson(dir);
  const text = readVersionText(dir);
  const updateZip = path.join(dir, "update.zip");
  const packageZip = path.join(dir, "package.zip");

  const softwareVersion =
    json?.softwareVersion?.trim() ||
    text ||
    (existsSync(packageZip) ? String(statSync(packageZip).mtimeMs) : "0");

  return {
    softwareVersion,
    appVersion: json?.appVersion?.trim() || "0.1.0",
    builtAt: json?.builtAt ?? null,
    updateZipPath: existsSync(updateZip) ? updateZip : null,
    packageZipPath: existsSync(packageZip) ? packageZip : null,
  };
}

export function getDeployStatusDetail(): DeployStatusDetail {
  const dir = config.deployPackageDir;
  const meta = getDeployMeta();
  const agent = path.join(dir, "agent.mjs");
  const ui = path.join(dir, "ui", "index.html");
  const node = path.join(dir, "runtime", "node.exe");
  const installLocal = path.join(dir, "install-local.ps1");
  const games = path.join(dir, "games");
  const packageZip = path.join(dir, "package.zip");
  const updateZip = path.join(dir, "update.zip");

  const components: DeployComponent[] = [
    {
      id: "agent",
      label: "Агент киоска (agent.mjs)",
      ready: existsSync(agent),
    },
    {
      id: "ui",
      label: "Интерфейс киоска (ui/)",
      ready: existsSync(ui),
    },
    {
      id: "node",
      label: "Portable Node.js",
      ready: existsSync(node),
      detail: existsSync(node) ? fileSizeMb(node) : "нужен для запуска агента",
    },
    {
      id: "installer",
      label: "Локальный установщик",
      ready: existsSync(installLocal),
    },
    {
      id: "package",
      label: "package.zip (полная установка)",
      ready: existsSync(packageZip),
      detail: existsSync(packageZip) ? fileSizeMb(packageZip) : undefined,
    },
    {
      id: "ota",
      label: "update.zip (OTA-обновления)",
      ready: existsSync(updateZip),
      detail: existsSync(updateZip) ? fileSizeMb(updateZip) : undefined,
    },
    {
      id: "games",
      label: "Папка games/ для .exe",
      ready: existsSync(games),
    },
  ];

  const packageReady =
    components.find((c) => c.id === "agent")!.ready &&
    components.find((c) => c.id === "ui")!.ready &&
    (components.find((c) => c.id === "package")!.ready ||
      (components.find((c) => c.id === "node")!.ready &&
        components.find((c) => c.id === "installer")!.ready));

  const credsOk = deployCredentialsOk();
  const runtime = getDeployRuntime();
  const transportReady =
    runtime.transport === "winrm" ? Boolean(runtime.powerShell) : runtime.sshClient;

  return {
    packageReady,
    packageDir: process.env.DEPLOY_PACKAGE_DIR || "data/deploy/current",
    serverPublicUrl: config.serverPublicUrl || null,
    softwareVersion: meta.softwareVersion !== "0" ? meta.softwareVersion : null,
    deployCredentialsConfigured: credsOk,
    deployTransport: runtime.transport,
    deployRuntimeMessage: runtime.message,
    components,    willInstall: [
      "Агент Омскэкран (автозапуск при старте Windows)",
      "UI киоска на http://127.0.0.1:47820",
      "Portable Node.js (если есть в пакете)",
      "Конфиг kiosk.json с адресом сервера",
      "Задача Edge kiosk (полноэкранный режим)",
      "Папка games/ для локальных игр",
      "Отключение сна монитора (AC)",
    ],
    prerequisites: [
      {
        id: "package",
        label: "Пакет собран (pnpm pack:kiosk-deploy)",
        ok: packageReady,
        hint: packageReady ? undefined : "Соберите пакет на сервере",
      },
      {
        id: "serverUrl",
        label: "SERVER_PUBLIC_URL",
        ok: Boolean(config.serverPublicUrl),
        hint: config.serverPublicUrl || "Задайте в .env, например http://10.176.81.220:8080",
      },
      {
        id: "creds",
        label: "DEPLOY_USER + пароль или SSH-ключ",
        ok: credsOk,
        hint: credsOk ? config.deployUser : "Учётная запись администратора на Windows-киосках",
      },
      {
        id: "transport",
        label: `Транспорт деплоя (${runtime.transport})`,
        ok: transportReady,
        hint: transportReady
          ? runtime.message || undefined
          : runtime.transport === "winrm"
            ? "На Debian: apt install powershell + PSWSMan, или DEPLOY_TRANSPORT=ssh"
            : "apt install openssh-client sshpass; на киосках — OpenSSH Server",
      },
      {
        id: "edge",
        label: "Microsoft Edge на киоске",
        ok: true,
        hint: "Должен быть установлен на целевом ПК (не копируется пакетом)",
      },
      {
        id: "session",
        label: "Интерактивный вход на киоске",
        ok: true,
        hint: "Для полноэкранного Edge нужна сессия пользователя",
      },
    ],
  };
}
