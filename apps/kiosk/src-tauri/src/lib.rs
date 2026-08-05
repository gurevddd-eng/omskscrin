use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Manager, State, Window};

struct GameLock(Arc<AtomicBool>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LaunchResult {
    ok: bool,
    exit_code: Option<i32>,
    message: String,
}

fn program_data_games_root() -> PathBuf {
    let base = std::env::var_os("ProgramData")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"));
    base.join("StellaKiosk").join("games")
}

fn install_root() -> PathBuf {
    let base = std::env::var_os("ProgramData")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"));
    base.join("StellaKiosk")
}

/// Resolve and validate game exe path.
/// Allowed:
/// - absolute path under ProgramData\StellaKiosk\games\
/// - relative path resolved against that games folder
fn resolve_game_exe(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("путь к .exe пуст".into());
    }

    let games_root = program_data_games_root()
        .canonicalize()
        .unwrap_or_else(|_| program_data_games_root());

    let candidate = if Path::new(trimmed).is_absolute() {
        PathBuf::from(trimmed)
    } else {
        for c in Path::new(trimmed).components() {
            if matches!(c, Component::ParentDir) {
                return Err("относительный путь не должен содержать ..".into());
            }
        }
        games_root.join(trimmed)
    };

    let canonical = candidate
        .canonicalize()
        .map_err(|_| format!("файл не найден: {}", candidate.display()))?;

    let root = games_root.canonicalize().unwrap_or(games_root);

    if !canonical.starts_with(&root) {
        return Err(format!(
            "запуск разрешён только из {}",
            program_data_games_root().display()
        ));
    }

    let ext = canonical
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if ext != "exe" {
        return Err("можно запускать только .exe".into());
    }

    Ok(canonical)
}

fn restore_window(app: &AppHandle, window: &Window) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_fullscreen(true);
        let _ = w.set_always_on_top(true);
        let _ = w.set_focus();
    } else {
        let _ = window.show();
        let _ = window.set_fullscreen(true);
        let _ = window.set_always_on_top(true);
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn is_native_shell() -> bool {
    true
}

#[tauri::command]
fn get_games_root() -> String {
    program_data_games_root().display().to_string()
}

#[tauri::command]
fn get_install_root() -> String {
    install_root().display().to_string()
}

/// Launch a local .exe from the allowed games folder.
/// Hides the kiosk window while the game runs, then restores it.
#[tauri::command]
async fn launch_exe(
    app: AppHandle,
    window: Window,
    lock: State<'_, GameLock>,
    path: String,
    args: Option<Vec<String>>,
    cwd: Option<String>,
) -> Result<LaunchResult, String> {
    if lock
        .0
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("игра уже запущена".into());
    }

    let exe = match resolve_game_exe(&path) {
        Ok(p) => p,
        Err(e) => {
            lock.0.store(false, Ordering::SeqCst);
            return Err(e);
        }
    };

    let work_dir = cwd
        .as_deref()
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| exe.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(program_data_games_root);

    let argv = args.unwrap_or_default();
    let flag = Arc::clone(&lock.0);

    let _ = window.set_always_on_top(false);
    let _ = window.hide();

    let launch = tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new(&exe);
        cmd.args(&argv).current_dir(&work_dir);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
            cmd.creation_flags(CREATE_NEW_PROCESS_GROUP);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("не удалось запустить {}: {e}", exe.display()))?;

        let status = child
            .wait()
            .map_err(|e| format!("ошибка ожидания процесса: {e}"))?;

        Ok::<LaunchResult, String>(LaunchResult {
            ok: status.success(),
            exit_code: status.code(),
            message: if status.success() {
                "игра завершена".into()
            } else {
                format!("процесс завершился с кодом {:?}", status.code())
            },
        })
    })
    .await
    .map_err(|e| format!("ошибка потока: {e}"))?;

    restore_window(&app, &window);
    flag.store(false, Ordering::SeqCst);

    launch
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(GameLock(Arc::new(AtomicBool::new(false))))
        .invoke_handler(tauri::generate_handler![
            is_native_shell,
            get_games_root,
            get_install_root,
            launch_exe
        ])
        .setup(|app| {
            let games = program_data_games_root();
            let _ = std::fs::create_dir_all(&games);
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_fullscreen(true);
                let _ = w.set_always_on_top(true);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Stella Kiosk");
}
