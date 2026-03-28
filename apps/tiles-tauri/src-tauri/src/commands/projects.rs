use std::path::Path as StdPath;
use tauri::State;

use crate::models::{ProjectDetail, ProjectMeta, ProjectSummary};
use crate::services::fs_scanner;
use crate::state::AppState;

#[tauri::command]
pub fn list_projects(state: State<AppState>) -> Vec<ProjectSummary> {
    let root = state.root.read().unwrap().clone();
    fs_scanner::list_projects(&root)
}

#[tauri::command]
pub fn get_project(state: State<AppState>, name: String) -> Result<ProjectDetail, String> {
    let root = state.root.read().unwrap().clone();
    fs_scanner::get_project_detail(&root, &name)
        .ok_or_else(|| "not found".to_string())
}

#[tauri::command]
pub fn create_project(state: State<AppState>, name: String) -> Result<ProjectSummary, String> {
    let root = state.root.read().unwrap().clone();
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("name is required".to_string());
    }
    if !is_valid_project_name(&name) {
        return Err("invalid project name".to_string());
    }
    let dest = root.join("src").join(&name);
    if dest.exists() {
        return Err("project already exists".to_string());
    }
    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    let rel_path = format!("src/{name}");
    Ok(ProjectSummary {
        name,
        path: rel_path,
    })
}

#[tauri::command]
pub fn get_project_meta(state: State<AppState>, name: String) -> Result<ProjectMeta, String> {
    let root = state.root.read().unwrap().clone();
    let project_dir = root.join("src").join(&name);
    if !project_dir.exists() || !project_dir.is_dir() {
        return Err("not found".to_string());
    }
    Ok(read_project_meta(&root, &name))
}

#[tauri::command]
pub fn put_project_meta(
    state: State<AppState>,
    name: String,
    meta: ProjectMeta,
) -> Result<(), String> {
    let root = state.root.read().unwrap().clone();
    let project_dir = root.join("src").join(&name);
    if !project_dir.exists() || !project_dir.is_dir() {
        return Err("not found".to_string());
    }

    let display_name = normalize_optional(meta.display_name);
    let description = normalize_optional(meta.description);
    let cover_image_rel = normalize_optional(meta.cover_image_rel);
    if let Some(ref rel) = cover_image_rel {
        if !is_valid_cover_rel(&name, rel) {
            return Err("invalid cover_image_rel".to_string());
        }
    }
    let tags = meta
        .tags
        .into_iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .take(24)
        .collect::<Vec<_>>();

    let updated = ProjectMeta {
        display_name,
        cover_image_rel,
        description,
        tags,
    };
    write_project_meta(&root, &name, &updated)
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

fn write_project_meta(root: &StdPath, name: &str, meta: &ProjectMeta) -> Result<(), String> {
    let path = meta_path(root, name);
    let json = serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
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
