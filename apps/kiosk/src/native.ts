/** Detect Tauri and launch local .exe games via native shell. */

export type LaunchResult = {
  ok: boolean;
  exitCode: number | null;
  message: string;
};

type TauriInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

function getInvoke(): TauriInvoke | null {
  const w = window as unknown as {
    __TAURI_INTERNALS__?: { invoke?: TauriInvoke };
    __TAURI__?: { core?: { invoke?: TauriInvoke } };
  };
  return w.__TAURI_INTERNALS__?.invoke || w.__TAURI__?.core?.invoke || null;
}

export function isTauriShell(): boolean {
  return Boolean(getInvoke()) || Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

export async function probeNativeShell(): Promise<boolean> {
  const invoke = getInvoke();
  if (!invoke) return false;
  try {
    return Boolean(await invoke<boolean>("is_native_shell"));
  } catch {
    return false;
  }
}

export async function getGamesRoot(): Promise<string | null> {
  const invoke = getInvoke();
  if (!invoke) return null;
  try {
    return await invoke<string>("get_games_root");
  } catch {
    return null;
  }
}

/** Launch exe relative to ProgramData\StellaKiosk\games or absolute under that folder. */
export async function launchExe(
  path: string,
  args: string[] = [],
  cwd?: string
): Promise<LaunchResult> {
  const invoke = getInvoke();
  if (!invoke) {
    throw new Error("Нативный киоск (Tauri) не активен — запуск .exe недоступен в браузере");
  }
  return invoke<LaunchResult>("launch_exe", {
    path,
    args,
    cwd: cwd || null,
  });
}
