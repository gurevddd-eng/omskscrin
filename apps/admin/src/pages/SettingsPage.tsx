import { FormEvent, useEffect, useState } from "react";
import type { DeploySettingsDto, KioskDto, SiteSettingsDto } from "@stella/shared";
import { useAuth } from "../auth";
import { api } from "../api";
import { PageShell } from "../components/ui/PageShell";
import { Alert } from "../components/ui/Alert";
import { Card } from "../components/ui/Card";

type SystemNetwork = {
  runtime: {
    host: string;
    port: number;
    bindUrl: string;
    monitorStreamPath: string;
    effectiveServerPublicUrl: string;
    envServerPublicUrl: string;
  };
  endpoints: Record<string, string>;
  note: string;
};

type Tab = "behavior" | "network" | "windows";

export function SettingsPage() {
  const { canEdit, isAdmin } = useAuth();
  const [tab, setTab] = useState<Tab>("behavior");
  const [blockKeyboard, setBlockKeyboard] = useState(true);
  const [softwareEnabled, setSoftwareEnabled] = useState(true);
  const [themeMode, setThemeMode] = useState<"manual" | "light" | "dark" | "schedule">("manual");
  const [themeDarkFrom, setThemeDarkFrom] = useState("20:00");
  const [themeDarkTo, setThemeDarkTo] = useState("08:00");
  const [themeNow, setThemeNow] = useState<"light" | "dark" | null>(null);
  const [settingsVersion, setSettingsVersion] = useState("—");
  const [serverPublicUrl, setServerPublicUrl] = useState("");
  const [defaultHealthPort, setDefaultHealthPort] = useState(47821);
  const [defaultUiPort, setDefaultUiPort] = useState(47820);
  const [corsOrigins, setCorsOrigins] = useState("");
  const [probeIntervalMs, setProbeIntervalMs] = useState(30000);
  const [probeTimeoutMs, setProbeTimeoutMs] = useState(2500);
  const [effectiveServerUrl, setEffectiveServerUrl] = useState("");
  const [systemNetwork, setSystemNetwork] = useState<SystemNetwork | null>(null);
  const [deployUser, setDeployUser] = useState("");
  const [deployPassword, setDeployPassword] = useState("");
  const [deployPasswordSet, setDeployPasswordSet] = useState(false);
  const [domainSuffix, setDomainSuffix] = useState("udhb.local");
  const [deployTransport, setDeployTransport] = useState<"auto" | "ssh" | "winrm">("winrm");
  const [credentialsOk, setCredentialsOk] = useState(false);
  const [deploySource, setDeploySource] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [networkBusy, setNetworkBusy] = useState(false);
  const [deployBusy, setDeployBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [networkDirty, setNetworkDirty] = useState(false);
  const [deployDirty, setDeployDirty] = useState(false);
  const [savedHint, setSavedHint] = useState("");
  const [networkHint, setNetworkHint] = useState("");
  const [deployHint, setDeployHint] = useState("");

  async function loadDeploy() {
    if (!isAdmin) return;
    const d = await api<DeploySettingsDto>("/api/settings/deploy");
    setDeployUser(d.deployUser);
    setDeployPassword("");
    setDeployPasswordSet(d.deployPasswordSet);
    setDomainSuffix(d.domainSuffix || "udhb.local");
    setDeployTransport(d.deployTransport === "ssh" || d.deployTransport === "auto" ? d.deployTransport : "winrm");
    setCredentialsOk(d.credentialsOk);
    setDeploySource(d.source);
    setDeployDirty(false);
  }

  async function load() {
    const [data, sys] = await Promise.all([
      api<SiteSettingsDto>("/api/settings"),
      api<SystemNetwork>("/api/system/network"),
    ]);
    setBlockKeyboard(data.blockKeyboard);
    setSoftwareEnabled(data.softwareEnabled);
    setThemeMode(data.themeMode || "manual");
    setThemeDarkFrom(data.themeDarkFrom || "20:00");
    setThemeDarkTo(data.themeDarkTo || "08:00");
    setThemeNow(data.theme ?? null);
    setSettingsVersion(data.settingsVersion);
    setServerPublicUrl(data.network.serverPublicUrl);
    setEffectiveServerUrl(data.network.effectiveServerPublicUrl);
    setDefaultHealthPort(data.network.defaultHealthPort);
    setDefaultUiPort(data.network.defaultUiPort);
    setCorsOrigins(data.network.corsOrigins);
    setProbeIntervalMs(data.network.probeIntervalMs);
    setProbeTimeoutMs(data.network.probeTimeoutMs);
    setSystemNetwork(sys);
    setDirty(false);
    setNetworkDirty(false);
    await loadDeploy();
  }

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Ошибка загрузки"));
  }, [isAdmin]);

  async function applyToAllKiosks(enabled: boolean) {
    const list = await api<KioskDto[]>("/api/kiosks");
    const results = await Promise.allSettled(
      list.map((k) => api(`/api/kiosks/${k.id}/${enabled ? "start" : "stop"}`, { method: "POST" }))
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    return { ok: results.length - failed, failed, total: results.length };
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!canEdit) return;
    setBusy(true);
    setError("");
    setSavedHint("");
    try {
      const saved = await api<SiteSettingsDto>("/api/settings", {
        method: "PUT",
        json: { blockKeyboard, softwareEnabled, themeMode, themeDarkFrom, themeDarkTo },
      });
      setBlockKeyboard(saved.blockKeyboard);
      setSoftwareEnabled(saved.softwareEnabled);
      setThemeMode(saved.themeMode || "manual");
      setThemeDarkFrom(saved.themeDarkFrom || "20:00");
      setThemeDarkTo(saved.themeDarkTo || "08:00");
      setThemeNow(saved.theme ?? null);
      setSettingsVersion(saved.settingsVersion);
      setDirty(false);

      let hint = "Сохранено — киоски подхватят при синхронизации";
      try {
        const r = await applyToAllKiosks(saved.softwareEnabled);
        if (r.total === 0) hint = "Сохранено";
        else if (saved.softwareEnabled) hint = `Сохранено. Запуск: ${r.ok}/${r.total}`;
        else hint = `Сохранено. Остановлено на ${r.ok} киоск(ах)`;
      } catch {
        hint = "Сохранено (удалённые команды не выполнены)";
      }
      setSavedHint(hint);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  }

  async function onSaveNetwork(e: FormEvent) {
    e.preventDefault();
    if (!canEdit) return;
    setNetworkBusy(true);
    setError("");
    setNetworkHint("");
    try {
      const saved = await api<SiteSettingsDto>("/api/settings/network", {
        method: "PUT",
        json: {
          serverPublicUrl: serverPublicUrl.trim(),
          defaultHealthPort,
          defaultUiPort,
          corsOrigins,
          probeIntervalMs,
          probeTimeoutMs,
        },
      });
      setServerPublicUrl(saved.network.serverPublicUrl);
      setEffectiveServerUrl(saved.network.effectiveServerPublicUrl);
      setDefaultHealthPort(saved.network.defaultHealthPort);
      setDefaultUiPort(saved.network.defaultUiPort);
      setCorsOrigins(saved.network.corsOrigins);
      setProbeIntervalMs(saved.network.probeIntervalMs);
      setProbeTimeoutMs(saved.network.probeTimeoutMs);
      setNetworkDirty(false);
      setNetworkHint("Сохранено. CORS — после перезапуска сервера.");
      setSystemNetwork(await api<SystemNetwork>("/api/system/network"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения сети");
    } finally {
      setNetworkBusy(false);
    }
  }

  async function onSaveDeploy(e: FormEvent) {
    e.preventDefault();
    if (!isAdmin) return;
    setDeployBusy(true);
    setError("");
    setDeployHint("");
    try {
      const json: Record<string, string> = {
        deployUser: deployUser.trim(),
        domainSuffix: domainSuffix.trim().replace(/^\./, "") || "udhb.local",
        deployTransport,
      };
      if (deployPassword.trim()) {
        json.deployPassword = deployPassword;
      }
      const saved = await api<DeploySettingsDto>("/api/settings/deploy", {
        method: "PUT",
        json,
      });
      setDeployUser(saved.deployUser);
      setDeployPassword("");
      setDeployPasswordSet(saved.deployPasswordSet);
      setDomainSuffix(saved.domainSuffix);
      setDeployTransport(saved.deployTransport);
      setCredentialsOk(saved.credentialsOk);
      setDeploySource(saved.source);
      setDeployDirty(false);
      setDeployHint(
        saved.credentialsOk
          ? "Сохранено. Debian подключается к ПК по WinRM (порт 5985)."
          : "Сохранено, но учётка неполная — укажите пароль."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения учётки");
    } finally {
      setDeployBusy(false);
    }
  }

  return (
    <PageShell
      section="Система"
      title="Настройки"
      description="Поведение киосков, сеть Debian-сервера и доменная учётка для WinRM."
      banner={
        <>
          {error ? <Alert tone="error">{error}</Alert> : null}
          {savedHint ? <Alert tone="success">{savedHint}</Alert> : null}
          {networkHint ? <Alert tone="success">{networkHint}</Alert> : null}
          {deployHint ? <Alert tone="success">{deployHint}</Alert> : null}
        </>
      }
    >
      <div className="cx-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className={`cx-tab${tab === "behavior" ? " is-active" : ""}`}
          onClick={() => setTab("behavior")}
        >
          Поведение киосков
        </button>
        <button
          type="button"
          role="tab"
          className={`cx-tab${tab === "network" ? " is-active" : ""}`}
          onClick={() => setTab("network")}
        >
          Сеть и порты
        </button>
        {isAdmin ? (
          <button
            type="button"
            role="tab"
            className={`cx-tab${tab === "windows" ? " is-active" : ""}`}
            onClick={() => setTab("windows")}
          >
            Windows / домен
          </button>
        ) : null}
      </div>

      {tab === "behavior" ? (
        <Card
          title="Поведение"
          subtitle={`Версия настроек: ${settingsVersion}`}
          actions={
            canEdit ? (
              <button type="submit" form="settings-behavior" className="btn" disabled={busy || !dirty}>
                {busy ? "Сохранение…" : "Сохранить"}
              </button>
            ) : null
          }
        >
          <form id="settings-behavior" onSubmit={onSave}>
            <div className="cx-setting">
              <div>
                <p className="cx-setting__title">Софт киосков</p>
                <p className="cx-setting__hint">
                  Глобально включает или выключает агент и Edge на всех ПК. При выключении софт не
                  поднимется после перезагрузки, пока не включите снова.
                </p>
              </div>
              <label className={`settings-switch ${!canEdit ? "is-disabled" : ""}`}>
                <input
                  type="checkbox"
                  checked={softwareEnabled}
                  disabled={!canEdit || busy}
                  onChange={(e) => {
                    setSoftwareEnabled(e.target.checked);
                    setDirty(true);
                    setSavedHint("");
                  }}
                />
                <span className="settings-switch__ui" aria-hidden />
                <span className="settings-switch__label">{softwareEnabled ? "Вкл" : "Выкл"}</span>
              </label>
            </div>

            <div className="cx-setting">
              <div>
                <p className="cx-setting__title">Блокировка клавиатуры</p>
                <p className="cx-setting__hint">
                  Lockdown Windows: hotkeys, политики меню, Keyboard Filter (Ctrl+Alt+Del на
                  поддерживаемых редакциях). Снять вручную — кнопка на карточке киоска.
                </p>
              </div>
              <label className={`settings-switch ${!canEdit ? "is-disabled" : ""}`}>
                <input
                  type="checkbox"
                  checked={blockKeyboard}
                  disabled={!canEdit || busy}
                  onChange={(e) => {
                    setBlockKeyboard(e.target.checked);
                    setDirty(true);
                    setSavedHint("");
                  }}
                />
                <span className="settings-switch__ui" aria-hidden />
                <span className="settings-switch__label">{blockKeyboard ? "Вкл" : "Выкл"}</span>
              </label>
            </div>

            <div className="cx-setting cx-setting--stack">
              <div>
                <p className="cx-setting__title">Тема на киосках</p>
                <p className="cx-setting__hint">
                  Расписание по времени сервера (сейчас:{" "}
                  {themeMode === "manual"
                    ? "на киоске вручную"
                    : themeNow === "dark"
                      ? "тёмная"
                      : themeNow === "light"
                        ? "светлая"
                        : "—"}
                  ). При режиме «По расписанию» переключатель на киоске скрыт.
                </p>
              </div>
              <div className="settings-theme">
                <label>
                  Режим
                  <select
                    value={themeMode}
                    disabled={!canEdit || busy}
                    onChange={(e) => {
                      setThemeMode(e.target.value as typeof themeMode);
                      setDirty(true);
                      setSavedHint("");
                    }}
                  >
                    <option value="manual">Вручную на киоске</option>
                    <option value="light">Всегда светлая</option>
                    <option value="dark">Всегда тёмная</option>
                    <option value="schedule">По расписанию</option>
                  </select>
                </label>
                <label>
                  Тёмная с
                  <input
                    type="time"
                    value={themeDarkFrom}
                    disabled={!canEdit || busy || themeMode !== "schedule"}
                    onChange={(e) => {
                      setThemeDarkFrom(e.target.value || "20:00");
                      setDirty(true);
                      setSavedHint("");
                    }}
                  />
                </label>
                <label>
                  до
                  <input
                    type="time"
                    value={themeDarkTo}
                    disabled={!canEdit || busy || themeMode !== "schedule"}
                    onChange={(e) => {
                      setThemeDarkTo(e.target.value || "08:00");
                      setDirty(true);
                      setSavedHint("");
                    }}
                  />
                </label>
              </div>
            </div>
          </form>
        </Card>
      ) : null}

      {tab === "network" ? (
        <>
          {systemNetwork ? (
            <Card title="Runtime сервера" subtitle="Значения из .env и текущего процесса">
              <dl className="network-dl">
                <div>
                  <dt>Слушает</dt>
                  <dd>
                    {systemNetwork.runtime.host}:{systemNetwork.runtime.port} →{" "}
                    <code>{systemNetwork.runtime.bindUrl}</code>
                  </dd>
                </div>
                <div>
                  <dt>SSE мониторинг</dt>
                  <dd>
                    <code>{systemNetwork.runtime.monitorStreamPath}</code>
                  </dd>
                </div>
                <div>
                  <dt>URL для kiosk.json</dt>
                  <dd>
                    <code>{effectiveServerUrl || systemNetwork.runtime.effectiveServerPublicUrl}</code>
                  </dd>
                </div>
                <div>
                  <dt>WinRM на киосках</dt>
                  <dd>{systemNetwork.endpoints.winRm}</dd>
                </div>
              </dl>
              <p className="cx-setting__hint">{systemNetwork.note}</p>
            </Card>
          ) : null}

          <Card
            title="Параметры сети"
            subtitle="Применяются к новым установкам и push-config"
            actions={
              canEdit ? (
                <button type="submit" form="settings-network" className="btn" disabled={networkBusy || !networkDirty}>
                  {networkBusy ? "Сохранение…" : "Сохранить сеть"}
                </button>
              ) : null
            }
          >
            <form id="settings-network" className="stack" onSubmit={onSaveNetwork}>
              <label>
                Публичный URL сервера
                <input
                  type="url"
                  value={serverPublicUrl}
                  placeholder={systemNetwork?.runtime.envServerPublicUrl || "http://10.x.x.x:8080"}
                  disabled={!canEdit || networkBusy}
                  onChange={(e) => {
                    setServerPublicUrl(e.target.value);
                    setNetworkDirty(true);
                    setNetworkHint("");
                  }}
                />
              </label>

              <div className="cx-field-grid cx-field-grid--3">
                <label>
                  Health-порт
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={defaultHealthPort}
                    disabled={!canEdit || networkBusy}
                    onChange={(e) => {
                      setDefaultHealthPort(Number(e.target.value));
                      setNetworkDirty(true);
                    }}
                  />
                </label>
                <label>
                  UI-порт (localhost)
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={defaultUiPort}
                    disabled={!canEdit || networkBusy}
                    onChange={(e) => {
                      setDefaultUiPort(Number(e.target.value));
                      setNetworkDirty(true);
                    }}
                  />
                </label>
                <label>
                  Интервал опроса (мс)
                  <input
                    type="number"
                    min={5000}
                    max={600000}
                    step={1000}
                    value={probeIntervalMs}
                    disabled={!canEdit || networkBusy}
                    onChange={(e) => {
                      setProbeIntervalMs(Number(e.target.value));
                      setNetworkDirty(true);
                    }}
                  />
                </label>
              </div>

              <div className="cx-field-grid">
                <label>
                  Таймаут health (мс)
                  <input
                    type="number"
                    min={500}
                    max={60000}
                    value={probeTimeoutMs}
                    disabled={!canEdit || networkBusy}
                    onChange={(e) => {
                      setProbeTimeoutMs(Number(e.target.value));
                      setNetworkDirty(true);
                    }}
                  />
                </label>
                <label>
                  CORS (через запятую)
                  <textarea
                    rows={2}
                    value={corsOrigins}
                    disabled={!canEdit || networkBusy}
                    onChange={(e) => {
                      setCorsOrigins(e.target.value);
                      setNetworkDirty(true);
                    }}
                  />
                </label>
              </div>
            </form>
          </Card>
        </>
      ) : null}

      {tab === "windows" && isAdmin ? (
        <Card
          title="Доменная учётка"
          subtitle={
            credentialsOk
              ? `Готово · источник: ${deploySource}`
              : "Нужна для установки и управления киосками с Debian"
          }
          actions={
            <button type="submit" form="settings-deploy" className="btn" disabled={deployBusy || !deployDirty}>
              {deployBusy ? "Сохранение…" : "Сохранить"}
            </button>
          }
        >
          <form id="settings-deploy" className="stack" onSubmit={onSaveDeploy}>
            <p className="cx-setting__hint">
              Сервер на Debian подключается к Windows по <strong>WinRM</strong> (TCP 5985) через{" "}
              <code>pwsh</code> и модуль PSWSMan. OpenSSH на киосках не нужен. Учётка должна быть
              локальным администратором на целевых ПК (или в группе Domain Admins / делегированных
              прав).
            </p>

            <label>
              Логин (предпочтительно UPN)
              <input
                value={deployUser}
                placeholder="user@udhb.local"
                autoComplete="off"
                disabled={deployBusy}
                onChange={(e) => {
                  setDeployUser(e.target.value);
                  setDeployDirty(true);
                  setDeployHint("");
                }}
              />
            </label>

            <label>
              Пароль
              <input
                type="password"
                value={deployPassword}
                placeholder={deployPasswordSet ? "•••••••• (оставьте пустым, чтобы не менять)" : "пароль доменной учётки"}
                autoComplete="new-password"
                disabled={deployBusy}
                onChange={(e) => {
                  setDeployPassword(e.target.value);
                  setDeployDirty(true);
                  setDeployHint("");
                }}
              />
            </label>

            <div className="cx-field-grid">
              <label>
                DNS-суффикс домена
                <input
                  value={domainSuffix}
                  placeholder="udhb.local"
                  disabled={deployBusy}
                  onChange={(e) => {
                    setDomainSuffix(e.target.value);
                    setDeployDirty(true);
                  }}
                />
              </label>
              <label>
                Транспорт
                <select
                  value={deployTransport}
                  disabled={deployBusy}
                  onChange={(e) => {
                    setDeployTransport(e.target.value as "auto" | "ssh" | "winrm");
                    setDeployDirty(true);
                  }}
                >
                  <option value="winrm">WinRM (рекомендуется)</option>
                  <option value="auto">Авто</option>
                  <option value="ssh">SSH (только если на ПК есть OpenSSH)</option>
                </select>
              </label>
            </div>

            <p className="cx-setting__hint">
              Короткое имя <code>itpc07</code> при добавлении киоска станет{" "}
              <code>itpc07.{domainSuffix || "udhb.local"}</code>. На Debian должны быть установлены
              PowerShell 7 и PSWSMan.
            </p>
          </form>
        </Card>
      ) : null}
    </PageShell>
  );
}
