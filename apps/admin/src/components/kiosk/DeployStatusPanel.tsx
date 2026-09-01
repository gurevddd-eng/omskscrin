import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "../ui/Card";
import { getToken } from "../../api";

export type DeployStatus = {
  packageReady: boolean;
  packageDir: string;
  serverPublicUrl: string | null;
  softwareVersion: string | null;
  appVersion?: string;
  builtAt?: string | null;
  hasPackageZip?: boolean;
  hasUpdateZip?: boolean;
  packageZipSize?: string | null;
  updateZipSize?: string | null;
  deployCredentialsConfigured: boolean;
  deployTransport?: string;
  deployRuntimeMessage?: string;
  domainSuffix?: string;
  components: { id: string; label: string; ready: boolean; detail?: string }[];
  willInstall: string[];
  prerequisites: { id: string; label: string; ok: boolean; hint?: string }[];
};

type FleetSnapshot = {
  total: number;
  online: number;
  otaOutdated: number;
  otaPending: number;
};

type Props = {
  deploy: DeployStatus;
  onRefresh?: () => void | Promise<void>;
  refreshing?: boolean;
  fleet?: FleetSnapshot | null;
};

type DetailTab = "components" | "prereq" | "install";

function transportLabel(t?: string) {
  if (t === "ssh") return "SSH";
  if (t === "winrm") return "WinRM";
  return "Авто";
}

function hostFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host || url;
  } catch {
    return url.replace(/^https?:\/\//i, "").replace(/\/$/, "") || null;
  }
}

