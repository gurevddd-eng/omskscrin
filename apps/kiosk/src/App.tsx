import { useCallback, useEffect, useMemo, useState } from "react";
import type { SyncStatus } from "@stella/shared";
import { loadConfig, type KioskConfig } from "./config";
import {
  checkUpdates,
  fingerprintOf,
  getKnownSoftwareVersion,
  loadLocalCache,
  mediaUrl,
  sendHeartbeat,
  setKnownSoftwareVersion,
  syncContent,
  type CachedState,
} from "./sync";
import { VideoPlayer } from "./VideoPlayer";
import { AudioPlayer } from "./AudioPlayer";
import { ReadyImage, prefetchImages } from "./ReadyImage";
import { setKeyboardBlocked } from "./lockdown";
import { isTauriShell, launchExe, probeNativeShell } from "./native";

type Tab = "home" | "about" | "gallery" | "video";

const AD_ROTATE_MS = 8000;

/** Poll interval for content version checks. Caps high values in kiosk.json (e.g. 300). */
function contentPollSec(config: { syncIntervalSec: number }, errored: boolean) {
  if (errored) return 15;
  const configured = Number(config.syncIntervalSec);
  const n = Number.isFinite(configured) && configured > 0 ? configured : 20;
  return Math.max(15, Math.min(n, 30));
}

const NAV: { id: Tab; label: string; hint: string }[] = [
  { id: "home", label: "Главная", hint: "Обложка" },
  { id: "about", label: "Описание", hint: "Текст и ТТХ" },
  { id: "gallery", label: "Галерея", hint: "Фотографии" },
  { id: "video", label: "Видео", hint: "Ролик" },
];

function NavIcon({ id }: { id: Tab }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (id === "home") {
    return (
      <svg {...common}>
        <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" />
      </svg>
    );
  }
  if (id === "about") {
    return (
      <svg {...common}>
        <path d="M7 5h10M7 10h10M7 15h6" />
        <rect x="4" y="3" width="16" height="18" rx="2" />
      </svg>
    );
  }
  if (id === "gallery") {
    return (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="9" cy="11" r="1.6" fill="currentColor" stroke="none" />
        <path d="m7 17 3.2-3.5 2.3 2.4L16 12l4 5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="m10 9 6 3-6 3V9Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return {
    time: now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
    date: now.toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }),
  };
}

function StarLogo() {
  return (
    <svg className="rail__star" viewBox="0 0 64 64" aria-hidden>
      <defs>
        <filter id="star-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="1.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g className="rail__star-twinkle" filter="url(#star-glow)">
        <path
          fill="currentColor"
          d="M32 4l7.4 18.2H60l-15 12.2 5.4 19.2L32 43.4 13.6 53.6l5.4-19.2L4 22.2h20.6L32 4z"
        />
        <path
          fill="#1a1a1a"
          d="M32 18l3.2 8H44l-6.4 5 2.3 8.2L32 34.4l-7.9 4.8 2.3-8.2L20 26h8.8L32 18z"
        />
      </g>
    </svg>
  );
}

function EmptyBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-block">
      <div className="empty-block__mark" aria-hidden />
      <p className="empty-block__kicker">Парк Победы</p>
      <h2 className="empty-block__title">{title}</h2>
      <p className="empty-block__text">{text}</p>
    </div>
  );
}

