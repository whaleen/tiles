use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct CreateFolderRequest {
    pub project: String,
    #[serde(default)]
    pub parent: Option<String>,
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct RenameFolderRequest {
    pub project: String,
    pub path: String,
    pub new_name: String,
}

#[derive(Debug, Deserialize)]
pub struct MoveFolderRequest {
    pub project: String,
    pub path: String,
    #[serde(default)]
    pub target_parent: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DeleteFolderRequest {
    pub project: String,
    pub path: String,
}

#[derive(Debug, Deserialize)]
pub struct MoveVideosRequest {
    pub project: String,
    pub video_paths: Vec<String>,
    pub target_folder: String,
}

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

pub async fn create_folder(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateFolderRequest>,
) -> Result<Json<FolderPathResponse>, StatusCode> {
    let project_dir = get_project_dir(&state.root, &payload.project)?;
    let parent = normalize_rel(payload.parent.as_deref().unwrap_or(""));
    if !is_valid_rel_folder(&parent, true) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let name = payload.name.trim();
    if !is_valid_folder_name(name) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let new_rel = join_rel(&parent, name);
    if !is_valid_rel_folder(&new_rel, false) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let new_dir = project_dir.join(&new_rel);
    if new_dir.exists() {
        return Err(StatusCode::CONFLICT);
    }
    std::fs::create_dir_all(&new_dir).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(FolderPathResponse { path: new_rel }))
}

pub async fn rename_folder(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<RenameFolderRequest>,
) -> Result<Json<FolderPathResponse>, StatusCode> {
    let project_dir = get_project_dir(&state.root, &payload.project)?;
    let from_rel = normalize_rel(&payload.path);
    if !is_valid_rel_folder(&from_rel, false) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let new_name = payload.new_name.trim();
    if !is_valid_folder_name(new_name) {
        return Err(StatusCode::BAD_REQUEST);
    }

    let parent = Path::new(&from_rel)
        .parent()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();
    let to_rel = join_rel(&parent, new_name);
    if !is_valid_rel_folder(&to_rel, false) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let from = project_dir.join(&from_rel);
    let to = project_dir.join(&to_rel);
    if !from.exists() || !from.is_dir() {
        return Err(StatusCode::NOT_FOUND);
    }
    if to.exists() {
        return Err(StatusCode::CONFLICT);
    }
    std::fs::rename(&from, &to).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    state.invalidate_video_cache();
    Ok(Json(FolderPathResponse { path: to_rel }))
}

pub async fn move_folder(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<MoveFolderRequest>,
) -> Result<Json<FolderPathResponse>, StatusCode> {
    let project_dir = get_project_dir(&state.root, &payload.project)?;
    let from_rel = normalize_rel(&payload.path);
    if !is_valid_rel_folder(&from_rel, false) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let target_parent = normalize_rel(payload.target_parent.as_deref().unwrap_or(""));
    if !is_valid_rel_folder(&target_parent, true) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let folder_name = Path::new(&from_rel)
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or(StatusCode::BAD_REQUEST)?;
    let to_rel = join_rel(&target_parent, folder_name);
    if from_rel == to_rel {
        return Ok(Json(FolderPathResponse { path: to_rel }));
    }
    if from_rel.starts_with(&format!("{to_rel}/")) {
        return Err(StatusCode::BAD_REQUEST);
    }

    let from = project_dir.join(&from_rel);
    let to_parent_dir = project_dir.join(&target_parent);
    let to = project_dir.join(&to_rel);
    if !from.exists() || !from.is_dir() {
        return Err(StatusCode::NOT_FOUND);
    }
    if !to_parent_dir.exists() || !to_parent_dir.is_dir() {
        return Err(StatusCode::NOT_FOUND);
    }
    if to.exists() {
        return Err(StatusCode::CONFLICT);
    }
    std::fs::rename(&from, &to).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    state.invalidate_video_cache();
    Ok(Json(FolderPathResponse { path: to_rel }))
}

pub async fn delete_folder(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<DeleteFolderRequest>,
) -> Result<StatusCode, StatusCode> {
    let project_dir = get_project_dir(&state.root, &payload.project)?;
    let rel = normalize_rel(&payload.path);
    if !is_valid_rel_folder(&rel, false) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let dir = project_dir.join(&rel);
    if !dir.exists() || !dir.is_dir() {
        return Err(StatusCode::NOT_FOUND);
    }
    std::fs::remove_dir_all(dir).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    state.invalidate_video_cache();
    Ok(StatusCode::NO_CONTENT)
}

pub async fn move_videos(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<MoveVideosRequest>,
) -> Result<Json<MoveVideosResponse>, StatusCode> {
    let project_dir = get_project_dir(&state.root, &payload.project)?;
    let target_rel = normalize_rel(&payload.target_folder);
    if !is_valid_rel_folder(&target_rel, true) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let target_dir = project_dir.join(&target_rel);
    if !target_dir.exists() || !target_dir.is_dir() {
        return Err(StatusCode::NOT_FOUND);
    }

    let mut moved = 0usize;
    let mut moved_paths = Vec::new();
    for rel_path in payload.video_paths {
        let rel_path_norm = normalize_rel(&rel_path);
        if !is_valid_rel_video(&rel_path_norm, &payload.project) {
            return Err(StatusCode::BAD_REQUEST);
        }
        let src_full = state.root.join("src").join(&rel_path_norm);
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
            .ok_or(StatusCode::BAD_REQUEST)?;
        let dest_full = unique_destination(&target_dir, file_name);
        let dest_rel = dest_full
            .strip_prefix(state.root.join("src"))
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        std::fs::rename(&src_full, &dest_full).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        moved += 1;
        moved_paths.push(MovedVideoPath {
            from: rel_path_norm,
            to: dest_rel,
        });
    }

    state.invalidate_video_cache();
    Ok(Json(MoveVideosResponse { moved, moved_paths }))
}

fn get_project_dir(root: &Path, project: &str) -> Result<PathBuf, StatusCode> {
    if !is_valid_project_name(project) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let project_dir = root.join("src").join(project);
    if !project_dir.exists() || !project_dir.is_dir() {
        return Err(StatusCode::NOT_FOUND);
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
    if name.contains('/') || name.contains('\\') {
        return false;
    }
    name.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
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
    if parts.iter().any(|seg| seg.is_empty() || *seg == "." || *seg == "..") {
        return false;
    }
    if parts.iter().any(|seg| *seg == "outputs") {
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
    !path.split('/').any(|seg| seg == "outputs")
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
