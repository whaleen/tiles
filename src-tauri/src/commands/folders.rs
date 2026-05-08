use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::State;

use crate::models::FolderOrder;
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct FolderPathResponse {
    pub path: String,
}

#[derive(Debug, Serialize)]
pub struct MoveVideosResponse {
    pub moved: usize,
    pub moved_paths: Vec<MovedVideoPath>,
}

#[derive(Debug, Serialize)]
pub struct MovedVideoPath {
    pub from: String,
    pub to: String,
}

#[tauri::command]
pub fn create_folder(
    state: State<AppState>,
    project: String,
    parent: Option<String>,
    name: String,
) -> Result<FolderPathResponse, String> {
    let root = state.root.read().unwrap().clone();
    let project_dir = get_project_dir(&root, &project)?;
    let parent_norm = normalize_rel(parent.as_deref().unwrap_or(""));
    if !is_valid_rel_folder(&parent_norm, true) {
        return Err("invalid parent".to_string());
    }
    let name = name.trim().to_string();
    if !is_valid_folder_name(&name) {
        return Err("invalid folder name".to_string());
    }
    let new_rel = join_rel(&parent_norm, &name);
    if !is_valid_rel_folder(&new_rel, false) {
        return Err("invalid path".to_string());
    }
    let new_dir = project_dir.join(&new_rel);
    if new_dir.exists() {
        return Err("already exists".to_string());
    }
    std::fs::create_dir_all(&new_dir).map_err(|e| e.to_string())?;
    Ok(FolderPathResponse { path: new_rel })
}

#[tauri::command]
pub fn rename_folder(
    state: State<AppState>,
    project: String,
    path: String,
    new_name: String,
) -> Result<FolderPathResponse, String> {
    let root = state.root.read().unwrap().clone();
    let project_dir = get_project_dir(&root, &project)?;
    let from_rel = normalize_rel(&path);
    if !is_valid_rel_folder(&from_rel, false) {
        return Err("invalid path".to_string());
    }
    let new_name = new_name.trim().to_string();
    if !is_valid_folder_name(&new_name) {
        return Err("invalid folder name".to_string());
    }

    let parent = Path::new(&from_rel)
        .parent()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();
    let to_rel = join_rel(&parent, &new_name);
    if !is_valid_rel_folder(&to_rel, false) {
        return Err("invalid destination".to_string());
    }
    let from = project_dir.join(&from_rel);
    let to = project_dir.join(&to_rel);
    if !from.exists() || !from.is_dir() {
        return Err("not found".to_string());
    }
    if to.exists() {
        return Err("already exists".to_string());
    }
    std::fs::rename(&from, &to).map_err(|e| e.to_string())?;
    state.invalidate_video_cache();
    Ok(FolderPathResponse { path: to_rel })
}

#[tauri::command]
pub fn move_folder(
    state: State<AppState>,
    project: String,
    path: String,
    target_parent: Option<String>,
) -> Result<FolderPathResponse, String> {
    let root = state.root.read().unwrap().clone();
    let project_dir = get_project_dir(&root, &project)?;
    let from_rel = normalize_rel(&path);
    if !is_valid_rel_folder(&from_rel, false) {
        return Err("invalid path".to_string());
    }
    let target_parent_norm = normalize_rel(target_parent.as_deref().unwrap_or(""));
    if !is_valid_rel_folder(&target_parent_norm, true) {
        return Err("invalid target_parent".to_string());
    }
    let folder_name = Path::new(&from_rel)
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "invalid path".to_string())?;
    let to_rel = join_rel(&target_parent_norm, folder_name);
    if from_rel == to_rel {
        return Ok(FolderPathResponse { path: to_rel });
    }
    if !target_parent_norm.is_empty()
        && (target_parent_norm == from_rel
            || target_parent_norm.starts_with(&format!("{from_rel}/")))
    {
        return Err("cannot move folder into itself".to_string());
    }

    let from = project_dir.join(&from_rel);
    let to_parent_dir = project_dir.join(&target_parent_norm);
    let to = project_dir.join(&to_rel);
    if !from.exists() || !from.is_dir() {
        return Err("not found".to_string());
    }
    if !to_parent_dir.exists() || !to_parent_dir.is_dir() {
        return Err("target parent not found".to_string());
    }
    if to.exists() {
        return Err("already exists".to_string());
    }
    std::fs::rename(&from, &to).map_err(|e| e.to_string())?;
    state.invalidate_video_cache();
    Ok(FolderPathResponse { path: to_rel })
}

