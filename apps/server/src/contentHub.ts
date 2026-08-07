import type { ServerResponse } from "node:http";

type Client = {
  id: number;
  kioskId: string;
  res: ServerResponse;
};

let nextId = 1;
const clients = new Map<number, Client>();

function writeEvent(res: ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function addContentClient(kioskId: string, res: ServerResponse) {
  const id = nextId++;
  const key = kioskId.trim().toLowerCase();
  clients.set(id, { id, kioskId: key, res });
  res.on("close", () => {
    clients.delete(id);
  });
  return id;
}

export function contentClientCount() {
  return clients.size;
}

/** Notify all connected kiosk UIs to re-check /updates immediately. */
export function broadcastContentSync(payload: {
  reason?: string;
  at?: string;
  exhibitId?: string | null;
} = {}) {
  const data = {
    reason: payload.reason || "content",
    at: payload.at || new Date().toISOString(),
    exhibitId: payload.exhibitId ?? null,
  };
  for (const client of clients.values()) {
    try {
      writeEvent(client.res, "sync", data);
    } catch {
      clients.delete(client.id);
    }
  }
}

export function sendContentHello(res: ServerResponse) {
  writeEvent(res, "hello", { ok: true, at: new Date().toISOString() });
}
