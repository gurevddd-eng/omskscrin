import { useEffect, useState } from "react";
import type { KioskDto } from "@stella/shared";
import { INSTALL_STATUS_LABEL, PROBE_STATUS_LABEL } from "@stella/shared";
import { KioskLifecyclePanel } from "../../components/kiosk/KioskLifecyclePanel";
import { resolveOtaState } from "../../components/kiosk/KioskOtaStatus";
import { probeBadgeClass } from "../../components/kiosk/status";
import { Card } from "../../components/ui/Card";
import type { ExhibitOpt } from "./kioskHelpers";

export type KioskDetailProps = {
  kiosk: KioskDto;
  exhibits: ExhibitOpt[];
  canEdit: boolean;
  deployReady: boolean;
  probing: boolean;
  installing: boolean;
  cancelling: boolean;
  starting: boolean;
  stopping: boolean;
  savingNetwork: boolean;
  pushingConfig: boolean;
  clearingPolicies: boolean;
  updatingSoftware: boolean;
  binding: boolean;
  removingAdmin: boolean;
  removingFull: boolean;
  otaPending: boolean;
  targetSoftwareVersion: string | null;
  hiddenByFilter?: boolean;
  onBind: (id: string, exhibitId: string) => void;
  onProbe: (id: string) => void;
  onInstall: (id: string) => void;
  onCancel: (id: string) => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onSoftwareUpdate: (id: string) => void;
  onRemoveFromAdmin: (id: string) => void;
  onRemoveFull: (id: string) => void;
  onSaveNetwork: (id: string, data: { healthPort: number; uiPort: number; serverUrl: string }) => void;
  onPushConfig: (id: string) => void;
  onClearPolicies: (id: string) => void;
};

