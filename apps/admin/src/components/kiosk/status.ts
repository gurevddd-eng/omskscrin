import type { KioskDto } from "@stella/shared";
import { PROBE_STATUS_LABEL } from "@stella/shared";

export function probeBadgeClass(status: KioskDto["probeStatus"]) {
  if (status === "healthy") return "ok";
  if (status === "degraded") return "warn";
  if (status === "no_software" || status === "unreachable") return "error";
  return "offline";
}

export function probeLabel(status: KioskDto["probeStatus"]) {
  return PROBE_STATUS_LABEL[status];
}

export function kioskHasProblem(k: KioskDto) {
  return (
    k.installStatus === "error" ||
    k.gameCopy?.status === "error" ||
    k.probeStatus === "unreachable" ||
    k.probeStatus === "no_software" ||
    k.syncStatus === "error"
  );
}

export function kioskGameBusy(k: KioskDto) {
  const s = k.gameCopy?.status;
  return s === "copying" || s === "launching" || s === "running";
}
