import type { KioskDto } from "@stella/shared";
import {
  GAME_COPY_STATUS_LABEL,
  INSTALL_STATUS_LABEL,
  POLICY_CLEAR_STATUS_LABEL,
  UI_START_STATUS_LABEL,
  UI_STOP_STATUS_LABEL,
} from "@stella/shared";
import { kioskHasProblem } from "../../components/kiosk/status";

export type ExhibitOpt = { id: string; title: string };
export type FilterTab = "all" | "online" | "problems" | "installing";

export function formatSeen(iso: string | null) {
  if (!iso) return "никогда";
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export function kioskDotClass(k: KioskDto) {
  if (k.probeStatus === "healthy" && k.online) return "ok";
  if (kioskHasProblem(k)) return "bad";
  if (k.online) return "warn";
  return "off";
}

export function kioskBusyLabel(k: KioskDto) {
  if (k.uiStopStatus === "running") return UI_STOP_STATUS_LABEL.running;
  if (k.uiStartStatus === "running") return UI_START_STATUS_LABEL.running;
  if (k.policyClearStatus === "running") return POLICY_CLEAR_STATUS_LABEL.running;
  if (k.installStatus === "running" || k.installStatus === "queued") {
    return INSTALL_STATUS_LABEL[k.installStatus];
  }
  const gs = k.gameCopy?.status;
  if (gs === "copying" || gs === "launching" || gs === "running") {
    return GAME_COPY_STATUS_LABEL[gs];
  }
  return null;
}

export function shortHostname(hostname: string) {
  const i = hostname.indexOf(".");
  return i > 0 ? hostname.slice(0, i) : hostname;
}