export function KioskDetail(props: KioskDetailProps) {
  const k = props.kiosk;
  const busyInstall = k.installStatus === "running" || k.installStatus === "queued";
  const busyPolicyClear = k.policyClearStatus === "running";
  const busyUiStart = k.uiStartStatus === "running";
  const busyUiStop = k.uiStopStatus === "running";
  const locked =
    props.installing ||
    props.starting ||
    props.stopping ||
    props.updatingSoftware ||
    props.binding ||
    props.removingAdmin ||
    props.removingFull ||
    props.savingNetwork ||
    props.pushingConfig ||
    props.clearingPolicies ||
    props.probing ||
    busyPolicyClear ||
    busyUiStart ||
    busyUiStop;

  const swLocal = k.softwareVersion || null;
  const swTarget = props.targetSoftwareVersion || k.otaTarget || null;
  const otaPending = Boolean(props.otaPending || k.otaPending);
  const swState = resolveOtaState(swLocal, swTarget, otaPending);

  const [healthPort, setHealthPort] = useState(String(k.healthPort));
  const [uiPort, setUiPort] = useState(String(k.uiPort));
  const [serverUrl, setServerUrl] = useState(k.serverUrl || "");

  useEffect(() => {
    setHealthPort(String(k.healthPort));
    setUiPort(String(k.uiPort));
    setServerUrl(k.serverUrl || "");
  }, [k.id, k.healthPort, k.uiPort, k.serverUrl]);

  return (
    <Card padding="none" className="kx-panel">
      <header className="kx-head">
        <div>
          <h2 className="kx-head__title">{k.name}</h2>
          <p className="kx-head__sub">{k.hostname}</p>
          <div className="kx-head__badges">
            <span className={`badge ${probeBadgeClass(k.probeStatus)}`}>
              {PROBE_STATUS_LABEL[k.probeStatus]}
            </span>
            <span className={`badge ${k.online ? "online" : "offline"}`}>
              {k.online ? "онлайн" : "офлайн"}
            </span>
            <span className="badge">{INSTALL_STATUS_LABEL[k.installStatus]}</span>
          </div>
          {props.hiddenByFilter ? (
            <p className="kx-head__filter-hint">Скрыт текущим фильтром / поиском — карточка открыта</p>
          ) : null}
        </div>
        {props.canEdit ? (
          <div className="kx-head__actions" aria-label="Управление">
            {busyInstall ? (
              <button
                type="button"
                className="btn danger"
                disabled={props.cancelling}
                onClick={() => props.onCancel(k.id)}
              >
                {props.cancelling ? "…" : "Отменить установку"}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn"
                  disabled={locked || !props.deployReady}
                  onClick={() => props.onInstall(k.id)}
                >
                  {props.installing ? "…" : "Установить"}
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={locked}
                  onClick={() => props.onStart(k.id)}
                >
                  {props.starting || busyUiStart ? "Запуск…" : "Старт UI"}
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={locked}
                  onClick={() => props.onStop(k.id)}
                >
                  {props.stopping || busyUiStop ? "Стоп…" : "Стоп"}
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={locked || !props.deployReady}
                  title={
                    !props.deployReady
                      ? "Нет update.zip на сервере"
                      : swState === "pending"
                        ? `Идёт OTA → ${swTarget}`
                        : swState === "outdated"
                          ? `На киоске ${swLocal} · сервер ${swTarget}`
                          : swState === "current"
                            ? `Уже на ${swLocal} — можно отправить повторно`
                            : "Отправить OTA-обновление ПО на этот киоск"
                  }
                  onClick={() => props.onSoftwareUpdate(k.id)}
                >
                  {props.updatingSoftware || otaPending
                    ? swState === "pending"
                      ? "Обновляется…"
                      : "…"
                    : "Обновить ПО"}
                </button>
              </>
            )}
            <button
              type="button"
              className="btn ghost"
              disabled={props.probing}
              onClick={() => props.onProbe(k.id)}
            >
              {props.probing ? "…" : "Опросить"}
            </button>
          </div>
        ) : null}
      </header>

      <div className="kx-body">
        <KioskLifecyclePanel
          kiosk={k}
          deployTarget={props.targetSoftwareVersion}
          updating={props.updatingSoftware || props.otaPending}
        />

        {props.canEdit ? (
          <>
            <section className="kx-section">
              <h3 className="kx-section__head">Экспонат</h3>
              <div className="kx-section__body">
                <label className="kx-field kx-field--grow">
                  Привязка контента
                  <select
                    value={k.exhibitId || ""}
                    disabled={locked}
                    onChange={(e) => props.onBind(k.id, e.target.value)}
                  >
                    <option value="">— не привязан —</option>
                    {props.exhibits.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.title}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            <section className="kx-section">
              <h3 className="kx-section__head">Сеть и kiosk.json</h3>
              <div className="kx-section__body">
                <div className="kx-net-grid">
                  <label className="kx-field">
                    Health-порт
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      value={healthPort}
                      disabled={locked || props.savingNetwork}
                      onChange={(e) => setHealthPort(e.target.value)}
                    />
                  </label>
                  <label className="kx-field">
                    UI-порт
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      value={uiPort}
                      disabled={locked || props.savingNetwork}
                      onChange={(e) => setUiPort(e.target.value)}
                    />
                  </label>
                  <label className="kx-field wide">
                    URL сервера Омскэкран
                    <input
                      type="url"
                      value={serverUrl}
                      placeholder="http://10.176.81.220:8080"
                      disabled={locked || props.savingNetwork}
                      onChange={(e) => setServerUrl(e.target.value)}
                    />
                  </label>
                </div>
                <div className="kx-section__body kx-section__body--row">
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={locked || props.savingNetwork}
                    onClick={() =>
                      props.onSaveNetwork(k.id, {
                        healthPort: Number(healthPort) || k.healthPort,
                        uiPort: Number(uiPort) || k.uiPort,
                        serverUrl,
                      })
                    }
                  >
                    {props.savingNetwork ? "…" : "Сохранить порты"}
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={locked || props.pushingConfig}
                    onClick={() => props.onPushConfig(k.id)}
                  >
                    {props.pushingConfig ? "…" : "Применить kiosk.json на ПК"}
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={locked || props.clearingPolicies || busyPolicyClear}
                    onClick={() => props.onClearPolicies(k.id)}
                  >
                    {props.clearingPolicies || busyPolicyClear
                      ? "Снятие политик…"
                      : "Снять lockdown-политики"}
                  </button>
                </div>
              </div>
            </section>

            <section className="kx-section kx-remove">
              <h3 className="kx-section__head">Удаление</h3>
              <div className="kx-remove__list">
                <div className="kx-remove__item">
                  <div className="kx-remove__text">
                    <strong>Только из админки</strong>
                    <span>Запись пропадёт из списка. Софт и политики на Windows-ПК не трогаем.</span>
                  </div>
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={locked || props.removingAdmin}
                    onClick={() => props.onRemoveFromAdmin(k.id)}
                  >
                    {props.removingAdmin ? "Удаление…" : "Убрать из списка"}
                  </button>
                </div>
                <div className="kx-remove__item kx-remove__item--danger">
                  <div className="kx-remove__text">
                    <strong>С Windows-ПК</strong>
                    <span>Снимает Омскэкран с компьютера и удаляет запись из админки.</span>
                  </div>
                  <button
                    type="button"
                    className="btn danger"
                    disabled={locked || props.removingFull}
                    onClick={() => props.onRemoveFull(k.id)}
                  >
                    {props.removingFull ? "Удаление…" : "Удалить с ПК"}
                  </button>
                </div>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </Card>
  );
}
