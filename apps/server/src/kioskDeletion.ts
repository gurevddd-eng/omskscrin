import { cancelKioskInstall } from "./remoteInstall.js";
import { dropPolicyClearJob, isPolicyClearRunning } from "./remoteClearPolicies.js";
import { dropUiStartJob, isUiStartRunning } from "./remoteStart.js";
import { dropUiStopJob, isUiStopRunning } from "./remoteStop.js";
import { isUninstallRunning } from "./remoteUninstall.js";

/** Stop install / start / stop / policy jobs before deleting a kiosk row. */
export async function prepareKioskDeletion(id: string): Promise<{ ok: true } | { ok: false; message: string }> {
  if (isUninstallRunning(id)) {
    return { ok: false, message: "Удаление софта с ПК уже выполняется — дождитесь завершения" };
  }
  if (isUiStartRunning(id)) {
    return { ok: false, message: "Запуск UI выполняется — дождитесь завершения или нажмите «Стоп»" };
  }
  if (isUiStopRunning(id)) {
    return { ok: false, message: "Остановка UI выполняется — дождитесь завершения" };
  }
  if (isPolicyClearRunning(id)) {
    return { ok: false, message: "Снятие политик выполняется — дождитесь завершения" };
  }

  await cancelKioskInstall(id);
  dropUiStartJob(id);
  dropUiStopJob(id);
  dropPolicyClearJob(id);
  return { ok: true };
}
