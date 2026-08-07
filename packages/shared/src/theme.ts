export type ThemeMode = "manual" | "light" | "dark" | "schedule";
export type ThemeName = "light" | "dark";

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function parseThemeMode(raw: string | null | undefined): ThemeMode {
  const v = String(raw || "manual").trim().toLowerCase();
  if (v === "light" || v === "dark" || v === "schedule" || v === "manual") return v;
  return "manual";
}

export function normalizeHhMm(raw: string | null | undefined, fallback: string): string {
  const s = String(raw || "").trim();
  const m = HHMM.exec(s);
  if (!m) return fallback;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => Number(x));
  return h * 60 + m;
}

/** Dark window may wrap midnight (e.g. 20:00 → 08:00). */
export function isDarkBySchedule(now: Date, darkFrom: string, darkTo: string): boolean {
  const from = minutesOfDay(normalizeHhMm(darkFrom, "20:00"));
  const to = minutesOfDay(normalizeHhMm(darkTo, "08:00"));
  const cur = now.getHours() * 60 + now.getMinutes();
  if (from === to) return false;
  if (from < to) return cur >= from && cur < to;
  return cur >= from || cur < to;
}

export function resolveEffectiveTheme(opts: {
  mode: ThemeMode | string;
  darkFrom?: string | null;
  darkTo?: string | null;
  now?: Date;
}): ThemeName | null {
  const mode = parseThemeMode(String(opts.mode));
  if (mode === "manual") return null;
  if (mode === "light") return "light";
  if (mode === "dark") return "dark";
  const now = opts.now ?? new Date();
  return isDarkBySchedule(now, opts.darkFrom || "20:00", opts.darkTo || "08:00")
    ? "dark"
    : "light";
}
