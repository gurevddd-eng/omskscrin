import { Card } from "../ui/Card";

export type DeployStatus = {
  packageReady: boolean;
  packageDir: string;
  serverPublicUrl: string | null;
  softwareVersion: string | null;
  deployCredentialsConfigured: boolean;
  deployTransport?: string;
  deployRuntimeMessage?: string;
  components: { id: string; label: string; ready: boolean; detail?: string }[];
  willInstall: string[];
  prerequisites: { id: string; label: string; ok: boolean; hint?: string }[];
};

function transportLabel(t?: string) {
  if (t === "ssh") return "SSH";
  if (t === "winrm") return "WinRM";
  return "Авто";
}

export function DeployStatusPanel({ deploy }: { deploy: DeployStatus }) {
  const transport = deploy.deployTransport || "auto";
  const prereqOk = deploy.prerequisites.filter((p) => p.ok).length;

  return (
    <Card
      className={`kx-deploy ${deploy.packageReady ? "kx-deploy--ok" : "kx-deploy--warn"}`}
      padding="none"
    >
      <div className="kx-deploy__inner">
        <div className="kx-deploy__lead">
          <span className={`kx-deploy__icon ${deploy.packageReady ? "ok" : "warn"}`} aria-hidden>
            {deploy.packageReady ? "✓" : "!"}
          </span>
          <div>
            <p className="kx-deploy__title">
              {deploy.packageReady ? "Пакет развёртывания готов" : "Нужна сборка пакета на сервере"}
            </p>
            <p className="kx-deploy__meta">
              {deploy.softwareVersion ? `v${deploy.softwareVersion}` : "версия не определена"}
              {deploy.serverPublicUrl ? ` · ${deploy.serverPublicUrl}` : ""}
            </p>
          </div>
        </div>

        <ul className="kx-deploy__checks">
          <li className={deploy.packageReady ? "ok" : "warn"}>
            <span>package.zip</span>
            <small>{deploy.packageReady ? "найден" : "нет"}</small>
          </li>
          <li className={deploy.deployCredentialsConfigured ? "ok" : "warn"}>
            <span>DEPLOY_USER</span>
            <small>{deploy.deployCredentialsConfigured ? "настроен" : "не задан"}</small>
          </li>
          <li className="neutral">
            <span>{transportLabel(transport)}</span>
            <small title={deploy.deployRuntimeMessage}>транспорт</small>
          </li>
          <li className={prereqOk === deploy.prerequisites.length ? "ok" : "warn"}>
            <span>Проверки</span>
            <small>
              {prereqOk}/{deploy.prerequisites.length}
            </small>
          </li>
        </ul>
      </div>

      {!deploy.packageReady ? (
        <p className="kx-deploy__hint">
          На Debian-сервере: <code>pnpm pack:kiosk-deploy</code>
          {transport === "ssh" ? " · на киосках включите OpenSSH Server" : " · или задайте DEPLOY_TRANSPORT=ssh"}
        </p>
      ) : null}
    </Card>
  );
}
