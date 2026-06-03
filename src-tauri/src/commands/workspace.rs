use base64::Engine;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{Manager, State};

use crate::state::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCandidate {
    pub name: String,
    pub path: String,
    pub project_count: usize,
    pub thumbnail_data_url: Option<String>,
}

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMeta {
    pub cover_image_rel: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCoverCandidate {
    pub rel_path: String,
    pub abs_path: String,
    pub name: String,
    pub source: String,
    pub thumbnail_data_url: Option<String>,
}

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
pub fn get_workspace_meta(state: State<AppState>) -> WorkspaceMeta {
    let root = state.root.read().unwrap().clone();
    read_workspace_meta(&root)
}

#[tauri::command]
pub fn put_workspace_meta(state: State<AppState>, meta: WorkspaceMeta) -> Result<(), String> {
    let root = state.root.read().unwrap().clone();
    if let Some(rel) = meta.cover_image_rel.as_deref() {
        validate_workspace_rel(rel)?;
        if !root.join(rel).exists() {
            return Err("workspace cover file not found".to_string());
        }
    }
    let path = workspace_meta_path(&root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_workspace_cover_candidates(state: State<AppState>) -> Vec<WorkspaceCoverCandidate> {
    let root = state.root.read().unwrap().clone();
    find_cover_candidates(&root, 200)
}

#[tauri::command]
pub fn list_workspace_candidates(
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Vec<WorkspaceCandidate> {
    let mut candidates = Vec::new();
    let current = state.root.read().unwrap().clone();
    if !current.as_os_str().is_empty() && current.is_dir() {
        candidates.push(workspace_candidate(current));
    }
    let Some(home) = app.path().home_dir().ok() else {
        return candidates;
    };

    let search_roots = [home.join("Movies"), home.join("Documents")];
    for root in search_roots {
        let Ok(entries) = std::fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() || !looks_like_workspace(&path) {
                continue;
            }
            candidates.push(workspace_candidate(path));
        }
    }

    candidates.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    candidates.dedup_by(|a, b| a.path == b.path);
    candidates
}

#[tauri::command]
pub fn create_workspace(
    app: tauri::AppHandle,
    state: State<AppState>,
    name: String,
) -> Result<String, String> {
    let name = sanitize_workspace_name(&name)?;
    let base = app
        .path()
        .home_dir()
        .map_err(|e| e.to_string())?
        .join("Movies");
    apply_workspace(&app, &state, base.join(name))
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

fn looks_like_workspace(path: &Path) -> bool {
    path.join("src").is_dir() || path.join("outputs").is_dir() || path.join("configs").is_dir()
}

fn workspace_candidate(path: PathBuf) -> WorkspaceCandidate {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());
    let src = path.join("src");
    let project_count = std::fs::read_dir(&src)
        .ok()
        .map(|entries| {
            entries
                .flatten()
                .filter(|entry| entry.path().is_dir())
                .count()
        })
        .unwrap_or(0);

    WorkspaceCandidate {
        name,
        path: path.to_string_lossy().to_string(),
        project_count,
        thumbnail_data_url: find_workspace_thumbnail(&path)
            .and_then(|path| image_data_url(Path::new(&path))),
    }
}

fn find_workspace_thumbnail(path: &Path) -> Option<String> {
    let meta = read_workspace_meta(path);
    if let Some(rel) = meta.cover_image_rel {
        let candidate = path.join(rel);
        if candidate.exists() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }

    find_cover_candidates(path, 1)
        .into_iter()
        .next()
        .map(|candidate| candidate.abs_path)
}

fn find_cover_candidates(root: &Path, max: usize) -> Vec<WorkspaceCoverCandidate> {
    let mut out = Vec::new();
    for base in [root.join("src"), root.join("outputs")] {
        collect_media_candidates(root, &base, &mut out, max);
        if out.len() >= max {
            break;
        }
    }
    out
}

fn collect_media_candidates(
    root: &Path,
    dir: &Path,
    out: &mut Vec<WorkspaceCoverCandidate>,
    max: usize,
) {
    if out.len() >= max || !dir.is_dir() {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if out.len() >= max {
            return;
        }
        let path = entry.path();
        if path.is_dir() {
            collect_media_candidates(root, &path, out, max);
            continue;
        }
        if !is_media_path(&path) {
            continue;
        }
        if let Ok(rel) = path.strip_prefix(root) {
            out.push(WorkspaceCoverCandidate {
                rel_path: rel.to_string_lossy().to_string(),
                abs_path: path.to_string_lossy().to_string(),
                name: path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default(),
                source: if rel.starts_with("outputs") {
                    "outputs"
                } else {
                    "library"
                }
                .to_string(),
                thumbnail_data_url: image_data_url(&path),
            });
        }
    }
}

fn is_media_path(path: &Path) -> bool {
    let Some(ext) = path
        .extension()
        .map(|ext| ext.to_string_lossy().to_lowercase())
    else {
        return false;
    };
    matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif")
}

fn image_data_url(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_string_lossy().to_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => return None,
    };
    let bytes = std::fs::read(path).ok()?;
    if bytes.len() > 2_000_000 {
        return None;
    }
    Some(format!(
        "data:{};base64,{}",
        mime,
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

fn workspace_meta_path(root: &Path) -> PathBuf {
    root.join("configs").join("workspace_meta.json")
}

fn read_workspace_meta(root: &Path) -> WorkspaceMeta {
    let Ok(content) = std::fs::read_to_string(workspace_meta_path(root)) else {
        return WorkspaceMeta::default();
    };
    serde_json::from_str(&content).unwrap_or_default()
}

fn validate_workspace_rel(rel: &str) -> Result<(), String> {
    if rel.is_empty()
        || rel.contains("..")
        || rel.contains('\\')
        || rel.starts_with('/')
        || Path::new(rel).is_absolute()
        || !rel.chars().all(|c| !c.is_control())
    {
        return Err("invalid workspace cover path".to_string());
    }
    Ok(())
}

fn sanitize_workspace_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty()
        || name.starts_with('.')
        || name.contains("..")
        || name.contains('/')
        || name.contains('\\')
        || !name.chars().all(|c| !c.is_control())
    {
        return Err("invalid workspace name".to_string());
    }
    Ok(name.to_string())
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

    let mut prefs = crate::prefs::read_prefs(app);
    prefs.workspace = Some(path.to_string_lossy().to_string());
    crate::prefs::write_prefs(app, &prefs)?;

    let mut root = state.root.write().unwrap();
    *root = path.clone();
    drop(root);
    state.invalidate_video_cache();

    Ok(path.to_string_lossy().to_string())
}
