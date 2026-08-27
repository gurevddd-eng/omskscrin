import { Card } from "../ui/Card";

export type DeployStatus = {
  packageReady: boolean;
  packageDir: string;
  serverPublicUrl: string | null;
  softwareVersion: string | null;
  deployCredentialsConfigured: boolean;
  deployTransport?: string;
  deployRuntimeMessage?: string;
  domainSuffix?: string;
  components: { id: string; label: string; ready: boolean; detail?: string }[];
  willInstall: string[];
  prerequisites: { id: string; label: string; ok: boolean; hint?: string }[];
};

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

export function DeployStatusPanel({ deploy }: { deploy: DeployStatus }) {
  const transport = deploy.deployTransport || "auto";
  const prereqOk = deploy.prerequisites.filter((p) => p.ok).length;
  const prereqTotal = deploy.prerequisites.length;
  const allPrereqOk = prereqTotal > 0 && prereqOk === prereqTotal;
  const host = hostFromUrl(deploy.serverPublicUrl);
  const readyComponents = deploy.components.filter((c) => c.ready).length;

  const checks = [
    {
      key: "package",
      label: "Пакет установки",
      value: deploy.packageReady ? "Готов" : "Нужна сборка",
      ok: deploy.packageReady,
      hint: deploy.packageReady
        ? `${readyComponents}/${deploy.components.length} компонентов`
        : "pnpm pack:kiosk-deploy",
    },
    {
      key: "creds",
      label: "Учётная запись",
      value: deploy.deployCredentialsConfigured ? "Задана" : "Не задана",
      ok: deploy.deployCredentialsConfigured,
      hint: deploy.deployCredentialsConfigured ? "DEPLOY_USER" : "Проверьте .env на сервере",
    },
    {
      key: "transport",
      label: "Транспорт",
      value: transportLabel(transport),
      ok: true,
      hint: deploy.deployRuntimeMessage || "Подключение к киоскам",
      tone: "neutral" as const,
    },
    {
      key: "prereq",
      label: "Проверки",
      value: prereqTotal ? `${prereqOk} из ${prereqTotal}` : "—",
      ok: allPrereqOk,
      hint: allPrereqOk ? "Всё в порядке" : "Есть замечания",
    },
  ];

  return (
    <Card
      className={`kx-deploy ${deploy.packageReady ? "kx-deploy--ok" : "kx-deploy--warn"}`}
      padding="none"
    >
      <div className="kx-deploy__shell">
        <header className="kx-deploy__head">
          <div className="kx-deploy__identity">
            <p className="kx-deploy__eyebrow">Развёртывание киосков</p>
            <div className="kx-deploy__title-row">
              <h2 className="kx-deploy__title">
                {deploy.packageReady ? "Пакет готов к установке и OTA" : "Соберите пакет на сервере"}
              </h2>
              <span
                className={`kx-deploy__badge ${deploy.packageReady ? "is-ok" : "is-warn"}`}
              >
                {deploy.packageReady ? "Готов" : "Ожидает сборки"}
              </span>
            </div>
            <div className="kx-deploy__meta-row">
              <span className="kx-deploy__version" title="softwareVersion пакета">
                {deploy.softwareVersion ? `v${deploy.softwareVersion}` : "версия неизвестна"}
              </span>
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
            </div>
          </div>
        </header>

        <ul className="kx-deploy__grid" aria-label="Состояние развёртывания">
          {checks.map((c) => (
            <li
              key={c.key}
              className={`kx-deploy__cell ${
                "tone" in c && c.tone === "neutral" ? "is-neutral" : c.ok ? "is-ok" : "is-warn"
              }`}
            >
              <span className="kx-deploy__cell-label">{c.label}</span>
              <strong className="kx-deploy__cell-value">{c.value}</strong>
              <span className="kx-deploy__cell-hint" title={c.hint}>
                {c.hint}
              </span>
            </li>
          ))}
        </ul>

        {!deploy.packageReady ? (
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
    </Card>
  );
}
