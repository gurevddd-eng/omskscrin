import { mapKiosk } from "./kioskProbe.js";
import { applyPolicyClearToDto } from "./remoteClearPolicies.js";
import { applyUiStartToDto } from "./remoteStart.js";
import { applyUiStopToDto } from "./remoteStop.js";

export function enrichKioskDto(dto: ReturnType<typeof mapKiosk>) {
  return applyUiStopToDto(applyUiStartToDto(applyPolicyClearToDto(dto)));
}
