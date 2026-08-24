import type { KioskManifest, KioskUpdates, SyncStatus } from "@stella/shared";
import type { KioskConfig } from "./config";

const MANIFEST_KEY = "stella_kiosk_manifest_v2";
const SOFTWARE_KEY = "stella_kiosk_software_v1";
const DB_NAME = "stella_kiosk_media_v2";
const STORE = "files";
const DOWNLOAD_CONCURRENCY = 6;

export type CachedState = {
  manifest: KioskManifest;
  /** Object URLs keyed by file id (from IndexedDB blobs) */
  fileBlobs: Record<string, string>;
  syncedAt: string;
  /** contentVersion|adsVersion at last successful save */
  syncFingerprint: string;
  /** True when every manifest file is present locally with matching hash */
  complete: boolean;
};

type StoredMeta = {
  manifest: KioskManifest;
  syncedAt: string;
  syncFingerprint?: string;
};

type StoredFile = {
  id: string;
  hash: string;
  mimeType: string;
  blob: Blob;
};

/** Live blob URLs reused across syncs so images are not re-decoded every poll. */
const liveBlobs = new Map<string, { hash: string; url: string }>();

function revokeUrl(url: string) {
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* ignore */
  }
}

function revokeAllLiveBlobs() {
  for (const row of liveBlobs.values()) revokeUrl(row.url);
  liveBlobs.clear();
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onclose = () => {
          dbPromise = null;
        };
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        dbPromise = null;
        reject(req.error || new Error("indexedDB open failed"));
      };
    });
  }
  return dbPromise;
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("indexedDB request failed"));
  });
}

async function idbGet(id: string): Promise<StoredFile | undefined> {
  const db = await openDb();
  return idbReq(db.transaction(STORE, "readonly").objectStore(STORE).get(id));
}

async function idbGetMany(ids: string[]): Promise<Map<string, StoredFile>> {
  const out = new Map<string, StoredFile>();
  if (!ids.length) return out;
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const store = tx.objectStore(STORE);
  await Promise.all(
    ids.map(async (id) => {
      const row = await idbReq(store.get(id));
      if (row) out.set(id, row as StoredFile);
    })
  );
  return out;
}

async function idbPut(file: StoredFile): Promise<void> {
  const db = await openDb();
  await idbReq(db.transaction(STORE, "readwrite").objectStore(STORE).put(file));
}

async function idbDelete(id: string): Promise<void> {
  const db = await openDb();
  await idbReq(db.transaction(STORE, "readwrite").objectStore(STORE).delete(id));
}

async function idbClear(): Promise<void> {
  const db = await openDb();
  await idbReq(db.transaction(STORE, "readwrite").objectStore(STORE).clear());
}

/** Same format as server syncFingerprint: content|ads|settings|timeline */
export function fingerprintOf(
  manifest:
    | {
        contentVersion?: string | null;
        adsVersion?: string | null;
        settingsVersion?: string | null;
        timelineVersion?: string | null;
        exhibit?: { contentVersion?: string | null } | null;
      }
    | null
    | undefined
): string {
  const content =
    manifest?.contentVersion != null && String(manifest.contentVersion).length
      ? String(manifest.contentVersion)
      : manifest?.exhibit?.contentVersion != null && String(manifest.exhibit.contentVersion).length
        ? String(manifest.exhibit.contentVersion)
        : "0";
  const ads =
    manifest?.adsVersion != null && String(manifest.adsVersion).length
      ? String(manifest.adsVersion)
      : "0";
  const settings =
    manifest?.settingsVersion != null && String(manifest.settingsVersion).length
      ? String(manifest.settingsVersion)
      : "0";
  const timeline =
    manifest?.timelineVersion != null && String(manifest.timelineVersion).length
      ? String(manifest.timelineVersion)
      : "0";
  return `${content}|${ads}|${settings}|${timeline}`;
}

function fileHash(file: { hash?: string | null; size?: number; mimeType?: string }) {
  return file.hash || `${file.size ?? 0}:${file.mimeType || ""}`;
}

