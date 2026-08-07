import { FormEvent, useEffect, useMemo, useState } from "react";
import type { KioskDto } from "@stella/shared";
import {
  INSTALL_STATUS_LABEL,
  POLICY_CLEAR_STATUS_LABEL,
  PROBE_STATUS_LABEL,
  UI_START_STATUS_LABEL,
  UI_STOP_STATUS_LABEL,
} from "@stella/shared";
import { useAuth } from "../auth";
import { api } from "../api";
import { DeployStatusPanel, type DeployStatus } from "../components/kiosk/DeployStatusPanel";
import { InstallTaskProgress, PolicyClearTaskProgress, UiStartTaskProgress, UiStopTaskProgress } from "../components/kiosk/KioskTaskProgress";
import { kioskHasProblem, probeBadgeClass } from "../components/kiosk/status";
import { PageShell } from "../components/ui/PageShell";
import { Alert } from "../components/ui/Alert";
import { Card } from "../components/ui/Card";
import { Stat, StatGrid } from "../components/ui/StatGrid";
import { useConfirm } from "../components/ui/confirm";

type ExhibitOpt = { id: string; title: string };
type FilterTab = "all" | "online" | "problems" | "installing";

function formatSeen(iso: string | null) {
  if (!iso) return "никогда";
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function kioskDotClass(k: KioskDto) {
  if (k.probeStatus === "healthy" && k.online) return "ok";
  if (kioskHasProblem(k)) return "bad";
  if (k.online) return "warn";
  return "off";
}

function kioskBusyLabel(k: KioskDto) {
  if (k.uiStopStatus === "running") return UI_STOP_STATUS_LABEL.running;
  if (k.uiStartStatus === "running") return UI_START_STATUS_LABEL.running;
  if (k.policyClearStatus === "running") return POLICY_CLEAR_STATUS_LABEL.running;
  if (k.installStatus === "running" || k.installStatus === "queued") return INSTALL_STATUS_LABEL[k.installStatus];
  return null;
}

type KioskDetailProps = {
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
  onBind: (id: string, exhibitId: string) => void;
  onProbe: (id: string) => void;
  onInstall: (id: string) => void;
  onCancel: (id: string) => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onRemoveFromAdmin: (id: string) => void;
  onRemoveFull: (id: string) => void;
  onSaveNetwork: (id: string, data: { healthPort: number; uiPort: number; serverUrl: string }) => void;
  onPushConfig: (id: string) => void;
  onClearPolicies: (id: string) => void;
};

function KioskDetailPanel(props: KioskDetailProps) {
  const k = props.kiosk;
  const busyInstall = k.installStatus === "running" || k.installStatus === "queued";
  const busyPolicyClear = k.policyClearStatus === "running";
  const busyUiStart = k.uiStartStatus === "running";
  const busyUiStop = k.uiStopStatus === "running";
  const locked =
    props.installing || props.starting || props.stopping || busyPolicyClear || busyUiStart || busyUiStop;

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
            <span className={`badge ${probeBadgeClass(k.probeStatus)}`}>{PROBE_STATUS_LABEL[k.probeStatus]}</span>
            <span className={`badge ${k.online ? "online" : "offline"}`}>{k.online ? "онлайн" : "офлайн"}</span>
            <span className="badge">{INSTALL_STATUS_LABEL[k.installStatus]}</span>
          </div>
        </div>
        {props.canEdit ? (
          <div className="kx-head__actions">
            {busyInstall ? (
              <button type="button" className="btn danger" disabled={props.cancelling} onClick={() => props.onCancel(k.id)}>
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
                <button type="button" className="btn secondary" disabled={locked} onClick={() => props.onStart(k.id)}>
                  {props.starting || busyUiStart ? "Запуск…" : "Старт UI"}
                </button>
                <button type="button" className="btn ghost" disabled={locked} onClick={() => props.onStop(k.id)}>
                  {props.stopping || busyUiStop ? "Стоп…" : "Стоп"}
                </button>
              </>
            )}
            <button type="button" className="btn ghost" disabled={props.probing} onClick={() => props.onProbe(k.id)}>
              {props.probing ? "…" : "Опросить"}
            </button>
          </div>
        ) : null}
      </header>

      <div className="kx-body">
        <InstallTaskProgress kiosk={k} />
        <UiStartTaskProgress kiosk={k} />
        <UiStopTaskProgress kiosk={k} />
        <PolicyClearTaskProgress kiosk={k} />

        <dl className="kx-meta">
          <div className="kx-meta__cell">
            <dt>Heartbeat</dt>
            <dd>{formatSeen(k.lastSeenAt)}</dd>
          </div>
          <div className="kx-meta__cell">
            <dt>Версия софта</dt>
            <dd>{k.appVersion || "—"}</dd>
          </div>
          <div className="kx-meta__cell">
            <dt>Контент</dt>
            <dd className="mono">{k.contentVersion || "—"}</dd>
          </div>
          <div className="kx-meta__cell">
            <dt>Синхронизация</dt>
            <dd className={k.syncStatus === "error" ? "bad" : undefined}>
              {k.syncStatus}
              {k.syncMessage ? ` · ${k.syncMessage}` : ""}
            </dd>
          </div>
          <div className="kx-meta__cell">
            <dt>Health URL</dt>
            <dd className="mono">
              http://{k.hostname}:{k.healthPort}/health
            </dd>
          </div>
          <div className="kx-meta__cell">
            <dt>UI (локально)</dt>
            <dd className="mono">http://127.0.0.1:{k.uiPort}/</dd>
          </div>
        </dl>

        {k.probeMessage ? <p className="kx-probe-msg">{k.probeMessage}</p> : null}

        {props.canEdit ? (
          <>
            <section className="kx-section">
              <h3 className="kx-section__head">Экспонат</h3>
              <div className="kx-section__body">
                <label className="kx-field kx-field--grow">
                  Привязка контента
                  <select value={k.exhibitId || ""} onChange={(e) => props.onBind(k.id, e.target.value)}>
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
                    {props.clearingPolicies || busyPolicyClear ? "Снятие политик…" : "Снять lockdown-политики"}
                  </button>
                </div>
              </div>
            </section>

            <section className="kx-section kx-danger">
              <h3 className="kx-section__head">Удаление</h3>
              <div className="kx-section__body">
                <p className="muted kx-danger__hint">
                  «Из списка» — только запись в админке (ПК не трогаем). «С Windows-ПК» — снимает софт и удаляет
                  запись.
                </p>
                <div className="kx-section__body--row">
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={locked}
                    onClick={() => props.onRemoveFromAdmin(k.id)}
                  >
                    Убрать из списка
                  </button>
                  <button
                    type="button"
                    className="btn danger"
                    disabled={locked}
                    onClick={() => props.onRemoveFull(k.id)}
                  >
                    Удалить с Windows-ПК
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

export function KiosksPage() {
  const { canEdit } = useAuth();
  const confirmDialog = useConfirm();
  const [kiosks, setKiosks] = useState<KioskDto[]>([]);
  const [exhibits, setExhibits] = useState<ExhibitOpt[]>([]);
  const [deploy, setDeploy] = useState<DeployStatus | null>(null);
  const [hostname, setHostname] = useState("");
  const [name, setName] = useState("");
  const [exhibitId, setExhibitId] = useState("");
  const [installSoftware, setInstallSoftware] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [domainSuffix, setDomainSuffix] = useState("udhb.local");
  const [testBusy, setTestBusy] = useState(false);
  const [testHint, setTestHint] = useState("");
  const [error, setError] = useState("");
  const [probing, setProbing] = useState<string | null>(null);
  const [probingAll, setProbingAll] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  const [rollingBack, setRollingBack] = useState(false);
  const [okHint, setOkHint] = useState("");
  const [savingNetwork, setSavingNetwork] = useState<string | null>(null);
  const [pushingConfig, setPushingConfig] = useState<string | null>(null);
  const [clearingPolicies, setClearingPolicies] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  async function loadExhibits() {
    setExhibits(await api<ExhibitOpt[]>("/api/exhibits?fields=id,title"));
  }

  async function load(preferredId?: string | null) {
    const [k, d] = await Promise.all([
      api<KioskDto[]>("/api/kiosks"),
      api<DeployStatus>("/api/kiosks/deploy/status"),
    ]);
    setKiosks(k);
    setDeploy(d);
    if (d.domainSuffix) setDomainSuffix(d.domainSuffix);
    setSelectedId((cur) => {
      const want = preferredId === undefined ? cur : preferredId;
      if (want && k.some((x) => x.id === want)) return want;
      return k[0]?.id ?? null;
    });
  }

  useEffect(() => {
    Promise.all([load(), loadExhibits()]).catch((e) => setError(e.message));
  }, []);

  const installingNow = useMemo(
    () => kiosks.some((k) => k.installStatus === "running" || k.installStatus === "queued"),
    [kiosks]
  );

  const policyClearNow = useMemo(
    () => kiosks.some((k) => k.policyClearStatus === "running"),
    [kiosks]
  );

  const uiStartNow = useMemo(() => kiosks.some((k) => k.uiStartStatus === "running"), [kiosks]);

  const uiStopNow = useMemo(() => kiosks.some((k) => k.uiStopStatus === "running"), [kiosks]);

  useEffect(() => {
    const busy = installingNow || policyClearNow || uiStartNow || uiStopNow;
    const ms = busy ? 2500 : 10000;
    const t = setInterval(() => {
      load().catch(() => undefined);
    }, ms);
    return () => clearInterval(t);
  }, [installingNow, policyClearNow, uiStartNow, uiStopNow]);

  const stats = useMemo(() => {
    const online = kiosks.filter((k) => k.online).length;
    const healthy = kiosks.filter((k) => k.probeStatus === "healthy").length;
    const installingCount = kiosks.filter(
      (k) => k.installStatus === "running" || k.installStatus === "queued"
    ).length;
    const problems = kiosks.filter((k) => kioskHasProblem(k)).length;
    return { online, healthy, installingCount, problems, total: kiosks.length };
  }, [kiosks]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return kiosks
      .filter((k) => {
        if (filter === "online") return k.online;
        if (filter === "problems") return kioskHasProblem(k);
        if (filter === "installing")
          return k.installStatus === "running" || k.installStatus === "queued";
        return true;
      })
      .filter((k) => {
        if (!q) return true;
        return k.name.toLowerCase().includes(q) || k.hostname.toLowerCase().includes(q);
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [kiosks, filter, search]);

  const selected = useMemo(
    () => kiosks.find((k) => k.id === selectedId) ?? null,
    [kiosks, selectedId]
  );

  async function refresh() {
    setRefreshing(true);
    try {
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка обновления");
    } finally {
      setRefreshing(false);
    }
  }

  async function probeAll() {
    if (!kiosks.length) return;
    setProbingAll(true);
    setError("");
    try {
      for (const k of kiosks) {
        await api(`/api/kiosks/${k.id}/probe`, { method: "POST" });
      }
      await load();
      setOkHint(`Опрос выполнен для ${kiosks.length} киосков`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка опроса");
    } finally {
      setProbingAll(false);
    }
  }

  async function rollbackAll() {
    if (kiosks.length === 0) {
      const ok = await confirmDialog({
        title: "Сбросить настройки?",
        message: "Будут сброшены флаги «Софт киосков» и «Блокировка клавиатуры».",
        confirmLabel: "Сбросить",
        tone: "warn",
      });
      if (!ok) return;
      setRollingBack(true);
      try {
        const res = await api<{ message: string }>("/api/kiosks/rollback-all", {
          method: "POST",
          json: { removeFromAdmin: false },
        });
        setOkHint(res.message);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Откат не выполнен");
      } finally {
        setRollingBack(false);
      }
      return;
    }
    const ok = await confirmDialog({
      title: "Откатить все киоски?",
      message: "На каждом Windows-ПК будет выполнено удаление Омскэкран и снятие политик.",
      details: "В настройках сбросятся флаги софта и клавиатуры.",
      confirmLabel: "Откатить все",
      tone: "danger",
    });
    if (!ok) return;
    const removeRows = await confirmDialog({
      title: "Удалить из списка?",
      message: "Также удалить записи киосков из админки?",
      details: "Если отменить — ПК останутся в списке для повторной установки.",
      confirmLabel: "Удалить записи",
      cancelLabel: "Оставить в списке",
      tone: "warn",
    });
    setRollingBack(true);
    try {
      const res = await api<{
        ok: boolean;
        message: string;
        failCount: number;
        results: Array<{ hostname: string; ok: boolean; message: string }>;
      }>("/api/kiosks/rollback-all", {
        method: "POST",
        json: { removeFromAdmin: removeRows },
      });
      if (res.failCount) {
        const fails = res.results
          .filter((r) => !r.ok)
          .map((r) => `${r.hostname}: ${r.message}`)
          .join("\n");
        setError(`${res.message}\n${fails}`);
      } else {
        setOkHint(res.message);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Откат не выполнен");
    } finally {
      setRollingBack(false);
    }
  }

  async function onTestWinRm() {
    const host = hostname.trim();
    if (!host) {
      setError("Укажите имя Windows-ПК");
      return;
    }
    setTestBusy(true);
    setError("");
    setTestHint("");
    try {
      const res = await api<{
        ok: boolean;
        hostname: string;
        message: string;
        detail?: string;
      }>("/api/kiosks/test-connection", {
        method: "POST",
        json: { hostname: host },
      });
      const text = res.detail ? `${res.message} — ${res.detail}` : res.message;
      if (res.ok) {
        setTestHint(`${text} · будет добавлен как ${res.hostname}`);
        setHostname(res.hostname);
      } else {
        setError(text);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Проверка WinRM не удалась");
    } finally {
      setTestBusy(false);
    }
  }

  async function onCreate(ev: FormEvent) {
    ev.preventDefault();
    try {
      if (installSoftware && deploy && !deploy.packageReady) {
        setError("Сначала на Debian: pnpm pack:kiosk-deploy");
        return;
      }
      const host = hostname.trim();
      const created = await api<KioskDto>("/api/kiosks", {
        method: "POST",
        json: {
          hostname: host,
          name: name.trim() || undefined,
          exhibitId: exhibitId || null,
          installSoftware,
        },
      });
      setHostname("");
      setName("");
      setExhibitId("");
      setTestHint("");
      setShowAdd(false);
      await load();
      setSelectedId(created.id);
      setOkHint(`Киоск ${created.hostname} добавлен${installSoftware ? " · установка по WinRM…" : ""}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    }
  }

  async function bind(id: string, nextExhibitId: string) {
    try {
      await api(`/api/kiosks/${id}`, { method: "PATCH", json: { exhibitId: nextExhibitId || null } });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    }
  }

  async function probe(id: string) {
    setProbing(id);
    try {
      await api(`/api/kiosks/${id}/probe`, { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка опроса");
    } finally {
      setProbing(null);
    }
  }

  async function install(id: string) {
    setInstalling(id);
    setError("");
    try {
      if (deploy && !deploy.packageReady) throw new Error("Пакет не готов");
      await api(`/api/kiosks/${id}/install`, { method: "POST" });
      setSelectedId(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка установки");
    } finally {
      setInstalling(null);
    }
  }

  async function cancelInstall(id: string) {
    setCancelling(id);
    try {
      await api(`/api/kiosks/${id}/install/cancel`, { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отменить");
    } finally {
      setCancelling(null);
    }
  }

  async function startKiosk(id: string) {
    setStarting(id);
    setError("");
    try {
      const res = await api<{ message: string; alreadyRunning?: boolean; kiosk: KioskDto }>(
        `/api/kiosks/${id}/start`,
        { method: "POST" }
      );
      setKiosks((prev) => prev.map((k) => (k.id === id ? res.kiosk : k)));
      setSelectedId(id);
      setOkHint(
        res.alreadyRunning ? "Запуск UI уже выполняется — смотрите прогресс" : res.message
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось запустить");
    } finally {
      setStarting(null);
    }
  }

  async function stopKiosk(id: string) {
    const ok = await confirmDialog({
      title: "Выключить киоск?",
      message: "Агент и Edge UI на этом Windows-ПК будут остановлены.",
      confirmLabel: "Выключить",
      tone: "warn",
    });
    if (!ok) return;
    setStopping(id);
    setError("");
    try {
      const res = await api<{ message: string; alreadyRunning?: boolean; kiosk: KioskDto }>(
        `/api/kiosks/${id}/stop`,
        { method: "POST" }
      );
      setKiosks((prev) => prev.map((k) => (k.id === id ? res.kiosk : k)));
      setSelectedId(id);
      setOkHint(
        res.alreadyRunning ? "Остановка уже выполняется — смотрите прогресс" : res.message
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось выключить");
    } finally {
      setStopping(null);
    }
  }

  async function saveNetwork(id: string, data: { healthPort: number; uiPort: number; serverUrl: string }) {
    setSavingNetwork(id);
    try {
      await api(`/api/kiosks/${id}`, {
        method: "PATCH",
        json: {
          healthPort: data.healthPort,
          uiPort: data.uiPort,
          serverUrl: data.serverUrl.trim() || null,
        },
      });
      setOkHint("Порты сохранены");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setSavingNetwork(null);
    }
  }

  async function pushConfig(id: string) {
    setPushingConfig(id);
    try {
      const res = await api<{ message: string }>(`/api/kiosks/${id}/push-config`, { method: "POST" });
      setOkHint(res.message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось применить конфиг");
    } finally {
      setPushingConfig(null);
    }
  }

  async function clearPolicies(id: string) {
    const ok = await confirmDialog({
      title: "Снять политики lockdown?",
      message: "Lockdown-политики будут сняты на этом Windows-ПК.",
      details: "Софт киоска не удаляется.",
      confirmLabel: "Снять политики",
      tone: "warn",
    });
    if (!ok) return;
    setClearingPolicies(id);
    setError("");
    try {
      const res = await api<{ message: string; alreadyRunning?: boolean; kiosk: KioskDto }>(
        `/api/kiosks/${id}/clear-policies`,
        { method: "POST" }
      );
      setKiosks((prev) => prev.map((k) => (k.id === id ? res.kiosk : k)));
      setSelectedId(id);
      setOkHint(
        res.alreadyRunning ? "Снятие политик уже выполняется — смотрите прогресс" : res.message
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось снять политики");
    } finally {
      setClearingPolicies(null);
    }
  }

  function nextSelectedAfterDelete(removedId: string, list: KioskDto[]) {
    const idx = list.findIndex((k) => k.id === removedId);
    if (idx === -1) return list[0]?.id ?? null;
    return list[idx + 1]?.id ?? list[idx - 1]?.id ?? null;
  }

  async function deleteKioskFromAdmin(id: string) {
    setError("");
    const res = await api<{ message: string }>(`/api/kiosks/${id}?purge=0`, { method: "DELETE" });
    const nextId = nextSelectedAfterDelete(id, kiosks.filter((x) => x.id !== id));
    await load(nextId);
    setOkHint(res.message || "Киоск убран из списка");
  }

  async function removeFromAdmin(id: string) {
    const k = kiosks.find((x) => x.id === id);
    const ok = await confirmDialog({
      title: "Убрать из списка?",
      message: `Киоск «${k?.name || "без названия"}» будет удалён только из админки.`,
      details: "Софт на Windows-ПК останется без изменений.",
      confirmLabel: "Убрать",
      tone: "warn",
    });
    if (!ok) return;
    try {
      await deleteKioskFromAdmin(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить");
    }
  }

  async function removeFull(id: string) {
    const k = kiosks.find((x) => x.id === id);
    const ok = await confirmDialog({
      title: "Удалить киоск с ПК?",
      message: `«${k?.name || "Киоск"}» будет удалён с Windows-ПК и из админки.`,
      details: "Будет выполнено удаление софта Омскэкран на компьютере.",
      confirmLabel: "Удалить",
      tone: "danger",
    });
    if (!ok) return;
    setError("");
    try {
      const res = await api<{ message: string }>(`/api/kiosks/${id}`, { method: "DELETE" });
      const nextId = nextSelectedAfterDelete(id, kiosks.filter((x) => x.id !== id));
      await load(nextId);
      setOkHint(res.message || "Киоск удалён");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Не удалось удалить";
      const fallback = await confirmDialog({
        title: "Не удалось удалить с ПК",
        message: msg,
        details: "Удалить только запись из админки, без снятия софта с Windows-ПК?",
        confirmLabel: "Только из списка",
        tone: "warn",
      });
      if (fallback) {
        try {
          await deleteKioskFromAdmin(id);
        } catch (e2) {
          setError(e2 instanceof Error ? e2.message : "Не удалось удалить");
        }
      } else {
        setError(msg);
      }
    }
  }

  const filterTabs: { id: FilterTab; label: string; count: number }[] = [
    { id: "all", label: "Все", count: stats.total },
    { id: "online", label: "Онлайн", count: stats.online },
    { id: "problems", label: "Проблемы", count: stats.problems },
    { id: "installing", label: "Установка", count: stats.installingCount },
  ];

  return (
    <PageShell
      section="Парк ПК"
      title="Киоски"
      description="Парк Windows-ПК зала: установка софта с Debian-сервера, конфиг, lockdown и экспонаты."
      wide
      actions={
        <>
          <button type="button" className="btn ghost" disabled={refreshing} onClick={() => void refresh()}>
            {refreshing ? "…" : "Обновить"}
          </button>
          <button type="button" className="btn ghost" disabled={probingAll || !kiosks.length} onClick={() => void probeAll()}>
            {probingAll ? "…" : "Опросить все"}
          </button>
          {canEdit && (
            <button type="button" className="btn danger" disabled={rollingBack} onClick={() => void rollbackAll()}>
              {rollingBack ? "Откат…" : "Откатить все"}
            </button>
          )}
        </>
      }
      banner={
        <>
          {okHint ? (
            <Alert tone="success" onDismiss={() => setOkHint("")}>
              {okHint}
            </Alert>
          ) : null}
          {error ? (
            <Alert tone="error" onDismiss={() => setError("")}>
              {error}
            </Alert>
          ) : null}
          {deploy ? <DeployStatusPanel deploy={deploy} /> : null}
        </>
      }
    >
      <StatGrid columns={5}>
        <Stat label="Всего" value={stats.total} />
        <Stat label="Healthy" value={stats.healthy} tone="ok" />
        <Stat label="Онлайн" value={stats.online} tone="ok" />
        <Stat label="Установка" value={stats.installingCount} tone={stats.installingCount ? "warn" : "default"} />
        <Stat label="Проблемы" value={stats.problems} tone={stats.problems ? "bad" : "default"} />
      </StatGrid>

      <div className="kx-workspace">
        <aside className="kx-list">
          <div className="kx-list__toolbar">
            <input
              type="search"
              className="kx-list__search"
              placeholder="Поиск по имени или hostname…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="kx-filters" role="tablist">
              {filterTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === tab.id}
                  className={`kx-filter ${filter === tab.id ? "is-active" : ""}`}
                  onClick={() => setFilter(tab.id)}
                >
                  {tab.label}
                  <span className="kx-filter__n">{tab.count}</span>
                </button>
              ))}
            </div>
            {canEdit ? (
              <>
                <button
                  type="button"
                  className={`btn secondary kx-add-toggle ${showAdd ? "is-active" : ""}`}
                  onClick={() => setShowAdd((v) => !v)}
                >
                  {showAdd ? "Скрыть форму" : "+ Добавить киоск"}
                </button>
                {showAdd ? (
                  <Card title="Новый киоск (домен / WinRM)">
                    <form className="kx-add-form" onSubmit={onCreate}>
                      <label>
                        Имя Windows-ПК
                        <input
                          required
                          value={hostname}
                          onChange={(e) => {
                            setHostname(e.target.value);
                            setTestHint("");
                          }}
                          placeholder={`itpc07 или itpc07.${domainSuffix}`}
                          autoComplete="off"
                        />
                      </label>
                      <p className="cx-setting__hint" style={{ margin: 0 }}>
                        Короткое имя дополнится до <code>*.{domainSuffix}</code>. Подключение с
                        Debian по WinRM (без SSH на ПК). Учётку задайте в Настройки → Windows.
                      </p>
                      <label>
                        Название в админке
                        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Стелла · зал 1" />
                      </label>
                      <label>
                        Экспонат
                        <select value={exhibitId} onChange={(e) => setExhibitId(e.target.value)}>
                          <option value="">— не привязан —</option>
                          {exhibits.map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={installSoftware}
                          onChange={(e) => setInstallSoftware(e.target.checked)}
                        />
                        Сразу установить софт по WinRM
                      </label>
                      {testHint ? <Alert tone="success">{testHint}</Alert> : null}
                      <div className="kx-add-actions" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="btn secondary"
                          disabled={testBusy || !hostname.trim()}
                          onClick={() => void onTestWinRm()}
                        >
                          {testBusy ? "Проверка…" : "Проверить WinRM"}
                        </button>
                        <button className="btn" disabled={installSoftware && !!deploy && !deploy.packageReady}>
                          Добавить
                        </button>
                      </div>
                    </form>
                  </Card>
                ) : null}
              </>
            ) : null}
          </div>

          <div className="kx-items">
            {filtered.map((k) => {
              const busy = kioskBusyLabel(k);
              return (
                <button
                  key={k.id}
                  type="button"
                  className={`kx-item ${selectedId === k.id ? "is-selected" : ""} ${busy ? "is-busy" : ""}`}
                  onClick={() => setSelectedId(k.id)}
                >
                  <div className="kx-item__row">
                    <div>
                      <span className="kx-item__name">{k.name}</span>
                      <span className="kx-item__host">{k.hostname}</span>
                    </div>
                    <span className={`kx-item__dot ${kioskDotClass(k)}`} title={PROBE_STATUS_LABEL[k.probeStatus]} />
                  </div>
                  <div className="kx-item__foot">
                    <span className={`kx-item__tag ${k.online ? "is-live" : ""}`}>
                      {k.online ? "онлайн" : "офлайн"}
                    </span>
                    <span className={`kx-item__tag ${k.probeStatus === "healthy" ? "is-live" : k.probeStatus === "unreachable" || k.probeStatus === "no_software" ? "is-bad" : ""}`}>
                      {PROBE_STATUS_LABEL[k.probeStatus]}
                    </span>
                    {busy ? <span className="kx-item__tag is-busy">{busy}</span> : null}
                    {k.exhibitTitle ? <span className="kx-item__tag">{k.exhibitTitle}</span> : null}
                  </div>
                </button>
              );
            })}
            {!filtered.length ? (
            <div className="cx-empty">
              <p className="cx-empty__title">{kiosks.length ? "Ничего не найдено" : "Киосков пока нет"}</p>
                <p className="muted">
                  {kiosks.length ? "Измените фильтр или поиск." : canEdit ? "Нажмите «Добавить киоск»." : "Список пуст."}
                </p>
              </div>
            ) : null}
          </div>
        </aside>

        {selected ? (
          <KioskDetailPanel
            kiosk={selected}
            exhibits={exhibits}
            canEdit={canEdit}
            deployReady={!!deploy?.packageReady}
            probing={probing === selected.id}
            installing={installing === selected.id}
            cancelling={cancelling === selected.id}
            starting={starting === selected.id}
            stopping={stopping === selected.id}
            savingNetwork={savingNetwork === selected.id}
            pushingConfig={pushingConfig === selected.id}
            clearingPolicies={clearingPolicies === selected.id}
            onBind={bind}
            onProbe={probe}
            onInstall={install}
            onCancel={cancelInstall}
            onStart={startKiosk}
            onStop={stopKiosk}
            onRemoveFromAdmin={removeFromAdmin}
            onRemoveFull={removeFull}
            onSaveNetwork={saveNetwork}
            onPushConfig={pushConfig}
            onClearPolicies={clearPolicies}
          />
        ) : (
          <div className="kx-panel__empty">
            <div className="kx-panel__empty-icon" aria-hidden>
              🖥
            </div>
            <p className="cx-empty__title">Выберите киоск слева</p>
            <p className="muted">Здесь появятся управление, прогресс установки и настройки сети.</p>
          </div>
        )}
      </div>
    </PageShell>
  );
}
