import { mapKiosk } from "./kioskProbe.js";
import { applyPolicyClearToDto } from "./remoteClearPolicies.js";
import { applyUiStartToDto } from "./remoteStart.js";
import { applyUiStopToDto } from "./remoteStop.js";
import { applyGameCopyToDto } from "./gameCopyState.js";

export function enrichKioskDto(dto: ReturnType<typeof mapKiosk>) {
  return applyGameCopyToDto(applyUiStopToDto(applyUiStartToDto(applyPolicyClearToDto(dto))));
}
