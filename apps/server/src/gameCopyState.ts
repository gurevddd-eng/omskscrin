import type { GameCopyDto } from "@stella/shared";

const copyByKey = new Map<string, GameCopyDto>();
const installedByKey = new Map<string, { games: string[]; updatedAt: string }>();

function keyOf(id: string) {
  return id.trim().toLowerCase();
}

function ttlMs(status: GameCopyDto["status"]) {
  if (status === "running") return 12 * 60 * 60 * 1000;
  if (status === "copying" || status === "launching") return 45 * 60 * 1000;
  if (status === "error") return 30 * 60 * 1000;
  // idle with folder = "installed on disk" stays visible longer
  return 6 * 60 * 60 * 1000;
}

function touchKeys(kioskId: string, hostname: string | null | undefined, apply: (key: string) => void) {
  apply(keyOf(kioskId));
  if (hostname && hostname.trim() && keyOf(hostname) !== keyOf(kioskId)) {
    apply(keyOf(hostname));
  }
}

export function setGameCopyState(kioskId: string, hostname: string | null | undefined, state: GameCopyDto) {
  const row: GameCopyDto = {
    status: state.status,
    folder: state.folder ?? null,
    percent: state.percent ?? null,
    copiedBytes: state.copiedBytes ?? null,
    totalBytes: state.totalBytes ?? null,
    message: state.message ?? null,
    updatedAt: state.updatedAt || new Date().toISOString(),
  };
  touchKeys(kioskId, hostname, (key) => copyByKey.set(key, row));
}

export function setInstalledGames(
  kioskId: string,
  hostname: string | null | undefined,
  games: string[] | null | undefined
) {
  const list = Array.isArray(games)
    ? games.map((g) => String(g || "").trim()).filter(Boolean).slice(0, 80)
    : [];
  const row = { games: list, updatedAt: new Date().toISOString() };
  touchKeys(kioskId, hostname, (key) => installedByKey.set(key, row));
}

export function getGameCopyState(kioskId: string, hostname?: string | null): GameCopyDto | null {
  const row = copyByKey.get(keyOf(kioskId)) || (hostname ? copyByKey.get(keyOf(hostname)) : undefined);
  if (!row) return null;
  const at = row.updatedAt ? Date.parse(row.updatedAt) : 0;
  if (!at || Date.now() - at > ttlMs(row.status)) {
    touchKeys(kioskId, hostname, (key) => copyByKey.delete(key));
    return null;
  }
  return row;
}

export function getInstalledGames(kioskId: string, hostname?: string | null): string[] {
  const row =
    installedByKey.get(keyOf(kioskId)) || (hostname ? installedByKey.get(keyOf(hostname)) : undefined);
  if (!row) return [];
  const at = Date.parse(row.updatedAt);
  // Keep folder list for 24h without heartbeat, then drop
  if (!at || Date.now() - at > 24 * 60 * 60 * 1000) {
    touchKeys(kioskId, hostname, (key) => installedByKey.delete(key));
    return [];
  }
  return row.games;
}

export function applyGameCopyToDto<
  T extends { kioskId: string; hostname: string },
>(dto: T): T & { gameCopy: GameCopyDto | null; installedGames: string[] } {
  return {
    ...dto,
    gameCopy: getGameCopyState(dto.kioskId, dto.hostname),
    installedGames: getInstalledGames(dto.kioskId, dto.hostname),
  };
}
