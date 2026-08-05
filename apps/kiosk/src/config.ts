export type KioskGame = {
  /** Button label */
  title: string;
  /** Path relative to ProgramData\StellaKiosk\games or absolute under that folder */
  exe: string;
  args?: string[];
  /** Optional working directory */
  cwd?: string;
};

export type KioskConfig = {
  kioskId: string;
  hostname: string;
  serverUrl: string;
  syncIntervalSec: number;
  idleTimeoutSec: number;
  heartbeatIntervalSec: number;
  healthPort: number;
  appVersion: string;
  /** Optional local game launched via Tauri shell */
  game?: KioskGame | null;
};

const defaults: KioskConfig = {
  kioskId: "patriotstela1",
  hostname: "patriotstela1",
  serverUrl: "http://localhost:8080",
  syncIntervalSec: 20,
  idleTimeoutSec: 60,
  heartbeatIntervalSec: 30,
  healthPort: 47821,
  appVersion: "0.1.0",
  game: null,
};

export async function loadConfig(): Promise<KioskConfig> {
  try {
    const res = await fetch("/kiosk.json", { cache: "no-store" });
    if (!res.ok) return defaults;
    const raw = (await res.json()) as Partial<KioskConfig>;
    const hostname = (raw.hostname || raw.kioskId || defaults.hostname).toLowerCase();
    const kioskId = (raw.kioskId || hostname).toLowerCase();
    const game =
      raw.game && raw.game.exe && raw.game.title
        ? {
            title: String(raw.game.title),
            exe: String(raw.game.exe),
            args: Array.isArray(raw.game.args) ? raw.game.args.map(String) : [],
            cwd: raw.game.cwd ? String(raw.game.cwd) : undefined,
          }
        : null;
    return { ...defaults, ...raw, hostname, kioskId, game };
  } catch {
    return defaults;
  }
}