#[tauri::command]
pub fn delete_folder(state: State<AppState>, project: String, path: String) -> Result<(), String> {
    let root = state.root.read().unwrap().clone();
    let project_dir = get_project_dir(&root, &project)?;
    let rel = normalize_rel(&path);
    if !is_valid_rel_folder(&rel, false) {
        return Err("invalid path".to_string());
    }
    let dir = project_dir.join(&rel);
    if !dir.exists() || !dir.is_dir() {
        return Err("not found".to_string());
    }
    std::fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
    state.invalidate_video_cache();
    Ok(())
}

#[tauri::command]
pub fn move_videos(
    state: State<AppState>,
    project: String,
    video_paths: Vec<String>,
    target_folder: String,
) -> Result<MoveVideosResponse, String> {
    let root = state.root.read().unwrap().clone();
    let project_dir = get_project_dir(&root, &project)?;
    let target_rel = normalize_rel(&target_folder);
    if !is_valid_rel_folder(&target_rel, true) {
        return Err("invalid target_folder".to_string());
    }
    let target_dir = if target_rel.is_empty() {
        project_dir.clone()
    } else {
        project_dir.join(&target_rel)
    };
    if !target_dir.exists() || !target_dir.is_dir() {
        return Err("target folder not found".to_string());
    }

    let mut moved = 0usize;
    let mut moved_paths = Vec::new();
    for rel_path in video_paths {
        let rel_path_norm = normalize_rel(&rel_path);
        if !is_valid_rel_video(&rel_path_norm, &project) {
            return Err("invalid video path".to_string());
        }
        let src_full = root.join("src").join(&rel_path_norm);
        if !src_full.exists() || !src_full.is_file() {
            continue;
        }
        if src_full
            .parent()
            .map(|p| p == target_dir.as_path())
            .unwrap_or(false)
        {
            continue;
        }
        let file_name = src_full
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or_else(|| "invalid file name".to_string())?;
        let dest_full = unique_destination(&target_dir, file_name);
        let dest_rel = dest_full
            .strip_prefix(root.join("src"))
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .map_err(|_| "path error".to_string())?;
        std::fs::rename(&src_full, &dest_full).map_err(|e| e.to_string())?;
        moved += 1;
        moved_paths.push(MovedVideoPath {
            from: rel_path_norm,
            to: dest_rel,
        });
    }

    state.invalidate_video_cache();
    Ok(MoveVideosResponse { moved, moved_paths })
}

