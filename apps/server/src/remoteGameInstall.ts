import { prisma } from "./prisma.js";
import { mapKiosk, probeKioskById } from "./kioskProbe.js";
import { enrichKioskDto } from "./kioskDtoEnrich.js";
import { setGameCopyState } from "./gameCopyState.js";
import { broadcastKioskUpsert } from "./monitorHub.js";

type GameBody = { folder?: string; exe?: string };

async function loadKioskWithExhibit(id: string) {
  return prisma.kiosk.findUnique({
    where: { id },
    include: {
      exhibit: {
        select: {
          title: true,
          gameTitle: true,
          gameShareFolder: true,
          gameExe: true,
        },
      },
    },
  });
}

function resolveGameSpec(
  body: GameBody,
  exhibit: {
    gameShareFolder: string;
    gameExe: string;
    gameTitle: string;
  } | null
) {
  const folder = String(body.folder || exhibit?.gameShareFolder || "").trim();
  const exe = String(body.exe || exhibit?.gameExe || "").trim();
  return { folder, exe, title: String(exhibit?.gameTitle || "").trim() || folder };
}

async function postAgentGame(
  hostname: string,
  healthPort: number,
  pathName: "/install-game" | "/uninstall-game",
  body: { folder: string; exe?: string }
): Promise<{ ok: boolean; status: number; message: string; json?: Record<string, unknown> }> {
  const port = Number(healthPort) || 47821;
  const url = `http://${hostname}:${port}${pathName}`;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8_000);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    clearTimeout(timer);
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 423) {
      return {
        ok: false,
        status: 423,
        message: String(json.error || "Киоск занят"),
        json,
      };
    }
    if (!res.ok && res.status !== 202) {
      return {
        ok: false,
        status: res.status,
        message: String(json.error || `HTTP ${res.status}`),
        json,
      };
    }
    if (json.ok === false) {
      return {
        ok: false,
        status: res.status || 400,
        message: String(json.error || "Агент отклонил запрос"),
        json,
      };
    }
    return { ok: true, status: res.status, message: "accepted", json };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 502, message: `Агент недоступен: ${msg}` };
  }
}

export async function requestKioskGameInstall(id: string, body: GameBody = {}) {
  const kiosk = await loadKioskWithExhibit(id);
  if (!kiosk) {
    return { ok: false as const, status: 404, message: "Киоск не найден", kiosk: null };
  }
  const { folder, exe, title } = resolveGameSpec(body, kiosk.exhibit);
  if (!folder) {
    return {
      ok: false as const,
      status: 400,
      message: "Не задана папка игры — укажите в экспонате (gameShareFolder) или в запросе",
      kiosk: enrichKioskDto(mapKiosk(kiosk)),
    };
  }
  if (!exe) {
    return {
      ok: false as const,
      status: 400,
      message: "Не задан exe игры — укажите в экспонате (gameExe) или в запросе",
      kiosk: enrichKioskDto(mapKiosk(kiosk)),
    };
  }

  const agent = await postAgentGame(kiosk.hostname, kiosk.healthPort, "/install-game", {
    folder,
    exe,
  });
  if (!agent.ok) {
    return {
      ok: false as const,
      status: agent.status >= 400 ? agent.status : 400,
      message: agent.message,
      kiosk: enrichKioskDto(mapKiosk(kiosk)),
    };
  }

  setGameCopyState(kiosk.kioskId, kiosk.hostname, {
    status: "copying",
    folder,
    percent: null,
    copiedBytes: null,
    totalBytes: null,
    message: `Установка «${title || folder}»…`,
    updatedAt: new Date().toISOString(),
  });
  const dto = enrichKioskDto(mapKiosk(kiosk));
  broadcastKioskUpsert(dto);
  void probeKioskById(id).catch(() => null);
  return {
    ok: true as const,
    status: 202,
    message: `Установка игры «${title || folder}» запущена`,
    kiosk: dto,
  };
}

export async function requestKioskGameUninstall(id: string, body: GameBody = {}) {
  const kiosk = await loadKioskWithExhibit(id);
  if (!kiosk) {
    return { ok: false as const, status: 404, message: "Киоск не найден", kiosk: null };
  }
  const { folder, title } = resolveGameSpec(body, kiosk.exhibit);
  if (!folder) {
    return {
      ok: false as const,
      status: 400,
      message: "Не задана папка игры для удаления",
      kiosk: enrichKioskDto(mapKiosk(kiosk)),
    };
  }

  const agent = await postAgentGame(kiosk.hostname, kiosk.healthPort, "/uninstall-game", {
    folder,
  });
  if (!agent.ok) {
    return {
      ok: false as const,
      status: agent.status >= 400 ? agent.status : 400,
      message: agent.message,
      kiosk: enrichKioskDto(mapKiosk(kiosk)),
    };
  }

  setGameCopyState(kiosk.kioskId, kiosk.hostname, {
    status: "idle",
    folder: null,
    percent: null,
    copiedBytes: null,
    totalBytes: null,
    message: `Удалена · ${title || folder}`,
    updatedAt: new Date().toISOString(),
  });
  const dto = enrichKioskDto(mapKiosk(kiosk));
  broadcastKioskUpsert(dto);
  void probeKioskById(id).catch(() => null);
  return {
    ok: true as const,
    status: 200,
    message: `Игра «${title || folder}» удалена с диска киоска`,
    kiosk: dto,
  };
}
