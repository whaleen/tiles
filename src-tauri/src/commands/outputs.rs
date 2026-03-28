use std::path::Path;
use tauri::State;

use crate::models::{OutputEntry, OutputRun};
use crate::services::fs_scanner;
use crate::state::AppState;

#[tauri::command]
pub fn list_outputs(
    state: State<AppState>,
    project: Option<String>,
    action: Option<String>,
) -> Vec<OutputRun> {
    let root = state.root.read().unwrap().clone();
    fs_scanner::list_output_runs(&root, project.as_deref(), action.as_deref())
}

#[tauri::command]
pub fn list_output_tree(
    state: State<AppState>,
    path: Option<String>,
    recursive: Option<bool>,
) -> Vec<OutputEntry> {
    let root = state.root.read().unwrap().clone();
    if recursive.unwrap_or(false) {
        fs_scanner::list_all_videos_recursive(
            &root,
            path.as_deref().unwrap_or("outputs"),
        )
    } else {
        fs_scanner::list_output_entries(&root, path.as_deref())
    }
}

#[tauri::command]
pub fn delete_output(state: State<AppState>, path: String) -> Result<(), String> {
    let root = state.root.read().unwrap().clone();
    if path.contains("..") || Path::new(&path).is_absolute() {
        return Err("invalid path".to_string());
    }
    let rel_norm = path.trim_matches('/');
    if rel_norm.is_empty() {
        return Err("invalid path".to_string());
    }
    if !rel_norm.starts_with("outputs/") && !rel_norm.starts_with("src/") {
        return Err("forbidden".to_string());
    }
    if rel_norm == "outputs" {
        return Err("forbidden".to_string());
    }
    if rel_norm.starts_with("src/") && !rel_norm.contains("/outputs/") {
        return Err("forbidden".to_string());
    }
    let parts: Vec<&str> = rel_norm.split('/').collect();
    if parts.len() == 3 && parts[0] == "src" && parts[2] == "outputs" {
        return Err("forbidden".to_string());
    }

    let full = root.join(rel_norm);
    if !full.exists() {
        return Err("not found".to_string());
    }
    if full.is_dir() {
        std::fs::remove_dir_all(&full).map_err(|e| e.to_string())?;
    } else {
        std::fs::remove_file(&full).map_err(|e| e.to_string())?;
    }
    Ok(())
}