function blobLooksValid(
  existing: StoredFile | undefined,
  file: { hash?: string | null; size?: number; mimeType?: string }
): boolean {
  if (!existing?.blob || existing.blob.size < 32) return false;
  const expected = fileHash(file);
  return Boolean(existing.hash && expected && existing.hash === expected);
}

function loadManifestOnly(): StoredMeta | null {
  try {
    const raw = localStorage.getItem(MANIFEST_KEY);
    if (!raw) {
      const legacy = localStorage.getItem("stella_kiosk_cache_v1");
      if (!legacy) return null;
      const parsed = JSON.parse(legacy) as CachedState;
      if (parsed?.manifest) {
        const syncedAt = parsed.syncedAt || new Date().toISOString();
        const meta: StoredMeta = {
          manifest: parsed.manifest,
          syncedAt,
          syncFingerprint: fingerprintOf(parsed.manifest),
        };
        localStorage.setItem(MANIFEST_KEY, JSON.stringify(meta));
        return meta;
      }
      return null;
    }
    const meta = JSON.parse(raw) as StoredMeta;
    if (!meta?.manifest) return null;
    if (!meta.syncFingerprint) meta.syncFingerprint = fingerprintOf(meta.manifest);
    return meta;
  } catch {
    return null;
  }
}

function saveManifestOnly(manifest: KioskManifest, syncedAt: string) {
  const meta: StoredMeta = {
    manifest,
    syncedAt,
    syncFingerprint: fingerprintOf(manifest),
  };
  localStorage.setItem(MANIFEST_KEY, JSON.stringify(meta));
  try {
    localStorage.removeItem("stella_kiosk_cache_v1");
  } catch {
    /* ignore */
  }
}

export function getKnownSoftwareVersion(): string | null {
  try {
    return localStorage.getItem(SOFTWARE_KEY);
  } catch {
    return null;
  }
}

export function setKnownSoftwareVersion(version: string) {
  try {
    localStorage.setItem(SOFTWARE_KEY, version);
  } catch {
    /* ignore */
  }
}

async function buildFileMap(manifest: KioskManifest): Promise<{
  fileBlobs: Record<string, string>;
  complete: boolean;
  rebuilt: boolean;
}> {
  // Full IndexedDB → disk replacement: kiosk UI uses /media/:id from the agent.
  // Keep the manifest locally, but do not build blob URLs.
  return { fileBlobs: {}, complete: true, rebuilt: false };
}

/** True when local IndexedDB has every file from the saved manifest. */
export async function isLocalCacheComplete(manifest?: KioskManifest | null): Promise<boolean> {
  // Disk completeness is handled by the agent on-demand caching.
  return Boolean(manifest || loadManifestOnly()?.manifest);
}

export async function loadLocalCache(_serverUrl?: string): Promise<CachedState | null> {
  const meta = loadManifestOnly();
  if (!meta) return null;
  return {
    manifest: meta.manifest,
    fileBlobs: {},
    syncedAt: meta.syncedAt,
    syncFingerprint: meta.syncFingerprint || fingerprintOf(meta.manifest),
    complete: true,
  };
}

export function getStoredFingerprint(): string | null {
  return loadManifestOnly()?.syncFingerprint || null;
}

