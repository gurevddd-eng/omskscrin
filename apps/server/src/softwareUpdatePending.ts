/** Pending admin-forced software OTA per kiosk (in-memory). */
const pendingByKioskId = new Map<string, { target: string; at: number }>();

const PENDING_TTL_MS = 15 * 60 * 1000;
const ACK_GRACE_MS = 45_000;

function keyOf(kioskId: string) {
  return kioskId.trim().toLowerCase();
}

export function markSoftwareUpdatePending(kioskId: string, targetVersion: string) {
  const target = String(targetVersion || "").trim();
  if (!target) return;
  pendingByKioskId.set(keyOf(kioskId), { target, at: Date.now() });
}

export function clearSoftwareUpdatePending(kioskId: string) {
  pendingByKioskId.delete(keyOf(kioskId));
}

export function getSoftwareUpdatePending(kioskId: string): { target: string; at: number } | null {
  const key = keyOf(kioskId);
  const pending = pendingByKioskId.get(key);
  if (!pending) return null;
  if (Date.now() - pending.at > PENDING_TTL_MS) {
    pendingByKioskId.delete(key);
    return null;
  }
  return pending;
}

/**
 * Clear when agent reports it reached the target — but keep a short grace
 * after admin click so same-version force is not wiped by the next heartbeat.
 */
export function acknowledgeSoftwareVersion(kioskId: string, reported: string | null | undefined) {
  const pending = getSoftwareUpdatePending(kioskId);
  if (!pending) return;
  const local = String(reported || "").trim();
  if (local && local === pending.target && Date.now() - pending.at > ACK_GRACE_MS) {
    clearSoftwareUpdatePending(kioskId);
  }
}
