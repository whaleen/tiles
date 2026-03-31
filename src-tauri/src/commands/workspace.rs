use std::path::PathBuf;
use tauri::{Manager, State};

use crate::state::AppState;

#[tauri::command]
pub fn default_workspace_path(app: tauri::AppHandle) -> String {
    app.path()
        .home_dir()
        .map(|h| h.join("Movies").join("tiles").to_string_lossy().to_string())
        .unwrap_or_else(|_| "~/Movies/tiles".to_string())
}

#[tauri::command]
pub fn get_workspace(state: State<AppState>) -> Option<String> {
    let root = state.root.read().unwrap();
    if root.as_os_str().is_empty() {
        None
    } else {
        Some(root.to_string_lossy().to_string())
    }
}

#[tauri::command]
pub async fn pick_workspace(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    let path = app
        .dialog()
        .file()
        .set_title("Choose tiles workspace folder")
        .blocking_pick_folder()
        .ok_or_else(|| "cancelled".to_string())?;

    let path_buf = match path {
        tauri_plugin_dialog::FilePath::Path(p) => p,
        tauri_plugin_dialog::FilePath::Url(u) => PathBuf::from(u.path()),
    };

    apply_workspace(&app, &state, path_buf)
}

#[tauri::command]
pub fn set_workspace(
    app: tauri::AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<String, String> {
    let path = PathBuf::from(path);
    apply_workspace(&app, &state, path)
}

fn apply_workspace(
    app: &tauri::AppHandle,
    state: &State<AppState>,
    path: PathBuf,
) -> Result<String, String> {
    if !path.exists() {
        std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    }
    if !path.is_dir() {
        return Err("path must be a directory".to_string());
    }

    for subdir in &["src", "outputs", "configs"] {
        std::fs::create_dir_all(path.join(subdir)).map_err(|e| e.to_string())?;
    }

    let prefs = crate::prefs::Prefs {
        workspace: Some(path.to_string_lossy().to_string()),
    };
    crate::prefs::write_prefs(app, &prefs)?;

    let mut root = state.root.write().unwrap();
    *root = path.clone();
    drop(root);
    state.invalidate_video_cache();

    Ok(path.to_string_lossy().to_string())
}
