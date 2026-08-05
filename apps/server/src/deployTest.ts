import { getEffectiveDeploy, expandHostname, deployCredentialsConfigured } from "./deployCredentials.js";
import {
  isLocalKiosk,
  resolvePowerShell,
  resolveTransport,
  runDeployScript,
  summarizeDeployOutput,
} from "./remoteDeploy.js";

export async function testWindowsHostConnection(rawHostname: string): Promise<{
  ok: boolean;
  hostname: string;
  transport: "winrm" | "ssh" | "local";
  message: string;
  detail?: string;
}> {
  const deploy = getEffectiveDeploy();
  const hostname = expandHostname(rawHostname, deploy.domainSuffix);
  if (!hostname) {
    return { ok: false, hostname: "", transport: "winrm", message: "Укажите имя Windows-ПК" };
  }
  if (isLocalKiosk(hostname)) {
    return { ok: true, hostname, transport: "local", message: "Локальный хост — удалённое подключение не нужно" };
  }
  if (!deployCredentialsConfigured(deploy)) {
    return {
      ok: false,
      hostname,
      transport: resolveTransport(),
      message: "Не задана доменная учётка",
      detail: "Настройки → Windows: user@udhb.local и пароль",
    };
  }

  const transport = resolveTransport();

  if (transport === "winrm") {
    if (!resolvePowerShell()) {
      return {
        ok: false,
        hostname,
        transport,
        message: "На Debian нет pwsh",
        detail: "apt install powershell + Install-Module -Name PSWSMan; Install-WSMan",
      };
    }

    const result = await runDeployScript(
      "remote-test-connection",
      [
        "-Hostname",
        hostname,
        "-DeployUser",
        deploy.user,
        "-DeployPassword",
        deploy.password,
      ],
      { timeoutMs: 35_000 }
    );

    const text = `${result.stdout}\n${result.stderr}`;
    if (result.code === 0 && /WINRM_OK:/i.test(text)) {
      const name = /WINRM_OK:(\S+)/i.exec(text)?.[1] || hostname;
      return {
        ok: true,
        hostname,
        transport,
        message: `WinRM OK · ${name}`,
        detail: `Учётка ${deploy.user} (порт 5985)`,
      };
    }

    const hint = summarizeDeployOutput(text, result.code);
    const friendly =
      /Access is denied|AccessDenied|unauthorized/i.test(text)
        ? "Неверный логин/пароль или нет прав администратора на ПК"
        : /WinRM cannot process|cannot find the computer|Name or service not known|No such host/i.test(text)
          ? "ПК не резолвится в DNS — укажите FQDN (pc.udhb.local) или проверьте DNS на Debian"
          : /timed out|timeout|Unable to connect|connection refused|network path/i.test(text)
            ? "WinRM недоступен: firewall :5985, Enable-PSRemoting на ПК, TrustedHosts"
            : hint;

    return { ok: false, hostname, transport, message: "WinRM не удалось", detail: friendly };
  }

  // SSH only if явно выбран в настройках (на киосках без OpenSSH не используйте)
  return {
    ok: false,
    hostname,
    transport,
    message: "Транспорт SSH",
    detail:
      "На Windows-киосках нет SSH. В Настройки → Windows выберите WinRM (нужен pwsh на Debian).",
  };
}
