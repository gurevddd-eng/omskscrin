import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { SyncStatus } from "@stella/shared";
import { normalizeHhMm, parseThemeMode, resolveEffectiveTheme } from "@stella/shared";
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
import { sanitizeExhibitBody } from "./sanitizeHtml";

type Tab = "home" | "about" | "gallery" | "video" | "timeline";

const AD_ROTATE_MS = 8000;

/** Poll interval for content version checks. Honors kiosk.json (e.g. 60). */
function contentPollSec(config: { syncIntervalSec: number }, errored: boolean) {
  const configured = Number(config.syncIntervalSec);
  const n = Number.isFinite(configured) && configured > 0 ? configured : 60;
  if (errored) return Math.min(20, Math.max(10, n));
  return Math.max(15, Math.min(n, 300));
}

const NAV: { id: Tab; label: string }[] = [
  { id: "home", label: "Главная" },
  { id: "about", label: "Описание" },
  { id: "gallery", label: "Галерея" },
  { id: "video", label: "Видео" },
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

/** Isolated so 1Hz clock ticks do not re-render the whole kiosk tree. */
function RailClock({
  syncStatus,
  statusText,
}: {
  syncStatus: SyncStatus;
  statusText: string;
}) {
  const { time, date } = useClock();
  return (
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
  );
}

function StarLogo() {
  return (
    <svg className="rail__star" viewBox="0 0 80 80" aria-hidden>
      <defs>
        <linearGradient id="star-metal" x1="40" y1="4" x2="40" y2="76" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffe9a8" />
          <stop offset="45%" stopColor="#e0b33a" />
          <stop offset="100%" stopColor="#9a7410" />
        </linearGradient>
        <linearGradient id="star-crimson" x1="22" y1="10" x2="58" y2="70" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ff5a5a" />
          <stop offset="40%" stopColor="#e30613" />
          <stop offset="100%" stopColor="#8f000c" />
        </linearGradient>
        <radialGradient id="star-core" cx="40" cy="38" r="14" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fff6c8" stopOpacity="0.95" />
          <stop offset="55%" stopColor="#ffd36a" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#ffd36a" stopOpacity="0" />
        </radialGradient>
      </defs>

      <g className="rail__star-rays" aria-hidden>
        <path
          d="M40 6v10M40 64v10M6 40h10M64 40h10M16.5 16.5l7 7M56.5 56.5l7 7M63.5 16.5l-7 7M23.5 56.5l-7 7"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </g>

      <g className="rail__star-body">
        <path
          className="rail__star-rim"
          fill="url(#star-metal)"
          d="M40 5l9.2 22.4H74L53.6 41.2l6.8 23.2L40 50.2 19.6 64.4l6.8-23.2L6 27.4h24.8L40 5z"
        />
        <path
          className="rail__star-face"
          fill="url(#star-crimson)"
          d="M40 12.5l7.1 17.4H67l-16.1 11.7 5.8 19.5L40 48.8 23.3 61.1l5.8-19.5L13 29.9h19.9L40 12.5z"
        />
        <path
          className="rail__star-sheen"
          d="M40 15.2l3.4 9.8h.2L52 25.2l-7.4 5.4.8 2.8L40 29.6V15.2z"
        />
        <circle className="rail__star-core" cx="40" cy="38" r="14" fill="url(#star-core)" />
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
  const [timelinePageId, setTimelinePageId] = useState<string | null>(null);
  const gallerySwipe = useRef<{
    id: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const timelineSwipe = useRef<{
    id: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const [adIdx, setAdIdx] = useState(0);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("unknown");
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [screenKey, setScreenKey] = useState(0);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      const saved = localStorage.getItem("stella_kiosk_theme_v1");
      return saved === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  });
  const [themeMode, setThemeMode] = useState<"manual" | "light" | "dark" | "schedule">("manual");
  const [themeDarkFrom, setThemeDarkFrom] = useState("20:00");
  const [themeDarkTo, setThemeDarkTo] = useState("08:00");

  const toggleTheme = useCallback(() => {
    if (themeMode !== "manual") return;
    setTheme((prev) => {
      const next = prev === "light" ? "dark" : "light";
      try {
        localStorage.setItem("stella_kiosk_theme_v1", next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [themeMode]);

  const applyServerTheme = useCallback(
    (updates: {
      themeMode?: string;
      theme?: "light" | "dark" | null;
      themeDarkFrom?: string;
      themeDarkTo?: string;
    }) => {
      const mode = parseThemeMode(updates.themeMode);
      setThemeMode(mode);
      if (updates.themeDarkFrom) setThemeDarkFrom(normalizeHhMm(updates.themeDarkFrom, "20:00"));
      if (updates.themeDarkTo) setThemeDarkTo(normalizeHhMm(updates.themeDarkTo, "08:00"));
      if (mode === "manual") return;
      const next =
        updates.theme === "dark" || updates.theme === "light"
          ? updates.theme
          : resolveEffectiveTheme({
              mode,
              darkFrom: updates.themeDarkFrom || themeDarkFrom,
              darkTo: updates.themeDarkTo || themeDarkTo,
            }) || "light";
      setTheme(next);
      try {
        localStorage.setItem("stella_kiosk_theme_v1", next);
      } catch {
        /* ignore */
      }
    },
    [themeDarkFrom, themeDarkTo]
  );

  useEffect(() => {
    if (themeMode !== "schedule") return;
    const tick = () => {
      const next = resolveEffectiveTheme({
        mode: "schedule",
        darkFrom: themeDarkFrom,
        darkTo: themeDarkTo,
      });
      if (!next) return;
      setTheme((prev) => (prev === next ? prev : next));
    };
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [themeMode, themeDarkFrom, themeDarkTo]);
  const [nativeShell, setNativeShell] = useState(false);
  const [gameBusy, setGameBusy] = useState(false);
  const [gameError, setGameError] = useState<string | null>(null);

  const bumpActivity = useCallback(() => {
    (window as unknown as { __lastActive?: number }).__lastActive = Date.now();
  }, []);

  const goTab = useCallback((next: Tab) => {
    setTab((prev) => {
      if (prev === next) return prev;
      setScreenKey((k) => k + 1);
      return next;
    });
    if (next !== "timeline") setTimelinePageId(null);
  }, []);

  const goTimeline = useCallback((pageId: string) => {
    setTimelinePageId(pageId);
    setTab((prev) => {
      if (prev === "timeline") {
        setScreenKey((k) => k + 1);
        return prev;
      }
      setScreenKey((k) => k + 1);
      return "timeline";
    });
  }, []);

  useEffect(() => {
    void loadConfig().then((cfg) => setConfig(cfg));
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
    let forceFullSync = false;
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

    let syncBusy = false;
    let syncQueued = false;

    function scheduleNext(delaySec: number) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void runSync(), delaySec * 1000);
    }

    function requestSyncSoon() {
      if (stopped) return;
      if (syncBusy) {
        syncQueued = true;
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void runSync(), 120);
    }

    async function runSync() {
      if (stopped || syncBusy) {
        if (syncBusy) syncQueued = true;
        return;
      }
      syncBusy = true;
      syncQueued = false;
      try {
        await tickSync();
      } finally {
        syncBusy = false;
        if (stopped) return;
        if (syncQueued) {
          syncQueued = false;
          scheduleNext(0.2);
        }
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

      if (updates) {
        applyServerTheme(updates);
      }

      const localFingerprint = lastContentVersion;
      const remoteFingerprint =
        updates?.syncFingerprint ??
        (updates
          ? `${updates.contentVersion ?? "0"}|${updates.adsVersion ?? "0"}|${updates.settingsVersion ?? "0"}|${updates.timelineVersion ?? "0"}`
          : null);

      const offline = updates == null;
      const haveUsableCache = localFingerprint != null && !localIncomplete;

      const serverDiffers =
        !offline &&
        remoteFingerprint != null &&
        localFingerprint != null &&
        remoteFingerprint !== localFingerprint;

      // Settings-only fingerprint change: apply flags without rebuilding media blobs
      if (serverDiffers && updates && lastContentVersion) {
        const localParts = String(lastContentVersion).split("|");
        const remoteParts = String(remoteFingerprint).split("|");
        const contentSame = (localParts[0] || "0") === (remoteParts[0] || "0");
        const adsSame = (localParts[1] || "0") === (remoteParts[1] || "0");
        const timelineSame = (localParts[3] || "0") === (remoteParts[3] || "0");
        // settings is index 2
        if (contentSame && adsSame && timelineSame) {
          lastContentVersion = remoteFingerprint;
          forceFullSync = false;
          setSyncStatus("ok");
          setSyncMessage(null);
          await sendHeartbeat(config!, {
            contentVersion: lastExhibitVersion,
            syncStatus: "ok",
            syncMessage: null,
          });
          scheduleNext(contentPollSec(config!, false));
          return;
        }
      }

      // Offline with a full local cache: keep UI as-is (do not re-fetch / revoke blob URLs)
      if (offline && haveUsableCache) {
        forceFullSync = false;
        setSyncStatus("ok");
        setSyncMessage("офлайн — локальный кэш");
        scheduleNext(contentPollSec(config!, true));
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
        const hb = await sendHeartbeat(config!, {
          contentVersion: lastExhibitVersion,
          syncStatus: lastSyncStatus,
          syncMessage: null,
        });
        if (
          hb?.syncFingerprint &&
          lastContentVersion &&
          hb.syncFingerprint !== lastContentVersion
        ) {
          requestSyncSoon();
          return;
        }
        scheduleNext(contentPollSec(config!, false));
        return;
      }

      const result = await syncContent(config!, {
        knownFingerprint: lastContentVersion,
        onProgress: (p) => {
          if (p.downloading <= 0) return;
          setSyncStatus("unknown");
          setSyncMessage(`загрузка на устройство ${p.done}/${p.total}`);
        },
      });
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
        // Only remount media when files actually changed — otherwise UI reloads from "network"
        if (result.changed || !haveUsableCache) {
          setState(result.state);
        }
        lastSyncStatus = result.syncStatus;
        setSyncStatus(result.syncStatus);
        setSyncMessage(
          result.syncStatus === "ok" && result.state.complete
            ? result.syncMessage || "локальный кэш"
            : result.syncMessage
        );
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
      scheduleNext(contentPollSec(config!, lastSyncStatus === "error" || offline));
    }

    const hbTimer = setInterval(() => {
      void (async () => {
        const hb = await sendHeartbeat(config, {
          contentVersion: lastExhibitVersion,
          syncStatus: lastSyncStatus,
          syncMessage: null,
        });
        if (
          hb?.syncFingerprint &&
          lastContentVersion &&
          hb.syncFingerprint !== lastContentVersion
        ) {
          requestSyncSoon();
        }
      })();
    }, Math.max(15, config.heartbeatIntervalSec || 30) * 1000);

    let events: EventSource | null = null;
    let eventsRetry: ReturnType<typeof setTimeout> | null = null;

    function connectEvents() {
      if (stopped || !config?.serverUrl || !config.kioskId) return;
      try {
        events?.close();
      } catch {
        /* ignore */
      }
      const url = `${config.serverUrl.replace(/\/$/, "")}/api/kiosks/${encodeURIComponent(config.kioskId)}/events`;
      events = new EventSource(url);
      events.addEventListener("sync", () => {
        requestSyncSoon();
      });
      events.onerror = () => {
        try {
          events?.close();
        } catch {
          /* ignore */
        }
        events = null;
        if (stopped) return;
        if (eventsRetry) clearTimeout(eventsRetry);
        eventsRetry = setTimeout(connectEvents, 5_000);
      };
    }
    connectEvents();

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
          setSyncMessage("локальный кэш");
        }
      }
      await runSync();
    })();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (eventsRetry) clearTimeout(eventsRetry);
      clearInterval(hbTimer);
      try {
        events?.close();
      } catch {
        /* ignore */
      }
    };
  }, [config, applyServerTheme]);

  useEffect(() => {
    bumpActivity();
    const events = ["pointerdown", "touchstart", "keydown"] as const;
    for (const e of events) window.addEventListener(e, bumpActivity);
    const idle = setInterval(() => {
      const last = (window as unknown as { __lastActive?: number }).__lastActive || Date.now();
      const idleSec = Number(config?.idleTimeoutSec);
      // 10 min default; migrate legacy 60s from older kiosk.json without rewriting every PC
      const resolved =
        !Number.isFinite(idleSec) || idleSec <= 0 || idleSec === 60 ? 600 : idleSec;
      const timeout = resolved * 1000;
      if (Date.now() - last <= timeout) return;
      setTab((prev) => {
        // Chronicle pages stay open — visitors often read without touching the screen
        if (prev === "home" || prev === "timeline") return prev;
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
  const galleryCount = galleryIds.length;
  const timelinePages = state?.manifest.timelinePages ?? [];
  const activeTimeline =
    timelinePages.find((p) => p.id === timelinePageId) || timelinePages[0] || null;

  useEffect(() => {
    if (!timelinePages.length) {
      setTimelinePageId(null);
      return;
    }
    if (timelinePageId && timelinePages.some((p) => p.id === timelinePageId)) return;
    setTimelinePageId(timelinePages[0]!.id);
  }, [timelinePages, timelinePageId]);

  const onGalleryPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (galleryCount < 2) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    gallerySwipe.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, [galleryCount]);

  const onGalleryPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const s = gallerySwipe.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > 12 || Math.abs(dy) > 12) s.moved = true;
  }, []);

  const endGallerySwipe = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const s = gallerySwipe.current;
      if (!s || s.id !== e.pointerId) return;
      gallerySwipe.current = null;
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        /* ignore */
      }
      if (galleryCount < 2) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dx) < 48) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.1) return;
      setGalleryIdx((i) =>
        dx < 0 ? (i + 1) % galleryCount : (i - 1 + galleryCount) % galleryCount
      );
    },
    [galleryCount]
  );

  const onTimelinePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (timelinePages.length < 2) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      timelineSwipe.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    },
    [timelinePages.length]
  );

  const onTimelinePointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const s = timelineSwipe.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > 12 || Math.abs(dy) > 12) s.moved = true;
  }, []);

  const endTimelineSwipe = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const s = timelineSwipe.current;
      if (!s || s.id !== e.pointerId) return;
      timelineSwipe.current = null;
      if (timelinePages.length < 2) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      // Horizontal page flip; ignore mostly-vertical scroll of the image stack
      if (Math.abs(dx) < 56) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.15) return;
      const curId = timelinePageId || timelinePages[0]?.id;
      const idx = Math.max(
        0,
        timelinePages.findIndex((p) => p.id === curId)
      );
      const nextIdx =
        dx < 0
          ? (idx + 1) % timelinePages.length
          : (idx - 1 + timelinePages.length) % timelinePages.length;
      const next = timelinePages[nextIdx];
      if (next) goTimeline(next.id);
    },
    [timelinePages, timelinePageId, goTimeline]
  );

  useEffect(() => {
    function onWinUp(ev: PointerEvent) {
      const s = timelineSwipe.current;
      if (!s || s.id !== ev.pointerId) return;
      // Synthetic target for shared end handler shape
      endTimelineSwipe({
        pointerId: ev.pointerId,
        clientX: ev.clientX,
        clientY: ev.clientY,
        currentTarget: document.body,
      } as unknown as ReactPointerEvent<HTMLElement>);
    }
    window.addEventListener("pointerup", onWinUp);
    window.addEventListener("pointercancel", onWinUp);
    return () => {
      window.removeEventListener("pointerup", onWinUp);
      window.removeEventListener("pointercancel", onWinUp);
    };
  }, [endTimelineSwipe]);

  const showWing =
    (tab !== "home" &&
      tab !== "about" &&
      tab !== "gallery" &&
      tab !== "video" &&
      tab !== "timeline") ||
    hasAds;

  useEffect(() => {
    setAdIdx(0);
  }, [adsVersion]);

  useEffect(() => {
    if (!state) return;
    // Prefetch only what the user is likely to open next — not every timeline page.
    const timelineActive = state.manifest.timelinePages?.find((p) => p.id === timelinePageId);
    const ids = [
      exhibit?.heroImageId,
      ...(exhibit?.galleryIds || []).slice(0, 4),
      ...(state.manifest.adIds || []).slice(0, 2),
      ...(timelineActive?.imageIds || []).slice(0, 3),
    ];
    prefetchImages(ids.map((id) => mediaUrl(state, id, serverUrl)));
  }, [state, exhibit?.heroImageId, exhibit?.galleryIds, serverUrl, timelinePageId]);

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
    if (tab === "home") {
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
    if (tab === "about" || tab === "gallery") return null;
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
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`rail__nav-btn ${tab === item.id ? "is-active" : ""}`}
            onClick={() => goTab(item.id)}
          >
            <span className="rail__nav-icon">
              <NavIcon id={item.id} />
            </span>
            <span className="rail__nav-label">{item.label}</span>
            <span className="rail__nav-mark" aria-hidden />
          </button>
        ))}

        {timelinePages.length > 0 ? (
          <div className="rail__chronicle" aria-label="Хроника">
            <p className="rail__chronicle-label">Хроника</p>
            <div className="rail__years" role="list">
              {timelinePages.map((page) => {
                const active = tab === "timeline" && activeTimeline?.id === page.id;
                return (
                  <button
                    key={page.id}
                    type="button"
                    role="listitem"
                    className={`rail__year-btn ${active ? "is-active" : ""}`}
                    aria-current={active ? "page" : undefined}
                    onClick={() => goTimeline(page.id)}
                  >
                    <span className="rail__year-label">{page.label}</span>
                    <span className="rail__year-mark" aria-hidden />
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </nav>

      <div className="rail__foot">
        {themeMode === "manual" ? (
          <button
            type="button"
            className="rail__theme"
            onClick={toggleTheme}
            aria-label={theme === "light" ? "Включить тёмную тему" : "Включить светлую тему"}
          >
            <span className="rail__theme-label">Тема</span>
            <span className="rail__theme-value">{theme === "light" ? "Светлая" : "Тёмная"}</span>
            <span className="rail__theme-switch" data-theme={theme} aria-hidden>
              <span className="rail__theme-knob" />
            </span>
          </button>
        ) : (
          <div className="rail__theme rail__theme--locked" aria-label="Тема задана с сервера">
            <span className="rail__theme-label">Тема</span>
            <span className="rail__theme-value">{theme === "light" ? "Светлая" : "Тёмная"}</span>
          </div>
        )}
        <RailClock syncStatus={syncStatus} statusText={statusText} />
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

  if (!exhibit && tab !== "timeline") {
    return (
      <div
        className={`shell shell--empty ${theme === "dark" ? "theme-dark" : "theme-light"}`}
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
      className={`shell shell--${tab} ${hasAds ? "shell--with-ads" : ""} ${theme === "dark" ? "theme-dark" : "theme-light"}`}
      onPointerDown={bumpActivity}
    >
      {rail}

      <main className="stage">
        {tab === "timeline" && (
          <section
            className="panel panel--timeline"
            key={`timeline-${activeTimeline?.id || "x"}-${screenKey}`}
            onPointerDown={onTimelinePointerDown}
            onPointerMove={onTimelinePointerMove}
            onPointerUp={endTimelineSwipe}
            onPointerCancel={endTimelineSwipe}
          >
            {activeTimeline?.imageIds?.length ? (
              <div className="timeline-stack">
                {activeTimeline.imageIds.map((id) => {
                  const src = mediaUrl(state, id, serverUrl);
                  return src ? (
                    <ReadyImage key={id} className="timeline-stack__img" src={src} alt="" />
                  ) : null;
                })}
              </div>
            ) : (
              <EmptyBlock
                title={activeTimeline?.label || "Хроника"}
                text="Для этой страницы ещё не загружены изображения. Настройте раздел «Хроника» в админке."
              />
            )}
          </section>
        )}

        {exhibit && tab === "home" && (
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

        {exhibit && tab === "about" && (
          <section className="panel panel--about" key={`about-${screenKey}`}>
            <header className="about-head">
              <p className="panel__kicker">Описание</p>
              <h1 className="panel__title panel__title--sm">{exhibit.title}</h1>
              <div className="page-head__rule" />
            </header>

            <div className="panel__scroll">
              <div className="about-top">
                <section className="about-ttx" aria-label="Характеристики">
                  <header className="about-ttx__head">
                    <p className="about-ttx__label">Характеристики</p>
                    {specs.length > 0 ? (
                      <span className="about-ttx__count">{String(specs.length).padStart(2, "0")}</span>
                    ) : null}
                  </header>
                  {specs.length > 0 ? (
                    <dl className="about-ttx__list about-ttx__list--stack">
                      {specs.map((row, i) => (
                        <div className="about-ttx__row" key={`${row.label}-${i}`}>
                          <dt>{row.label}</dt>
                          <dd>{row.value || "—"}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="about-ttx__empty">Характеристики не заполнены</p>
                  )}
                </section>

                <aside className="about-media">
                  {hero ? (
                    <figure className="about-hero">
                      <ReadyImage className="about-hero__img" src={hero} alt="" />
                      <figcaption className="about-hero__cap">Парк Победы</figcaption>
                    </figure>
                  ) : (
                    <div className="about-hero about-hero--empty" aria-hidden />
                  )}
                  {audio ? (
                    <div className="about-audio">
                      <AudioPlayer src={audio} active={tab === "about"} title="Аудиогид" />
                    </div>
                  ) : null}
                </aside>
              </div>

              <div className="about-read">
                {(() => {
                  const html = sanitizeExhibitBody(exhibit.body || exhibit.summary);
                  if (!html) {
                    return <p className="panel__body panel__body--empty">Текст не заполнен</p>;
                  }
                  return (
                    <div
                      className="panel__body panel__body--rich"
                      dangerouslySetInnerHTML={{ __html: html }}
                    />
                  );
                })()}
              </div>
            </div>
          </section>
        )}

        {exhibit && tab === "gallery" && (
          <section className="panel panel--gallery" key={`gallery-${screenKey}`}>
            <div className="gallery-view">
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
                <figure
                  className="gallery-view__figure"
                  onPointerDown={onGalleryPointerDown}
                  onPointerMove={onGalleryPointerMove}
                  onPointerUp={endGallerySwipe}
                  onPointerCancel={endGallerySwipe}
                >
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

        {exhibit && tab === "video" && (
          <section className="panel panel--video" key={`video-${screenKey}`}>
            <header className="video-head">
              <p className="panel__kicker">Видео</p>
              <h1 className="panel__title panel__title--sm">{exhibit.title}</h1>
              <div className="page-head__rule" />
            </header>

            <div className="video-stage">
              {video ? (
                <VideoPlayer src={video} active={tab === "video"} title={exhibit.title} />
              ) : (
                <EmptyBlock
                  title="Видео не загружено"
                  text="Прикрепите ролик к экспонату в админке — он появится здесь."
                />
              )}
            </div>
          </section>
        )}
      </main>

      {wing}
    </div>
  );
}
