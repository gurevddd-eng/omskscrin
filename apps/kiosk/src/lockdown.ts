/**
 * Kiosk UI hardening. Keyboard blocking is controlled by admin setting
 * `blockKeyboard` (synced via manifest / updates).
 * OS-level chords (Win+L, Ctrl+Alt+Del) cannot be blocked from the page.
 */

let keyboardBlocked = true;

export function setKeyboardBlocked(enabled: boolean) {
  keyboardBlocked = Boolean(enabled);
}

export function isKeyboardBlocked() {
  return keyboardBlocked;
}

export function installKioskLockdown() {
  const blockKey = (e: KeyboardEvent) => {
    if (!keyboardBlocked) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };

  window.addEventListener("keydown", blockKey, true);
  window.addEventListener("keyup", blockKey, true);
  window.addEventListener("keypress", blockKey, true);

  window.addEventListener(
    "contextmenu",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
    },
    true
  );

  window.addEventListener(
    "beforeunload",
    (e) => {
      e.preventDefault();
      e.returnValue = "";
    },
    true
  );

  const refocus = () => {
    if (!keyboardBlocked) return;
    try {
      if (document.body) document.body.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
  };
  window.addEventListener("blur", () => setTimeout(refocus, 50));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refocus();
  });

  if (!document.body.hasAttribute("tabindex")) {
    document.body.setAttribute("tabindex", "-1");
  }
  refocus();
}
