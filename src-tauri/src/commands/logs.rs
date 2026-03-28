use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub fn list_logs(state: State<AppState>) -> Vec<String> {
    let root = state.root.read().unwrap().clone();
    let log_dir = root.join("outputs").join("tui-logs");
    let mut logs = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&log_dir) {
        for entry in entries.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                if name.ends_with(".log") {
                    logs.push(name.to_string());
                }
            }
        }
    }
    logs.sort();
    logs.reverse();
    logs
}

#[tauri::command]
pub fn get_log(state: State<AppState>, filename: String) -> Result<String, String> {
    let root = state.root.read().unwrap().clone();
    if filename.contains("..") || filename.contains('/') {
        return Err("invalid filename".to_string());
    }
    let path = root
        .join("outputs")
        .join("tui-logs")
        .join(&filename);
    std::fs::read_to_string(&path).map_err(|_| "not found".to_string())
}
