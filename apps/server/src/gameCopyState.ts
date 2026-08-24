import type { GameCopyDto } from "@stella/shared";

const byKey = new Map<string, GameCopyDto>();

function keyOf(id: string) {
  return id.trim().toLowerCase();
}

function ttlMs(status: GameCopyDto["status"]) {
  if (status === "running") return 12 * 60 * 60 * 1000;
  if (status === "copying" || status === "launching") return 45 * 60 * 1000;
  if (status === "error") return 15 * 60 * 1000;
  return 2 * 60 * 1000;
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
  byKey.set(keyOf(kioskId), row);
  if (hostname && hostname.trim() && keyOf(hostname) !== keyOf(kioskId)) {
    byKey.set(keyOf(hostname), row);
  }
}

export function getGameCopyState(kioskId: string, hostname?: string | null): GameCopyDto | null {
  const row = byKey.get(keyOf(kioskId)) || (hostname ? byKey.get(keyOf(hostname)) : undefined);
  if (!row) return null;
  const at = row.updatedAt ? Date.parse(row.updatedAt) : 0;
  if (!at || Date.now() - at > ttlMs(row.status)) {
    byKey.delete(keyOf(kioskId));
    if (hostname) byKey.delete(keyOf(hostname));
    return null;
  }
  return row;
}

export function applyGameCopyToDto<T extends { kioskId: string; hostname: string }>(dto: T): T & { gameCopy: GameCopyDto | null } {
  return {
    ...dto,
    gameCopy: getGameCopyState(dto.kioskId, dto.hostname),
  };
}