#[tauri::command]
pub fn get_folder_order(
    state: State<AppState>,
    project: String,
    folder: Option<String>,
) -> Result<FolderOrder, String> {
    let root = state.root.read().unwrap().clone();
    let project_dir = get_project_dir(&root, &project)?;
    let folder_dir = match folder.as_deref() {
        Some(f) => {
            let rel = normalize_rel(f);
            if !is_valid_rel_folder(&rel, true) {
                return Err("invalid folder".to_string());
            }
            if rel.is_empty() {
                project_dir
            } else {
                project_dir.join(&rel)
            }
        }
        None => project_dir,
    };
    let path = folder_dir.join(".tiles-folder.json");
    if !path.exists() {
        return Ok(FolderOrder {
            video_order: Vec::new(),
        });
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let order: FolderOrder = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(order)
}

#[tauri::command]
pub fn put_folder_order(
    state: State<AppState>,
    project: String,
    folder: Option<String>,
    order: FolderOrder,
) -> Result<(), String> {
    let root = state.root.read().unwrap().clone();
    let project_dir = get_project_dir(&root, &project)?;
    let folder_dir = match folder.as_deref() {
        Some(f) => {
            let rel = normalize_rel(f);
            if !is_valid_rel_folder(&rel, true) {
                return Err("invalid folder".to_string());
            }
            if rel.is_empty() {
                project_dir
            } else {
                project_dir.join(&rel)
            }
        }
        None => project_dir,
    };
    std::fs::create_dir_all(&folder_dir).map_err(|e| e.to_string())?;
    let path = folder_dir.join(".tiles-folder.json");
    let json = serde_json::to_string_pretty(&order).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

fn get_project_dir(root: &Path, project: &str) -> Result<PathBuf, String> {
    if !is_valid_project_name(project) {
        return Err("invalid project name".to_string());
    }
    let project_dir = root.join("src").join(project);
    if !project_dir.exists() || !project_dir.is_dir() {
        return Err("project not found".to_string());
    }
    Ok(project_dir)
}

fn normalize_rel(path: &str) -> String {
    path.replace('\\', "/").trim_matches('/').trim().to_string()
}

fn is_valid_project_name(name: &str) -> bool {
    if name.is_empty() || name.starts_with('.') || name.contains("..") {
        return false;
    }
    if name.contains('/') || name.contains('\\') || Path::new(name).is_absolute() {
        return false;
    }
    name.chars().all(|c| !c.is_control())
}

fn is_valid_folder_name(name: &str) -> bool {
    if name.is_empty() || name == "." || name == ".." {
        return false;
    }
    if name.contains('/') || name.contains('\\') || name.contains('\0') {
        return false;
    }
    true
}

fn is_valid_rel_folder(path: &str, allow_empty: bool) -> bool {
    if path.is_empty() {
        return allow_empty;
    }
    if path.starts_with('/') || path.contains('\0') || path.contains("..") {
        return false;
    }
    let parts: Vec<&str> = path.split('/').collect();
    if parts
        .iter()
        .any(|seg| seg.is_empty() || *seg == "." || *seg == "..")
    {
        return false;
    }
    true
}

fn is_valid_rel_video(path: &str, project: &str) -> bool {
    if path.is_empty() || path.starts_with('/') || path.contains('\0') || path.contains("..") {
        return false;
    }
    let mut parts = path.split('/');
    let Some(project_part) = parts.next() else {
        return false;
    };
    if project_part != project {
        return false;
    }
    true
}

fn join_rel(parent: &str, leaf: &str) -> String {
    if parent.is_empty() {
        leaf.to_string()
    } else {
        format!("{parent}/{leaf}")
    }
}

fn unique_destination(target_dir: &Path, file_name: &str) -> PathBuf {
    let initial = target_dir.join(file_name);
    if !initial.exists() {
        return initial;
    }
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(file_name);
    let ext = Path::new(file_name)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| format!(".{s}"))
        .unwrap_or_default();

    for i in 1..=9999u32 {
        let candidate = target_dir.join(format!("{stem} ({i}){ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    target_dir.join(format!("{stem}-moved{ext}"))
}

#[cfg(test)]
mod tests {
    use super::{is_valid_project_name, is_valid_rel_folder};

    #[test]
    fn folder_commands_accept_project_names_that_create_project_accepts() {
        assert!(is_valid_project_name("My Project 01"));
        assert!(is_valid_project_name("καλός-project"));
        assert!(!is_valid_project_name("../escape"));
        assert!(!is_valid_project_name("bad/name"));
        assert!(!is_valid_project_name("bad\nname"));
    }

    #[test]
    fn folder_paths_reject_traversal() {
        assert!(is_valid_rel_folder("", true));
        assert!(is_valid_rel_folder("a/b", false));
        assert!(!is_valid_rel_folder("../a", true));
        assert!(!is_valid_rel_folder("a/../b", true));
        assert!(!is_valid_rel_folder("/a", true));
    }
}
