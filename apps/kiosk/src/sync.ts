import type { KioskManifest, KioskUpdates, SyncStatus } from "@stella/shared";
import type { KioskConfig } from "./config";

const MANIFEST_KEY = "stella_kiosk_manifest_v2";
const SOFTWARE_KEY = "stella_kiosk_software_v1";
const DB_NAME = "stella_kiosk_media_v2";
const STORE = "files";
const DOWNLOAD_CONCURRENCY = 4;

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

let objectUrls: string[] = [];

function revokeObjectUrls(urls: string[]) {
  for (const u of urls) {
    try {
      URL.revokeObjectURL(u);
    } catch {
      /* ignore */
    }
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("indexedDB open failed"));
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("indexedDB request failed"));
  });
}

async function idbGet(id: string): Promise<StoredFile | undefined> {
  const db = await openDb();
  try {
    return await idbReq(db.transaction(STORE, "readonly").objectStore(STORE).get(id));
  } finally {
    db.close();
  }
}

async function idbPut(file: StoredFile): Promise<void> {
  const db = await openDb();
  try {
    await idbReq(db.transaction(STORE, "readwrite").objectStore(STORE).put(file));
  } finally {
    db.close();
  }
}

async function idbDelete(id: string): Promise<void> {
  const db = await openDb();
  try {
    await idbReq(db.transaction(STORE, "readwrite").objectStore(STORE).delete(id));
  } finally {
    db.close();
  }
}

async function idbClear(): Promise<void> {
  const db = await openDb();
  try {
    await idbReq(db.transaction(STORE, "readwrite").objectStore(STORE).clear());
  } finally {
    db.close();
  }
}

/** Same format as server syncFingerprint: contentVersion|adsVersion|settingsVersion */
export function fingerprintOf(
  manifest:
    | {
        contentVersion?: string | null;
        adsVersion?: string | null;
        settingsVersion?: string | null;
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
  return `${content}|${ads}|${settings}`;
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
}> {
  const prevUrls = objectUrls;
  objectUrls = [];
  const map: Record<string, string> = {};
  let complete = true;

  for (const f of manifest.files || []) {
    const stored = await idbGet(f.id);
    if (blobLooksValid(stored, f) && stored?.blob) {
      const url = URL.createObjectURL(stored.blob);
      objectUrls.push(url);
      map[f.id] = url;
    } else {
      complete = false;
    }
  }

  // Revoke after new URLs exist so React can swap without flash of broken blobs
  revokeObjectUrls(prevUrls);
  return { fileBlobs: map, complete };
}

/** True when local IndexedDB has every file from the saved manifest. */
export async function isLocalCacheComplete(manifest?: KioskManifest | null): Promise<boolean> {
  const m = manifest || loadManifestOnly()?.manifest;
  if (!m) return false;
  for (const f of m.files || []) {
    const stored = await idbGet(f.id);
    if (!blobLooksValid(stored, f)) return false;
  }
  return true;
}

export async function loadLocalCache(_serverUrl?: string): Promise<CachedState | null> {
  const meta = loadManifestOnly();
  if (!meta) return null;
  try {
    const { fileBlobs, complete } = await buildFileMap(meta.manifest);
    return {
      manifest: meta.manifest,
      fileBlobs,
      syncedAt: meta.syncedAt,
      syncFingerprint: meta.syncFingerprint || fingerprintOf(meta.manifest),
      complete,
    };
  } catch {
    return {
      manifest: meta.manifest,
      fileBlobs: {},
      syncedAt: meta.syncedAt,
      syncFingerprint: meta.syncFingerprint || fingerprintOf(meta.manifest),
      complete: false,
    };
  }
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

/**
 * Pull manifest + media from server, persist to localStorage + IndexedDB.
 * Skips files whose hash already matches local cache.
 */
export async function syncContent(config: KioskConfig): Promise<{
  state: CachedState | null;
  syncStatus: SyncStatus;
  syncMessage: string | null;
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
      };
    }

    const manifest = (await res.json()) as KioskManifest;
    const files = manifest.files || [];
    const keep = new Set(files.map((f) => f.id));
    const base = config.serverUrl.replace(/\/$/, "");

    const results = await mapPool(files, DOWNLOAD_CONCURRENCY, async (file) => {
      const existing = await idbGet(file.id);
      if (blobLooksValid(existing, file)) {
        return null as string | null;
      }

      const url = file.url.startsWith("http") ? file.url : `${base}${file.url}`;
      try {
        const fr = await fetch(url, { cache: "no-store", mode: "cors" });
        if (!fr.ok) return `${file.filename || file.id} (${fr.status})`;
        const blob = await fr.blob();
        if (blob.size < 32) return `${file.filename || file.id} (empty body)`;
        await idbPut({
          id: file.id,
          hash: fileHash(file),
          mimeType: file.mimeType || blob.type || "application/octet-stream",
          blob,
        });
        return null;
      } catch (e) {
        return `${file.filename || file.id}: ${e instanceof Error ? e.message : "fetch failed"}`;
      }
    });

    const failed = results.filter((x): x is string => Boolean(x));

    const prev = loadManifestOnly();
    if (prev?.manifest?.files) {
      for (const f of prev.manifest.files) {
        if (!keep.has(f.id)) await idbDelete(f.id);
      }
    }

    const syncedAt = new Date().toISOString();
    saveManifestOnly(manifest, syncedAt);
    const { fileBlobs, complete } = await buildFileMap(manifest);
    const state: CachedState = {
      manifest,
      fileBlobs,
      syncedAt,
      syncFingerprint: fingerprintOf(manifest),
      complete,
    };

    if (failed.length || !complete) {
      return {
        state,
        syncStatus: "error",
        syncMessage: failed.length
          ? `частично: не скачано ${failed.length} файл(ов)`
          : "локальный кэш неполный",
      };
    }

    return { state, syncStatus: "ok", syncMessage: null };
  } catch (e) {
    return {
      state: null,
      syncStatus: "error",
      syncMessage: e instanceof Error ? e.message : "sync failed",
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
) {
  try {
    await fetch(`${config.serverUrl}/api/kiosks/${config.kioskId}/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        appVersion: config.appVersion,
        hostname: config.hostname,
      }),
    });
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
}

/** Local blob URL only — no live network streaming. */
export function mediaUrl(
  state: CachedState | null,
  fileId: string | null | undefined,
  _serverUrl?: string
) {
  if (!state || !fileId) return null;
  return state.fileBlobs[fileId] || null;
}

/** Dev helper — not required at runtime */
export async function clearMediaCache() {
  revokeObjectUrls(objectUrls);
  objectUrls = [];
  await idbClear();
  localStorage.removeItem(MANIFEST_KEY);
  localStorage.removeItem("stella_kiosk_cache_v1");
}