/** Lightweight check — no media download */
export async function checkUpdates(
  config: KioskConfig,
  localSoftwareVersion?: string | null
): Promise<KioskUpdates | null> {
  try {
    const qs = localSoftwareVersion
      ? `?softwareVersion=${encodeURIComponent(localSoftwareVersion)}`
      : "";
    const res = await fetch(`${config.serverUrl}/api/kiosks/${config.kioskId}/updates${qs}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as KioskUpdates;
  } catch {
    return null;
  }
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  const n = Math.min(limit, Math.max(items.length, 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

export type SyncProgress = {
  done: number;
  total: number;
  downloading: number;
};

/**
 * Pull missing media from server into IndexedDB. Already-cached files stay local.
 * Does not rebuild blob URLs / React state when nothing new was downloaded.
 */
export async function syncContent(
  config: KioskConfig,
  opts?: {
    onProgress?: (p: SyncProgress) => void;
    /** Skip network if local fingerprint already matches and cache is complete */
    knownFingerprint?: string | null;
  }
): Promise<{
  state: CachedState | null;
  syncStatus: SyncStatus;
  syncMessage: string | null;
  /** True when fileBlobs / manifest on screen should be replaced */
  changed: boolean;
}> {
  try {
    const res = await fetch(`${config.serverUrl}/api/kiosks/${config.kioskId}/manifest`, {
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        state: null,
        syncStatus: "error",
        syncMessage: `manifest ${res.status}`,
        changed: false,
      };
    }

    const manifest = (await res.json()) as KioskManifest;
    const remoteFp = fingerprintOf(manifest);
    const localMeta = loadManifestOnly();

    // Offline/Disk replacement: manifest is our local source of truth.
    if (opts?.knownFingerprint && opts.knownFingerprint === remoteFp && localMeta?.syncFingerprint === remoteFp) {
      const cached = await loadLocalCache();
      return {
        state: cached,
        syncStatus: "ok",
        syncMessage: null,
        changed: false,
      };
    }

    const syncedAt = new Date().toISOString();
    saveManifestOnly(manifest, syncedAt);

    const changed = !localMeta || localMeta.syncFingerprint !== remoteFp;
    const state: CachedState = {
      manifest,
      fileBlobs: {},
      syncedAt,
      syncFingerprint: remoteFp,
      complete: true,
    };

    return {
      state,
      syncStatus: "ok",
      syncMessage: changed ? "обновлено (manifest)" : null,
      changed,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "sync failed";
    const cached = await loadLocalCache();
    if (cached) {
      return {
        state: cached,
        syncStatus: "ok",
        syncMessage: "офлайн — локальный кэш",
        changed: false,
      };
    }
    return {
      state: null,
      syncStatus: "error",
      syncMessage: msg,
      changed: false,
    };
  }
}

export async function sendHeartbeat(
  config: KioskConfig,
  payload: {
    contentVersion: string | null;
    syncStatus: SyncStatus;
    syncMessage: string | null;
  }
): Promise<{ syncFingerprint?: string } | null> {
  let remote: { syncFingerprint?: string } | null = null;
  try {
    const res = await fetch(`${config.serverUrl}/api/kiosks/${config.kioskId}/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        appVersion: config.appVersion,
        hostname: config.hostname,
      }),
    });
    if (res.ok) {
      remote = (await res.json()) as { syncFingerprint?: string };
    }
  } catch {
    /* offline */
  }

  try {
    await fetch(`http://127.0.0.1:${config.healthPort}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    /* agent may be off */
  }

  return remote;
}

/** Prefer agent disk cache on the hall PC; CMS URL in admin preview / fallback. */
export function mediaUrl(
  state: CachedState | null,
  fileId: string | null | undefined,
  serverUrl?: string,
  agent?: { port: number } | null
) {
  if (!fileId) return null;
  if (agent?.port) {
    return `http://127.0.0.1:${agent.port}/media/${encodeURIComponent(fileId)}`;
  }
  const blob = state?.fileBlobs?.[fileId];
  if (blob) return blob;
  const file = state?.manifest?.files?.find((f) => f.id === fileId);
  if (!file?.url) return null;
  if (file.url.startsWith("http")) return file.url;
  // Admin preview / same-origin API: allow relative URLs without serverUrl base.
  if (file.url.startsWith("/")) return file.url;
  const base = String(serverUrl || "").replace(/\/$/, "");
  if (!base) return null;
  return `${base}${file.url}`;
}

/** Dev helper — not required at runtime */
export async function clearMediaCache() {
  revokeAllLiveBlobs();
  await idbClear();
  localStorage.removeItem(MANIFEST_KEY);
  localStorage.removeItem("stella_kiosk_cache_v1");
}
