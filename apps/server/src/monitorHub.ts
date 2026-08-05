import type { ServerResponse } from "node:http";
import type { KioskDto } from "@stella/shared";

type Client = {
  id: number;
  res: ServerResponse;
};

let nextId = 1;
const clients = new Map<number, Client>();

function writeEvent(res: ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function addMonitorClient(res: ServerResponse) {
  const id = nextId++;
  clients.set(id, { id, res });
  res.on("close", () => {
    clients.delete(id);
  });
  return id;
}

export function broadcastMonitor(event: string, data: unknown) {
  for (const client of clients.values()) {
    try {
      writeEvent(client.res, event, data);
    } catch {
      clients.delete(client.id);
    }
  }
}

export function broadcastKioskUpsert(kiosk: KioskDto) {
  broadcastMonitor("kiosk", kiosk);
}

export function broadcastKioskRemoved(id: string) {
  broadcastMonitor("kiosk_removed", { id });
}

export function broadcastSnapshot(kiosks: KioskDto[]) {
  broadcastMonitor("snapshot", { kiosks, at: new Date().toISOString() });
}

export function monitorClientCount() {
  return clients.size;
}

export function sendToClient(res: ServerResponse, event: string, data: unknown) {
  writeEvent(res, event, data);
}
