use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use std::path::Path as StdPath;
use std::sync::Arc;

use crate::models::{ProjectDetail, ProjectMeta, ProjectSummary};
use crate::services::fs_scanner;
use crate::state::AppState;

pub async fn list_projects(
    State(state): State<Arc<AppState>>,
) -> Json<Vec<ProjectSummary>> {
    let projects = fs_scanner::list_projects(&state.root);
    Json(projects)
}

pub async fn get_project(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> Result<Json<ProjectDetail>, StatusCode> {
    fs_scanner::get_project_detail(&state.root, &name)
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

#[derive(Deserialize)]
pub struct CreateProjectRequest {
    pub name: String,
}

pub async fn create_project(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateProjectRequest>,
) -> Result<Json<ProjectSummary>, StatusCode> {
    let name = payload.name.trim();
    if name.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    if !is_valid_project_name(name) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let dest = state.root.join("src").join(name);
    if dest.exists() {
        return Err(StatusCode::CONFLICT);
    }
    std::fs::create_dir_all(&dest).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rel_path = format!("src/{name}");
    Ok(Json(ProjectSummary {
        name: name.to_string(),
        path: rel_path,
    }))
}

pub async fn get_project_meta(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> Result<Json<ProjectMeta>, StatusCode> {
    let project_dir = state.root.join("src").join(&name);
    if !project_dir.exists() || !project_dir.is_dir() {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(Json(read_project_meta(&state.root, &name)))
}

pub async fn put_project_meta(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    Json(payload): Json<ProjectMeta>,
) -> Result<StatusCode, StatusCode> {
    let project_dir = state.root.join("src").join(&name);
    if !project_dir.exists() || !project_dir.is_dir() {
        return Err(StatusCode::NOT_FOUND);
    }

    let display_name = normalize_optional(payload.display_name);
    let description = normalize_optional(payload.description);
    let cover_image_rel = normalize_optional(payload.cover_image_rel);
    if let Some(ref rel) = cover_image_rel {
        if !is_valid_cover_rel(&name, rel) {
            return Err(StatusCode::BAD_REQUEST);
        }
    }
    let tags = payload
        .tags
        .into_iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .take(24)
        .collect::<Vec<_>>();

    let meta = ProjectMeta {
        display_name,
        cover_image_rel,
        description,
        tags,
    };
    write_project_meta(&state.root, &name, &meta)?;
    Ok(StatusCode::OK)
}

fn is_valid_project_name(name: &str) -> bool {
    if name.starts_with('.') {
        return false;
    }
    if name.contains('/') || name.contains('\\') {
        return false;
    }
    if name.contains("..") {
        return false;
    }
    if StdPath::new(name).is_absolute() {
        return false;
    }
    name.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn meta_path(root: &StdPath, name: &str) -> std::path::PathBuf {
    root.join("src").join(name).join(".tiles-project.json")
}

fn read_project_meta(root: &StdPath, name: &str) -> ProjectMeta {
    let path = meta_path(root, name);
    let content = match std::fs::read_to_string(&path) {
        Ok(v) => v,
        Err(_) => return default_meta(),
    };
    serde_json::from_str::<ProjectMeta>(&content).unwrap_or_else(|_| default_meta())
}

fn write_project_meta(root: &StdPath, name: &str, meta: &ProjectMeta) -> Result<(), StatusCode> {
    let path = meta_path(root, name);
    let json = serde_json::to_string_pretty(meta).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    std::fs::write(path, json).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

fn default_meta() -> ProjectMeta {
    ProjectMeta {
        display_name: None,
        cover_image_rel: None,
        description: None,
        tags: Vec::new(),
    }
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

fn is_valid_cover_rel(project: &str, rel: &str) -> bool {
    if rel.contains("..") || rel.contains('\\') || StdPath::new(rel).is_absolute() {
        return false;
    }
    rel.starts_with(&format!("{project}/"))
        || rel.starts_with(&format!("src/{project}/outputs/"))
        || rel.starts_with("outputs/")
}