function formatBuiltAt(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function downloadDeployZip(path: string, filename: string) {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(path, { headers });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `Ошибка ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function DeployStatusPanel({ deploy, onRefresh, refreshing, fleet }: Props) {
  const transport = deploy.deployTransport || "auto";
  const prereqOk = deploy.prerequisites.filter((p) => p.ok).length;
  const prereqTotal = deploy.prerequisites.length;
  const allPrereqOk = prereqTotal > 0 && prereqOk === prereqTotal;
  const readyComponents = deploy.components.filter((c) => c.ready).length;
  const missingComponents = deploy.components.filter((c) => !c.ready);
  const failedPrereq = deploy.prerequisites.filter((p) => !p.ok);
  const host = hostFromUrl(deploy.serverPublicUrl);
  const builtLabel = formatBuiltAt(deploy.builtAt);
  const hasPackageZip = deploy.hasPackageZip ?? deploy.components.some((c) => c.id === "package" && c.ready);
  const hasUpdateZip = deploy.hasUpdateZip ?? deploy.components.some((c) => c.id === "ota" && c.ready);

  const pipelineReady =
    deploy.packageReady &&
    deploy.deployCredentialsConfigured &&
    Boolean(deploy.serverPublicUrl) &&
    (deploy.prerequisites.find((p) => p.id === "transport")?.ok ?? true);

  const issues = useMemo(() => {
    const list: string[] = [];
    if (!deploy.packageReady) list.push("Соберите пакет: pnpm pack:kiosk-deploy");
    if (!deploy.serverPublicUrl) list.push("Задайте публичный URL сервера в настройках сети");
    if (!deploy.deployCredentialsConfigured) list.push("Укажите доменную учётку WinRM");
    const transportPrereq = deploy.prerequisites.find((p) => p.id === "transport");
    if (transportPrereq && !transportPrereq.ok) {
      list.push(transportPrereq.hint || "Проверьте транспорт до киосков");
    }
    return list;
  }, [deploy]);

  const defaultTab: DetailTab = !deploy.packageReady
    ? "components"
    : failedPrereq.length
      ? "prereq"
      : "install";

  const [open, setOpen] = useState(!pipelineReady || Boolean(issues.length));
  const [tab, setTab] = useState<DetailTab>(defaultTab);
  const [dlBusy, setDlBusy] = useState<"package" | "update" | null>(null);
  const [dlError, setDlError] = useState("");
  const [copied, setCopied] = useState(false);

  const checks = [
    {
      key: "package",
      label: "Пакет",
      value: deploy.packageReady ? "Готов" : "Нужна сборка",
      ok: deploy.packageReady,
      hint: deploy.packageReady
        ? `${readyComponents}/${deploy.components.length} · ${deploy.packageZipSize || deploy.updateZipSize || "ok"}`
        : "pnpm pack:kiosk-deploy",
    },
    {
      key: "creds",
      label: "Учётка",
      value: deploy.deployCredentialsConfigured ? "Задана" : "Не задана",
      ok: deploy.deployCredentialsConfigured,
      hint: deploy.deployCredentialsConfigured
        ? `домен · ${deploy.domainSuffix || "udhb.local"}`
        : "Настройки → Windows",
      href: !deploy.deployCredentialsConfigured ? "/system/settings" : undefined,
    },
    {
      key: "transport",
      label: "Транспорт",
      value: transportLabel(transport),
      ok: deploy.prerequisites.find((p) => p.id === "transport")?.ok ?? true,
      hint: deploy.deployRuntimeMessage || "Подключение к киоскам",
      tone: "neutral" as const,
    },
    {
      key: "prereq",
      label: "Проверки",
      value: prereqTotal ? `${prereqOk}/${prereqTotal}` : "—",
      ok: allPrereqOk,
      hint: allPrereqOk ? "Всё готово к установке" : `${failedPrereq.length} замечаний`,
    },
  ];

  async function onDownload(kind: "package" | "update") {
    setDlError("");
    setDlBusy(kind);
    try {
      if (kind === "package") {
        await downloadDeployZip("/api/deploy/package.zip", "stella-kiosk-package.zip");
      } else {
        await downloadDeployZip("/api/deploy/update.zip", "stella-kiosk-update.zip");
      }
    } catch (err) {
      setDlError(err instanceof Error ? err.message : "Не удалось скачать");
    } finally {
      setDlBusy(null);
    }
  }

  async function copyVersion() {
    if (!deploy.softwareVersion) return;
    try {
      await navigator.clipboard.writeText(deploy.softwareVersion);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  }

  return (
    <Card
      className={`kx-deploy ${pipelineReady ? "kx-deploy--ok" : "kx-deploy--warn"}`}
      padding="none"
    >
      <div className="kx-deploy__shell">
        <header className="kx-deploy__head">
          <div className="kx-deploy__identity">
            <p className="kx-deploy__eyebrow">Развёртывание киосков</p>
            <div className="kx-deploy__title-row">
              <h2 className="kx-deploy__title">
                {pipelineReady
                  ? "Готово к установке и OTA"
                  : deploy.packageReady
                    ? "Пакет есть — донастройте доступ"
                    : "Соберите пакет на сервере"}
              </h2>
              <span className={`kx-deploy__badge ${pipelineReady ? "is-ok" : "is-warn"}`}>
                {pipelineReady ? "Готов" : "Требует внимания"}
              </span>
            </div>

            <div className="kx-deploy__meta-row">
              <button
                type="button"
                className="kx-deploy__version"
                title="Скопировать softwareVersion"
                onClick={() => void copyVersion()}
                disabled={!deploy.softwareVersion}
              >
                {deploy.softwareVersion ? `v${deploy.softwareVersion}` : "версия неизвестна"}
                {copied ? <span className="kx-deploy__copied">скопировано</span> : null}
              </button>
              {deploy.appVersion ? (
                <span className="kx-deploy__chip">app {deploy.appVersion}</span>
              ) : null}
              {builtLabel ? (
                <span className="kx-deploy__chip" title={deploy.builtAt || undefined}>
                  сборка {builtLabel}
                </span>
              ) : null}
              {host ? (
                <a
                  className="kx-deploy__host"
                  href={deploy.serverPublicUrl || undefined}
                  target="_blank"
                  rel="noreferrer"
                >
                  {host}
                </a>
              ) : (
                <span className="kx-deploy__host kx-deploy__host--muted">URL сервера не задан</span>
              )}
              {deploy.domainSuffix ? (
                <span className="kx-deploy__chip">DNS · {deploy.domainSuffix}</span>
              ) : null}
            </div>
          </div>

          <div className="kx-deploy__head-actions">
            {onRefresh ? (
              <button
                type="button"
                className="btn ghost"
                disabled={refreshing}
                onClick={() => void onRefresh()}
              >
                {refreshing ? "…" : "Обновить статус"}
              </button>
            ) : null}
            <button
              type="button"
              className="btn ghost"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? "Свернуть" : "Подробнее"}
            </button>
          </div>
        </header>

        <div className="kx-deploy__actions">
          <button
            type="button"
            className="btn secondary"
            disabled={!hasPackageZip || dlBusy !== null}
            onClick={() => void onDownload("package")}
            title={deploy.packageZipSize || undefined}
          >
            {dlBusy === "package"
              ? "Скачивание…"
              : `Пакет установки${deploy.packageZipSize ? ` · ${deploy.packageZipSize}` : ""}`}
          </button>
          <button
            type="button"
            className="btn secondary"
            disabled={!hasUpdateZip || dlBusy !== null}
            onClick={() => void onDownload("update")}
            title={deploy.updateZipSize || undefined}
          >
            {dlBusy === "update"
              ? "Скачивание…"
              : `OTA update.zip${deploy.updateZipSize ? ` · ${deploy.updateZipSize}` : ""}`}
          </button>
          <Link className="btn ghost" to="/system/settings">
            Настройки доступа
          </Link>
          {fleet && fleet.total > 0 ? (
            <span className="kx-deploy__fleet">
              Парк: {fleet.online}/{fleet.total} онлайн
              {fleet.otaOutdated ? ` · ${fleet.otaOutdated} без OTA` : ""}
              {fleet.otaPending ? ` · ${fleet.otaPending} обновляются` : ""}
            </span>
          ) : null}
        </div>

        {dlError ? <p className="kx-deploy__error">{dlError}</p> : null}

        {issues.length > 0 ? (
          <ul className="kx-deploy__issues" aria-label="Что исправить">
            {issues.map((msg) => (
              <li key={msg}>{msg}</li>
            ))}
          </ul>
        ) : null}

        <ul className="kx-deploy__grid" aria-label="Состояние развёртывания">
          {checks.map((c) => (
            <li
              key={c.key}
              className={`kx-deploy__cell ${
                "tone" in c && c.tone === "neutral" && c.ok
                  ? "is-neutral"
                  : c.ok
                    ? "is-ok"
                    : "is-warn"
              }`}
            >
              <span className="kx-deploy__cell-label">{c.label}</span>
              <strong className="kx-deploy__cell-value">{c.value}</strong>
              {"href" in c && c.href ? (
                <Link className="kx-deploy__cell-hint kx-deploy__cell-hint--link" to={c.href}>
                  {c.hint}
                </Link>
              ) : (
                <span className="kx-deploy__cell-hint" title={c.hint}>
                  {c.hint}
                </span>
              )}
            </li>
          ))}
        </ul>

        {open ? (
          <div className="kx-deploy__details">
            <div className="kx-deploy__tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "components"}
                className={`kx-deploy__tab${tab === "components" ? " is-active" : ""}`}
                onClick={() => setTab("components")}
              >
                Компоненты
                <span>{readyComponents}/{deploy.components.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "prereq"}
                className={`kx-deploy__tab${tab === "prereq" ? " is-active" : ""}`}
                onClick={() => setTab("prereq")}
              >
                Условия
                <span>
                  {prereqOk}/{prereqTotal}
                </span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "install"}
                className={`kx-deploy__tab${tab === "install" ? " is-active" : ""}`}
                onClick={() => setTab("install")}
              >
                Что ставится
                <span>{deploy.willInstall.length}</span>
              </button>
            </div>

            {tab === "components" ? (
              <ul className="kx-deploy__checklist">
                {deploy.components.map((c) => (
                  <li key={c.id} className={c.ready ? "is-ok" : "is-warn"}>
                    <span className="kx-deploy__mark" aria-hidden>
                      {c.ready ? "✓" : "!"}
                    </span>
                    <div className="kx-deploy__check-copy">
                      <strong>{c.label}</strong>
                      {c.detail ? <span>{c.detail}</span> : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}

            {tab === "prereq" ? (
              <ul className="kx-deploy__checklist">
                {deploy.prerequisites.map((p) => (
                  <li key={p.id} className={p.ok ? "is-ok" : "is-warn"}>
                    <span className="kx-deploy__mark" aria-hidden>
                      {p.ok ? "✓" : "!"}
                    </span>
                    <div className="kx-deploy__check-copy">
                      <strong>{p.label}</strong>
                      {p.hint ? <span>{p.hint}</span> : null}
                      {!p.ok && (p.id === "creds" || p.id === "serverUrl") ? (
                        <Link to="/system/settings">Открыть настройки</Link>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}

            {tab === "install" ? (
              <div className="kx-deploy__install">
                <p className="kx-deploy__install-lead">
                  При установке на Windows-ПК пакет разложит и настроит:
                </p>
                <ol>
                  {deploy.willInstall.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ol>
                <p className="kx-deploy__path">
                  Каталог пакета: <code>{deploy.packageDir}</code>
                </p>
              </div>
            ) : null}

            {!deploy.packageReady || missingComponents.length > 0 ? (
              <p className="kx-deploy__hint">
                На сервере выполните <code>pnpm pack:kiosk-deploy</code>
                {transport === "winrm"
                  ? " · для WinRM нужен порт 5985 на киосках и pwsh+PSWSMan на Debian"
                  : transport === "ssh"
                    ? " · на киосках должен быть OpenSSH Server"
                    : " · для доменных ПК без SSH обычно используют WinRM"}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
