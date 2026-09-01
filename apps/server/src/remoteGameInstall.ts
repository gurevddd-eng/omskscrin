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

async function postAgentGame(
  hostname: string,
  healthPort: number,
  pathName: "/install-game" | "/uninstall-game",
  body: Record<string, unknown> = {}
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

export async function requestKioskGameInstall(id: string, _body: GameBody = {}) {
  const kiosk = await loadKioskWithExhibit(id);
  if (!kiosk) {
    return { ok: false as const, status: 404, message: "Киоск не найден", kiosk: null };
  }
  const agent = await postAgentGame(kiosk.hostname, kiosk.healthPort, "/install-game", {});
    return {
      ok: false as const,
      status: agent.status >= 400 ? agent.status : 400,
      message: agent.message,
      kiosk: enrichKioskDto(mapKiosk(kiosk)),
    };
  }

  const agentMsg = String(agent.json?.message || agent.json?.error || "");
  setGameCopyState(kiosk.kioskId, kiosk.hostname, {
    status: "idle",
    folder: "PatriotGame",
    percent: 100,
    copiedBytes: null,
    totalBytes: null,
    message: agentMsg || `Игра в C:\\PatriotGame`,
    updatedAt: new Date().toISOString(),
  });
  const dto = enrichKioskDto(mapKiosk(kiosk));
  broadcastKioskUpsert(dto);
  void probeKioskById(id).catch(() => null);
  return {
    ok: true as const,
    status: 200,
    message: agentMsg || `Игра найдена в C:\\PatriotGame`,
    kiosk: dto,
  };
}

export async function requestKioskGameUninstall(id: string, _body: GameBody = {}) {
  const kiosk = await loadKioskWithExhibit(id);
  if (!kiosk) {
    return { ok: false as const, status: 404, message: "Киоск не найден", kiosk: null };
  }

  return {
    ok: false as const,
    status: 400,
    message: "Игра предустановлена в C:\\PatriotGame — удаление через Stella недоступно",
    kiosk: enrichKioskDto(mapKiosk(kiosk)),
  };
}
