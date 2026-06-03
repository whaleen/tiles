use std::fs;
use std::path::Path;

use base64::Engine;
use serde::Serialize;
use tauri::State;

use crate::models::{OutputEntry, OutputRun};
use crate::services::{fs_scanner, thumbnail};
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct BackfillOutputThumbnailsResult {
    pub scanned: usize,
    pub existing: usize,
    pub generated: usize,
    pub failed: usize,
    pub failures: Vec<String>,
}

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
        fs_scanner::list_all_output_files_recursive(&root, path.as_deref().unwrap_or("outputs"))
    } else {
        fs_scanner::list_output_entries(&root, path.as_deref())
    }
}

#[tauri::command]
pub fn resolve_transcript_source(state: State<AppState>, path: String) -> Option<String> {
    if path.contains("..") || Path::new(&path).is_absolute() {
        return None;
    }
    let root = state.root.read().unwrap().clone();
    fs_scanner::resolve_transcript_source_video(&root, path.trim_matches('/'))
}

#[tauri::command]
pub fn get_output_text(state: State<AppState>, path: String) -> Result<String, String> {
    let root = state.root.read().unwrap().clone();
    if path.contains("..") || Path::new(&path).is_absolute() {
        return Err("invalid path".to_string());
    }
    let rel_norm = path.trim_matches('/');
    if !rel_norm.starts_with("outputs/") && !rel_norm.starts_with("src/") {
        return Err("forbidden".to_string());
    }
    if rel_norm.starts_with("src/") && !rel_norm.contains("/outputs/") {
        return Err("forbidden".to_string());
    }
    let full = root.join(rel_norm);
    if !full.is_file() || !fs_scanner::is_transcript_file(&full) {
        return Err("not found".to_string());
    }
    std::fs::read_to_string(&full).map_err(|_| "failed to read text".to_string())
}

#[tauri::command]
pub fn get_output_thumbnail_data_url(
    state: State<AppState>,
    path: String,
) -> Result<Option<String>, String> {
    let root = state.root.read().unwrap().clone();
    let rel_norm = normalize_output_file_rel(&path)?;
    let full = root.join(rel_norm);
    if !full.is_file() {
        return Ok(None);
    }
    if !fs_scanner::is_video_file(&full) && !fs_scanner::is_image_file(&full) {
        return Ok(None);
    }

    let Some(thumb) = thumbnail::ensure_thumbnail(&root, &full, rel_norm) else {
        return Ok(None);
    };
    let bytes = fs::read(&thumb).map_err(|e| e.to_string())?;
    let mime = if fs_scanner::is_image_file(&full) {
        image_mime(&full)
    } else {
        "image/jpeg"
    };
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(Some(format!("data:{mime};base64,{encoded}")))
}

#[tauri::command]
pub fn backfill_output_thumbnails(
    state: State<AppState>,
    project: Option<String>,
) -> Result<BackfillOutputThumbnailsResult, String> {
    let root = state.root.read().unwrap().clone();
    let scope_rel = match project.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        Some(project_name) => {
            if project_name.contains('/')
                || project_name.contains('\\')
                || project_name.contains("..")
                || Path::new(project_name).is_absolute()
            {
                return Err("invalid project".to_string());
            }
            format!("src/{project_name}/outputs")
        }
        None => "outputs".to_string(),
    };

    let scope = root.join(&scope_rel);
    let mut result = BackfillOutputThumbnailsResult {
        scanned: 0,
        existing: 0,
        generated: 0,
        failed: 0,
        failures: Vec::new(),
    };

    if !scope.exists() {
        return Ok(result);
    }
    if !scope.is_dir() {
        return Err("output scope is not a directory".to_string());
    }

    backfill_dir(&root, &scope, &mut result);
    Ok(result)
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

fn normalize_output_file_rel(path: &str) -> Result<&str, String> {
    if path.contains("..") || Path::new(path).is_absolute() {
        return Err("invalid path".to_string());
    }
    let rel_norm = path.trim_matches('/');
    if !rel_norm.starts_with("outputs/") && !rel_norm.starts_with("src/") {
        return Err("forbidden".to_string());
    }
    if rel_norm.starts_with("src/") && !rel_norm.contains("/outputs/") {
        return Err("forbidden".to_string());
    }
    Ok(rel_norm)
}

fn image_mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        _ => "image/jpeg",
    }
}

fn backfill_dir(root: &Path, dir: &Path, result: &mut BackfillOutputThumbnailsResult) {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(err) => {
            result.failed += 1;
            result
                .failures
                .push(format!("{}: {err}", display_rel(root, dir)));
            return;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if is_internal_output_dir(&path) {
                continue;
            }
            backfill_dir(root, &path, result);
            continue;
        }

        if !path.is_file() {
            continue;
        }
        if !fs_scanner::is_video_file(&path) && !fs_scanner::is_image_file(&path) {
            continue;
        }

        result.scanned += 1;
        let rel = display_rel(root, &path);
        match thumbnail::ensure_thumbnail_with_status(root, &path, &rel) {
            Some(thumbnail::ThumbnailEnsureResult::Existing(_)) => result.existing += 1,
            Some(thumbnail::ThumbnailEnsureResult::Generated(_)) => result.generated += 1,
            None => {
                result.failed += 1;
                result
                    .failures
                    .push(format!("{rel}: thumbnail generation failed"));
            }
        }
    }
}

fn is_internal_output_dir(path: &Path) -> bool {
    matches!(
        path.file_name().and_then(|name| name.to_str()),
        Some("tui-thumbs" | "tui-logs" | "tui-tmp")
    )
}

fn display_rel(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace(std::path::MAIN_SEPARATOR, "/")
}
