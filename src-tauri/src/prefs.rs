use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;

#[derive(Serialize, Deserialize, Default)]
pub struct Prefs {
    pub workspace: Option<String>,
    pub modelslab_api_key: Option<String>,
}

pub fn prefs_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("prefs.json")
}

pub fn read_prefs(app: &tauri::AppHandle) -> Prefs {
    let path = prefs_path(app);
    let Ok(content) = std::fs::read_to_string(&path) else {
        return Prefs::default();
    };
    serde_json::from_str(&content).unwrap_or_default()
}

pub fn write_prefs(app: &tauri::AppHandle, prefs: &Prefs) -> Result<(), String> {
    let path = prefs_path(app);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(prefs).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}