export function App() {
  const [config, setConfig] = useState<KioskConfig | null>(null);
  const [state, setState] = useState<CachedState | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [galleryIdx, setGalleryIdx] = useState(0);
  const [adIdx, setAdIdx] = useState(0);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("unknown");
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [screenKey, setScreenKey] = useState(0);
  const [hiContrast, setHiContrast] = useState(false);
  const [nativeShell, setNativeShell] = useState(false);
  const [gameBusy, setGameBusy] = useState(false);
  const [gameError, setGameError] = useState<string | null>(null);
  const { time, date } = useClock();

  const bumpActivity = useCallback(() => {
    (window as unknown as { __lastActive?: number }).__lastActive = Date.now();
  }, []);

  const goTab = useCallback((next: Tab) => {
    setTab((prev) => {
      if (prev === next) return prev;
      setScreenKey((k) => k + 1);
      return next;
    });
  }, []);

  useEffect(() => {
    void loadConfig().then(async (cfg) => {
      setConfig(cfg);
      const cached = await loadLocalCache(cfg.serverUrl);
      if (cached) setState(cached);
    });
    setNativeShell(isTauriShell());
    void probeNativeShell().then(setNativeShell);
  }, []);

  const startGame = useCallback(async () => {
    if (!config?.game?.exe || gameBusy) return;
    setGameError(null);
    setGameBusy(true);
    bumpActivity();
    try {
      await launchExe(config.game.exe, config.game.args || [], config.game.cwd);
    } catch (e) {
      setGameError(e instanceof Error ? e.message : "Не удалось запустить игру");
    } finally {
      setGameBusy(false);
      bumpActivity();
    }
  }, [config, gameBusy, bumpActivity]);

  useEffect(() => {
    if (!config) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastSyncStatus: SyncStatus = "unknown";
    let lastContentVersion: string | null = null;
    let lastExhibitVersion: string | null = null;
    let localIncomplete = true;
    let forceFullSync = true;
    /** Agent software version seen at session start — reload only if it changes (OTA). */
    let sessionAgentSoftware: string | null = null;
    let reloadArmed = false;

    async function maybeReloadForSoftware(serverSoftware: string) {
      if (!serverSoftware || reloadArmed) return;
      try {
        const hr = await fetch(`http://127.0.0.1:${config!.healthPort}/health`, {
          cache: "no-store",
        });
        if (!hr.ok || stopped) return;
        const health = (await hr.json()) as { softwareVersion?: string };
        const agentSw = String(health.softwareVersion || "").trim();
        if (!agentSw) return;

        // First successful probe this session: remember version, never reload just for that
        if (sessionAgentSoftware === null) {
          sessionAgentSoftware = agentSw;
          setKnownSoftwareVersion(agentSw);
          return;
        }

        // Agent picked up a new build while UI was open → soft reload once
        if (agentSw !== sessionAgentSoftware && agentSw === serverSoftware) {
          reloadArmed = true;
          sessionAgentSoftware = agentSw;
          setKnownSoftwareVersion(agentSw);
          window.location.reload();
        }
      } catch {
        /* agent offline */
      }
    }

    async function tickSync() {
      const updates = await checkUpdates(config!, getKnownSoftwareVersion());
      if (stopped) return;

      if (updates?.softwareVersion) {
        void maybeReloadForSoftware(updates.softwareVersion);
      }

      if (typeof updates?.blockKeyboard === "boolean") {
        setKeyboardBlocked(updates.blockKeyboard);
      }

      const localFingerprint = lastContentVersion;
      const remoteFingerprint =
        updates?.syncFingerprint ??
        (updates
          ? `${updates.contentVersion ?? "0"}|${updates.adsVersion ?? "0"}|${updates.settingsVersion ?? "0"}`
          : null);

      const offline = updates == null;
      const haveUsableCache = localFingerprint != null && !localIncomplete;

      const serverDiffers =
        !offline &&
        remoteFingerprint != null &&
        localFingerprint != null &&
        remoteFingerprint !== localFingerprint;

      // Offline with a full local cache: keep UI as-is (do not re-fetch / revoke blob URLs)
      if (offline && haveUsableCache) {
        forceFullSync = false;
        setSyncStatus("ok");
        setSyncMessage("офлайн — локальный кэш");
        timer = setTimeout(() => void tickSync(), contentPollSec(config!, true) * 1000);
        return;
      }

      const needContentSync =
        forceFullSync ||
        lastSyncStatus === "error" ||
        lastSyncStatus === "unknown" ||
        localFingerprint == null ||
        localIncomplete ||
        serverDiffers;

      if (!needContentSync) {
        forceFullSync = false;
        if (lastSyncStatus === "unknown") {
          lastSyncStatus = "ok";
          setSyncStatus("ok");
        }
        await sendHeartbeat(config!, {
          contentVersion: lastExhibitVersion,
          syncStatus: lastSyncStatus,
          syncMessage: null,
        });
        timer = setTimeout(
          () => void tickSync(),
          contentPollSec(config!, false) * 1000
        );
        return;
      }

      const result = await syncContent(config!);
      if (stopped) return;
      forceFullSync = false;

      if (result.state) {
        lastContentVersion = result.state.syncFingerprint || fingerprintOf(result.state.manifest);
        lastExhibitVersion =
          result.state.manifest.contentVersion ??
          result.state.manifest.exhibit?.contentVersion ??
          null;
        localIncomplete = !result.state.complete;
        if (typeof result.state.manifest.blockKeyboard === "boolean") {
          setKeyboardBlocked(result.state.manifest.blockKeyboard);
        }
        setState(result.state);
        lastSyncStatus = result.syncStatus;
        setSyncStatus(result.syncStatus);
        setSyncMessage(result.syncMessage);
      } else {
        // Network/manifest failure: keep whatever is already on screen
        lastSyncStatus = haveUsableCache ? "ok" : "error";
        setSyncStatus(lastSyncStatus);
        setSyncMessage(
          haveUsableCache ? "офлайн — локальный кэш" : result.syncMessage || "нет данных"
        );
      }

      await sendHeartbeat(config!, {
        contentVersion: lastExhibitVersion,
        syncStatus: lastSyncStatus,
        syncMessage: result.syncMessage,
      });
      timer = setTimeout(
        () => void tickSync(),
        contentPollSec(config!, lastSyncStatus === "error" || offline) * 1000
      );
    }

    const hbTimer = setInterval(() => {
      sendHeartbeat(config, {
        contentVersion: lastExhibitVersion,
        syncStatus: lastSyncStatus,
        syncMessage: null,
      });
    }, config.heartbeatIntervalSec * 1000);

    void (async () => {
      const cached = await loadLocalCache(config.serverUrl);
      if (stopped) return;
      if (cached) {
        setState(cached);
        lastContentVersion = cached.syncFingerprint || fingerprintOf(cached.manifest);
        lastExhibitVersion =
          cached.manifest.contentVersion ?? cached.manifest.exhibit?.contentVersion ?? null;
        localIncomplete = !cached.complete;
        if (typeof cached.manifest.blockKeyboard === "boolean") {
          setKeyboardBlocked(cached.manifest.blockKeyboard);
        }
        if (cached.complete) {
          lastSyncStatus = "ok";
          setSyncStatus("ok");
        }
      }
      await tickSync();
    })();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      clearInterval(hbTimer);
    };
  }, [config]);

  useEffect(() => {
    bumpActivity();
    const events = ["pointerdown", "touchstart", "keydown"] as const;
    for (const e of events) window.addEventListener(e, bumpActivity);
    const idle = setInterval(() => {
      const last = (window as unknown as { __lastActive?: number }).__lastActive || Date.now();
      const timeout = (config?.idleTimeoutSec || 60) * 1000;
      if (Date.now() - last <= timeout) return;
      setTab((prev) => {
        if (prev === "home") return prev;
        setScreenKey((k) => k + 1);
        return "home";
      });
      setGalleryIdx(0);
    }, 1000);
    return () => {
      for (const e of events) window.removeEventListener(e, bumpActivity);
      clearInterval(idle);
    };
  }, [config, bumpActivity]);

  const serverUrl = config?.serverUrl;
  const exhibit = state?.manifest.exhibit;
  const galleryIds = exhibit?.galleryIds || [];
  const adIds = state?.manifest.adIds || [];
  const adsVersion = state?.manifest.adsVersion || "0";
  const specs = exhibit?.specs?.filter((r) => r.label || r.value) || [];
  const hero = mediaUrl(state, exhibit?.heroImageId, serverUrl);
  const video = mediaUrl(state, exhibit?.videoId, serverUrl);
  const audio = mediaUrl(state, exhibit?.audioId, serverUrl);
  const gallerySrc = mediaUrl(state, galleryIds[galleryIdx], serverUrl);
  const asideThumb = galleryIds[0] ? mediaUrl(state, galleryIds[0], serverUrl) : hero;
  const hasAds = adIds.length > 0;
  const adSrc = mediaUrl(state, adIds[adIdx % Math.max(adIds.length, 1)], serverUrl);
  const showWing = tab !== "home" || hasAds;

  useEffect(() => {
    setAdIdx(0);
  }, [adsVersion]);

  useEffect(() => {
    if (!state) return;
    const ids = [
      exhibit?.heroImageId,
      ...(exhibit?.galleryIds || []),
      ...(state.manifest.adIds || []),
    ];
    prefetchImages(ids.map((id) => mediaUrl(state, id, serverUrl)));
  }, [state, exhibit?.heroImageId, exhibit?.galleryIds, serverUrl]);

  useEffect(() => {
    if (adIds.length < 2) return;
    const t = setInterval(() => {
      setAdIdx((i) => (i + 1) % adIds.length);
    }, AD_ROTATE_MS);
    return () => clearInterval(t);
  }, [adIds.length, adsVersion]);

  const statusText = useMemo(() => {
    const parts = [config?.kioskId, syncStatus];
    if (syncMessage) parts.push(syncMessage);
    return parts.filter(Boolean).join(" · ");
  }, [config, syncStatus, syncMessage]);

  const wingPromo = useMemo(() => {
    if (!exhibit || hasAds) return null;
    if (tab === "home" || tab === "about") {
      if (video) {
        return {
          kicker: "Видео",
          title: exhibit.title,
          cta: "Смотреть видео",
          action: () => goTab("video"),
          image: "/video-placeholder.png",
          imageKind: "placeholder" as const,
        };
      }
      return {
        kicker: "Галерея",
        title: exhibit.title,
        cta: "Открыть галерею",
        action: () => goTab("gallery"),
        image: asideThumb || hero,
        imageKind: "photo" as const,
      };
    }
    if (tab === "gallery") {
      return {
        kicker: "Описание",
        title: exhibit.title,
        cta: "Читать описание",
        action: () => goTab("about"),
        image: hero,
        imageKind: "photo" as const,
      };
    }
    return {
      kicker: "Галерея",
      title: exhibit.title,
      cta: "К фотографиям",
      action: () => goTab("gallery"),
      image: asideThumb || hero,
      imageKind: "photo" as const,
    };
  }, [exhibit, tab, video, asideThumb, hero, goTab, hasAds]);

  const rail = (
    <aside className="rail">
      <div className="rail__brand">
        <div className="rail__mark" aria-hidden>
          <StarLogo />
          <span className="rail__mark-ring" />
        </div>
        <div className="rail__brand-text">
          <p className="rail__title">
            Парк
            <span className="rail__title-line">Победы</span>
          </p>
          <p className="rail__eyebrow">
            <span className="rail__eyebrow-rule" aria-hidden />
            Мемориальный комплекс
          </p>
        </div>
      </div>

      <nav className="rail__nav" aria-label="Разделы">
        {NAV.map((item, i) => (
          <button
            key={item.id}
            type="button"
            className={`rail__nav-btn ${tab === item.id ? "is-active" : ""}`}
            onClick={() => goTab(item.id)}
          >
            <span className="rail__nav-idx">{String(i + 1).padStart(2, "0")}</span>
            <span className="rail__nav-icon">
              <NavIcon id={item.id} />
            </span>
            <span className="rail__nav-copy">
              <span className="rail__nav-label">{item.label}</span>
              <span className="rail__nav-hint">{item.hint}</span>
            </span>
            <span className="rail__nav-mark" aria-hidden />
          </button>
        ))}
      </nav>

      <div className="rail__foot">
        <button
          type="button"
          className={`rail__contrast ${hiContrast ? "is-on" : ""}`}
          onClick={() => setHiContrast((v) => !v)}
        >
          Контраст
        </button>
        <div className="rail__meta">
          <strong className="rail__time">{time}</strong>
          <span className="rail__date">{date}</span>
          <span
            className={`rail__sync is-${syncStatus === "ok" ? "ok" : syncStatus === "error" ? "err" : "wait"}`}
            title={statusText}
          >
            {syncStatus === "ok" ? "онлайн" : syncStatus === "error" ? "офлайн" : "синхр."}
          </span>
        </div>
      </div>
    </aside>
  );

  const wing = showWing ? (
    <aside className={`wing ${hasAds ? "wing--ads" : ""}`} aria-label={hasAds ? "Реклама" : undefined}>
      {hasAds ? (
        <div className="ad-slot">
          <div className="ad-slot__frame">
            {adSrc ? (
              <ReadyImage key={adSrc} className="ad-slot__img" src={adSrc} alt="" />
            ) : (
              <div className="wing__pattern" />
            )}
            <div className="ad-slot__veil" aria-hidden />
          </div>
          <div className="ad-slot__bar">
            <p className="ad-slot__kicker">Реклама</p>
            {adIds.length > 1 ? (
              <div className="ad-slot__dots" role="tablist" aria-label="Баннеры">
                {adIds.map((id, i) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={i === adIdx % adIds.length}
                    className={i === adIdx % adIds.length ? "is-active" : ""}
                    onClick={() => setAdIdx(i)}
                  />
                ))}
              </div>
            ) : (
              <span className="ad-slot__count">01</span>
            )}
          </div>
        </div>
      ) : (
        <div className="wing__inner">
          <div className={`wing__media${wingPromo?.imageKind === "placeholder" ? " wing__media--placeholder" : ""}`}>
            {wingPromo?.image ? (
              <ReadyImage src={wingPromo.image} alt="" />
            ) : (
              <div className="wing__pattern" />
            )}
          </div>
          <div className="wing__body">
            <p className="wing__kicker">{wingPromo?.kicker || "Медиа"}</p>
            <p className="wing__title">{wingPromo?.title || "Нет данных"}</p>
            {wingPromo ? (
              <button type="button" className="btn-red btn-red--sm" onClick={wingPromo.action}>
                {wingPromo.cta}
              </button>
            ) : null}
          </div>
        </div>
      )}
    </aside>
  ) : null;

  if (!exhibit) {
    return (
      <div
        className={`shell shell--empty ${hiContrast ? "is-contrast" : ""}`}
        onPointerDown={bumpActivity}
      >
        {rail}
        <main className="stage">
          <section className="panel panel--empty">
            <EmptyBlock
              title="Контент недоступен"
              text="Экспонат не привязан к киоску или ещё не синхронизирован с сервером."
            />
            <p className="panel__hint">{statusText}</p>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div
      className={`shell shell--${tab} ${hasAds ? "shell--with-ads" : ""} ${hiContrast ? "is-contrast" : ""}`}
      onPointerDown={bumpActivity}
    >
      {rail}

      <main className="stage">
        {tab === "home" && (
          <section className="panel panel--home" key={`home-${screenKey}`}>
            <div className="home-hero" aria-hidden={!hero}>
              {hero ? (
                <ReadyImage className="home-hero__img" src={hero} alt="" />
              ) : (
                <div className="home-hero__empty" />
              )}
              <div className="home-hero__veil" />
            </div>
            <div className="home-copy">
              <p className="home-copy__brand">Парк Победы</p>
              <h1 className="home-copy__title">{exhibit.title}</h1>
              {exhibit.summary ? <p className="home-copy__lead">{exhibit.summary}</p> : null}
              <div className="home-copy__actions">
                <button type="button" className="btn-red btn-red--home" onClick={() => goTab("about")}>
                  Описание и характеристики
                </button>
                {nativeShell && config?.game?.exe ? (
                  <button
                    type="button"
                    className="btn-ghost btn-ghost--home"
                    disabled={gameBusy}
                    onClick={() => void startGame()}
                  >
                    {gameBusy ? "Игра запущена…" : config.game.title || "Играть"}
                  </button>
                ) : null}
              </div>
              {gameError ? <p className="home-copy__error">{gameError}</p> : null}
            </div>
          </section>
        )}

        {tab === "about" && (
          <section className="panel panel--about" key={`about-${screenKey}`}>
            <header className="page-head">
              <p className="panel__kicker">Описание</p>
              <h1 className="panel__title panel__title--sm">{exhibit.title}</h1>
              <div className="page-head__rule" />
            </header>
            <div className="panel__scroll">
              <div className="about-top">
                <div className="about-top__ttx">
                  <div className="ttx-head">
                    <p className="about-top__label">ТТХ</p>
                    {specs.length > 0 ? (
                      <span className="ttx-head__count">{String(specs.length).padStart(2, "0")}</span>
                    ) : null}
                  </div>
                  {specs.length > 0 ? (
                    <div className="ttx-sheet">
                      <table className="ttx-table">
                        <tbody>
                          {specs.map((row, i) => (
                            <tr key={`${row.label}-${i}`}>
                              <th scope="row">{row.label}</th>
                              <td>{row.value || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="about-top__empty">Характеристики не заполнены</p>
                  )}
                </div>
                <div className="about-top__side">
                  {hero ? (
                    <figure className="about-top__visual">
                      <ReadyImage src={hero} alt="" />
                      <figcaption className="about-top__cap">
                        <span>Парк Победы</span>
                        <span>{exhibit.title}</span>
                      </figcaption>
                    </figure>
                  ) : (
                    <div className="about-top__visual about-top__visual--empty" />
                  )}
                  {audio ? (
                    <div className="about-audio">
                      <AudioPlayer src={audio} active={tab === "about"} title="Аудиогид" />
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="about-prose">
                <p className="panel__body">{exhibit.body || exhibit.summary}</p>
              </div>
            </div>
          </section>
        )}

        {tab === "gallery" && (
          <section className="panel panel--gallery" key={`gallery-${screenKey}`}>
            <div
              className="gallery-view"
              onPointerDown={(e) => {
                (e.currentTarget as HTMLElement).dataset.px = String(e.clientX);
              }}
              onPointerUp={(e) => {
                if (!galleryIds.length) return;
                const start = Number((e.currentTarget as HTMLElement).dataset.px || 0);
                const dx = e.clientX - start;
                if (Math.abs(dx) < 64) return;
                setGalleryIdx((i) =>
                  dx < 0
                    ? (i + 1) % galleryIds.length
                    : (i - 1 + galleryIds.length) % galleryIds.length
                );
              }}
            >
              <header className="gallery-view__top">
                <div>
                  <p className="panel__kicker">Галерея</p>
                  <h1 className="panel__title panel__title--sm">{exhibit.title}</h1>
                </div>
                <div className="gallery-view__count" aria-live="polite">
                  {galleryIds.length ? (
                    <>
                      <strong>{String(galleryIdx + 1).padStart(2, "0")}</strong>
                      <span>/ {String(galleryIds.length).padStart(2, "0")}</span>
                    </>
                  ) : (
                    <span>нет кадров</span>
                  )}
                </div>
              </header>

              {gallerySrc ? (
                <figure className="gallery-view__figure">
                  <ReadyImage key={gallerySrc} src={gallerySrc} alt="" />
                </figure>
              ) : (
                <EmptyBlock title="Нет фотографий" text="Добавьте кадры галереи в карточке экспоната." />
              )}

              {galleryIds.length > 1 && (
                <>
                  <button
                    type="button"
                    className="gallery-view__nav gallery-view__nav--prev"
                    aria-label="Предыдущее"
                    onClick={() =>
                      setGalleryIdx((i) => (i - 1 + galleryIds.length) % galleryIds.length)
                    }
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    className="gallery-view__nav gallery-view__nav--next"
                    aria-label="Следующее"
                    onClick={() => setGalleryIdx((i) => (i + 1) % galleryIds.length)}
                  >
                    ›
                  </button>
                </>
              )}
            </div>

            {galleryIds.length > 0 && (
              <div className="gallery-strip" role="list">
                {galleryIds.map((id, i) => {
                  const src = mediaUrl(state, id, serverUrl);
                  return (
                    <button
                      key={id}
                      type="button"
                      role="listitem"
                      className={i === galleryIdx ? "is-active" : ""}
                      aria-label={`Фото ${i + 1}`}
                      aria-current={i === galleryIdx ? "true" : undefined}
                      onClick={() => setGalleryIdx(i)}
                    >
                      {src ? <ReadyImage src={src} alt="" /> : <span className="gallery-strip__ph" />}
                      <span className="gallery-strip__idx">{String(i + 1).padStart(2, "0")}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {tab === "video" && (
          <section className="panel panel--video" key={`video-${screenKey}`}>
            <div className="cinema">
              <header className="cinema__top">
                <div>
                  <p className="panel__kicker">Видеоматериал</p>
                  <h1 className="panel__title panel__title--sm">{exhibit.title}</h1>
                </div>
                {video ? (
                  <span className="cinema__badge" aria-hidden>
                    HD
                  </span>
                ) : null}
              </header>

              <div className="cinema__frame">
                {video ? (
                  <VideoPlayer src={video} active={tab === "video"} />
                ) : (
                  <EmptyBlock title="Видео не загружено" text="Прикрепите видеофайл к экспонату в админке." />
                )}
              </div>

              {video ? (
                <p className="cinema__hint">Коснитесь экрана или кнопки «Пауза», чтобы остановить ролик</p>
              ) : null}
            </div>
          </section>
        )}
      </main>

      {wing}
    </div>
  );
}
