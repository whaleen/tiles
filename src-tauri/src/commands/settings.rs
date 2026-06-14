use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::State;

use crate::commands::projects::{read_project_meta, write_project_meta};
use crate::models::{CompositionSummary, LayoutInfo, TileSettings};
use crate::state::AppState;

/// The settings a brand-new project/composition starts from.
pub(crate) fn default_tile_settings() -> TileSettings {
    TileSettings {
        layout_code: Some("2x1".to_string()),
        crop_mode: Some("crop".to_string()),
        layout_mode: None,
        layout_rects: Vec::new(),
        layout_tree: None,
        render_mode: None,
        output_mode: None,
        no_overwrite: Some(true),
        tile_folders: Vec::new(),
        audio_enabled: Some(false),
        audio_tiles: Vec::new(),
        audio_tile: None,
        max_total_duration: None,
        max_duration: None,
        distribution_mode: None,
        max_durations: Vec::new(),
        tile_settings: Vec::new(),
        timeline_clips: Vec::new(),
        sizing_mode: None,
        canvas_width: Some(1920),
        canvas_height: Some(1080),
        padding: Some(0),
        bg_color: Some("000000".to_string()),
        no_repeat: Some(false),
        output_length_policy: Some("longest".to_string()),
        source_repeat_policy: Some("allow".to_string()),
        mode: Some("edit".to_string()),
    }
}

#[tauri::command]
pub fn get_settings(
    state: State<AppState>,
    project: Option<String>,
) -> Result<TileSettings, String> {
    let root = state.root.read().unwrap().clone();
    validate_project_settings_scope(&root, project.as_deref())?;
    let path = settings_path(&root, project.as_deref());
    if !path.exists() {
        return Ok(default_tile_settings());
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let settings: TileSettings = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(settings)
}

#[tauri::command]
pub fn put_settings(
    state: State<AppState>,
    project: Option<String>,
    settings: TileSettings,
) -> Result<(), String> {
    let root = state.root.read().unwrap().clone();
    validate_project_settings_scope(&root, project.as_deref())?;
    let path = settings_path(&root, project.as_deref());
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

// --- Compositions (named, reloadable tile-builder documents) ---

const DEFAULT_COMPOSITION: &str = "Default";

fn is_valid_composition_name(name: &str) -> bool {
    let n = name.trim();
    !n.is_empty()
        && n.len() <= 120
        && !n.starts_with('.')
        && !n.contains('/')
        && !n.contains('\\')
        && !n.contains("..")
        && !Path::new(n).is_absolute()
        && n.chars().all(|c| !c.is_control())
}

fn comps_dir(root: &Path, project: &str) -> PathBuf {
    // Project-local app metadata stays under `.tiles` so it doesn't appear as a
    // source-media folder in the Library or folder picker.
    root.join("src").join(project).join(".tiles").join("comps")
}

fn legacy_comps_dir(root: &Path, project: &str) -> PathBuf {
    root.join("src").join(project).join("comps")
}

fn composition_path(root: &Path, project: &str, name: &str) -> PathBuf {
    comps_dir(root, project).join(format!("{name}.json"))
}

fn json_files_in(dir: &Path) -> Vec<String> {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    rd.flatten()
        .filter_map(|e| {
            let p = e.path();
            if p.extension().map(|x| x.eq_ignore_ascii_case("json")) == Some(true) {
                p.file_stem().map(|s| s.to_string_lossy().to_string())
            } else {
                None
            }
        })
        .collect()
}

fn ensure_active_composition(
    root: &Path,
    project: &str,
    mut names: Vec<String>,
) -> Result<(), String> {
    if names.is_empty() {
        return Ok(());
    }
    names.sort_by_key(|n| n.to_lowercase());
    let mut meta = read_project_meta(root, project);
    let active_exists = meta
        .active_composition
        .as_deref()
        .map(|active| names.iter().any(|name| name == active))
        .unwrap_or(false);
    if !active_exists {
        meta.active_composition = names.into_iter().next();
        write_project_meta(root, project, &meta)?;
    }
    Ok(())
}

/// Ensure the project has at least one composition, migrating the legacy single
/// `tile_videos_settings.json` into a "Default" composition the first time.
fn ensure_compositions(root: &Path, project: &str) -> Result<(), String> {
    let dir = comps_dir(root, project);
    let existing = json_files_in(&dir);
    if !existing.is_empty() {
        return ensure_active_composition(root, project, existing);
    }

    // Early WIP builds used `src/<project>/comps`. If present, migrate those
    // files into `.tiles/comps` so the Library never shows config folders.
    let legacy_dir = legacy_comps_dir(root, project);
    let legacy_comps = json_files_in(&legacy_dir);
    if !legacy_comps.is_empty() {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        for name in &legacy_comps {
            let from = legacy_dir.join(format!("{name}.json"));
            let to = composition_path(root, project, name);
            if !to.exists() {
                std::fs::rename(&from, &to)
                    .or_else(|_| std::fs::copy(&from, &to).map(|_| ()))
                    .map_err(|e| e.to_string())?;
            }
        }
        let _ = std::fs::remove_dir(&legacy_dir);
        return ensure_active_composition(root, project, legacy_comps);
    }

    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let legacy = settings_path(root, Some(project));
    let settings = if legacy.exists() {
        std::fs::read_to_string(&legacy)
            .ok()
            .and_then(|c| serde_json::from_str::<TileSettings>(&c).ok())
            .unwrap_or_else(default_tile_settings)
    } else {
        default_tile_settings()
    };
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(composition_path(root, project, DEFAULT_COMPOSITION), json)
        .map_err(|e| e.to_string())?;
    ensure_active_composition(root, project, vec![DEFAULT_COMPOSITION.to_string()])
}

#[tauri::command]
pub fn list_compositions(
    state: State<AppState>,
    project: String,
) -> Result<Vec<CompositionSummary>, String> {
    let root = state.root.read().unwrap().clone();
    validate_project_settings_scope(&root, Some(&project))?;
    ensure_compositions(&root, &project)?;
    let active = read_project_meta(&root, &project).active_composition;
    let dir = comps_dir(&root, &project);

    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .flatten()
    {
        let path = entry.path();
        if path.extension().map(|x| x.eq_ignore_ascii_case("json")) != Some(true) {
            continue;
        }
        let Some(name) = path.file_stem().map(|s| s.to_string_lossy().to_string()) else {
            continue;
        };
        let modified_epoch = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let is_active = active.as_deref() == Some(name.as_str());
        out.push(CompositionSummary {
            name,
            modified_epoch,
            active: is_active,
        });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

#[tauri::command]
pub fn get_composition(
    state: State<AppState>,
    project: String,
    name: String,
) -> Result<TileSettings, String> {
    let root = state.root.read().unwrap().clone();
    validate_project_settings_scope(&root, Some(&project))?;
    if !is_valid_composition_name(&name) {
        return Err("invalid composition name".to_string());
    }
    ensure_compositions(&root, &project)?;
    let path = composition_path(&root, &project, name.trim());
    if !path.exists() {
        return Err("composition not found".to_string());
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn put_composition(
    state: State<AppState>,
    project: String,
    name: String,
    settings: TileSettings,
) -> Result<(), String> {
    let root = state.root.read().unwrap().clone();
    validate_project_settings_scope(&root, Some(&project))?;
    let name = name.trim().to_string();
    if !is_valid_composition_name(&name) {
        return Err("invalid composition name".to_string());
    }
    let dir = comps_dir(&root, &project);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(composition_path(&root, &project, &name), json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_composition(
    state: State<AppState>,
    project: String,
    from: String,
    to: String,
) -> Result<(), String> {
    let root = state.root.read().unwrap().clone();
    validate_project_settings_scope(&root, Some(&project))?;
    let from = from.trim().to_string();
    let to = to.trim().to_string();
    if !is_valid_composition_name(&from) || !is_valid_composition_name(&to) {
        return Err("invalid composition name".to_string());
    }
    ensure_compositions(&root, &project)?;
    let from_path = composition_path(&root, &project, &from);
    let to_path = composition_path(&root, &project, &to);
    if !from_path.exists() {
        return Err("composition not found".to_string());
    }
    if to_path.exists() {
        return Err("a composition with that name already exists".to_string());
    }
    std::fs::rename(&from_path, &to_path).map_err(|e| e.to_string())?;
    let mut meta = read_project_meta(&root, &project);
    if meta.active_composition.as_deref() == Some(from.as_str()) {
        meta.active_composition = Some(to);
        write_project_meta(&root, &project, &meta)?;
    }
    Ok(())
}

#[tauri::command]
pub fn delete_composition(
    state: State<AppState>,
    project: String,
    name: String,
) -> Result<(), String> {
    let root = state.root.read().unwrap().clone();
    validate_project_settings_scope(&root, Some(&project))?;
    let name = name.trim().to_string();
    if !is_valid_composition_name(&name) {
        return Err("invalid composition name".to_string());
    }
    ensure_compositions(&root, &project)?;
    let dir = comps_dir(&root, &project);
    let remaining = json_files_in(&dir);
    if !remaining.iter().any(|n| n == &name) {
        return Err("composition not found".to_string());
    }
    if remaining.len() <= 1 {
        return Err("can't delete the last composition".to_string());
    }
    std::fs::remove_file(composition_path(&root, &project, &name)).map_err(|e| e.to_string())?;
    let mut meta = read_project_meta(&root, &project);
    if meta.active_composition.as_deref() == Some(name.as_str()) {
        let mut rest: Vec<String> = remaining.into_iter().filter(|n| n != &name).collect();
        rest.sort_by_key(|n| n.to_lowercase());
        meta.active_composition = rest.into_iter().next();
        write_project_meta(&root, &project, &meta)?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_active_composition(
    state: State<AppState>,
    project: String,
) -> Result<Option<String>, String> {
    let root = state.root.read().unwrap().clone();
    validate_project_settings_scope(&root, Some(&project))?;
    ensure_compositions(&root, &project)?;
    let active = read_project_meta(&root, &project).active_composition;
    if let Some(ref name) = active {
        if !composition_path(&root, &project, name).exists() {
            return Ok(None);
        }
    }
    Ok(active)
}

#[tauri::command]
pub fn set_active_composition(
    state: State<AppState>,
    project: String,
    name: String,
) -> Result<(), String> {
    let root = state.root.read().unwrap().clone();
    validate_project_settings_scope(&root, Some(&project))?;
    let name = name.trim().to_string();
    if !is_valid_composition_name(&name) {
        return Err("invalid composition name".to_string());
    }
    ensure_compositions(&root, &project)?;
    if !composition_path(&root, &project, &name).exists() {
        return Err("composition not found".to_string());
    }
    let mut meta = read_project_meta(&root, &project);
    meta.active_composition = Some(name);
    write_project_meta(&root, &project, &meta)
}

#[tauri::command]
pub async fn get_active_provider(app: tauri::AppHandle) -> Option<String> {
    crate::prefs::read_prefs(&app).active_provider
}

#[tauri::command]
pub async fn set_active_provider(app: tauri::AppHandle, provider: String) -> Result<(), String> {
    let mut prefs = crate::prefs::read_prefs(&app);
    let trimmed = provider.trim().to_string();
    prefs.active_provider = if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    };
    crate::prefs::write_prefs(&app, &prefs)
}

#[tauri::command]
pub async fn get_provider_key(app: tauri::AppHandle, provider: String) -> Option<String> {
    crate::prefs::read_prefs(&app).provider_key(&provider)
}

#[tauri::command]
pub async fn set_provider_key(
    app: tauri::AppHandle,
    provider: String,
    key: String,
) -> Result<(), String> {
    let provider = provider.trim().to_string();
    if provider.is_empty() {
        return Err("provider id required".to_string());
    }
    let mut prefs = crate::prefs::read_prefs(&app);
    let trimmed = key.trim().to_string();
    if trimmed.is_empty() {
        prefs.credentials.remove(&provider);
    } else {
        prefs.credentials.insert(provider, trimmed);
    }
    crate::prefs::write_prefs(&app, &prefs)
}

// Legacy single-key commands, kept for the existing dashboard UI. Routed
// through the credential map (provider "modelslab") so nothing diverges.
#[tauri::command]
pub async fn get_modelslab_key(app: tauri::AppHandle) -> Option<String> {
    crate::prefs::read_prefs(&app).provider_key("modelslab")
}

#[tauri::command]
pub async fn set_modelslab_key(app: tauri::AppHandle, key: String) -> Result<(), String> {
    set_provider_key(app, "modelslab".to_string(), key).await
}

#[tauri::command]
pub fn list_layouts() -> Vec<LayoutInfo> {
    vec![
        LayoutInfo {
            code: "1x1".to_string(),
            tile_count: 1,
        },
        LayoutInfo {
            code: "2x1".to_string(),
            tile_count: 2,
        },
        LayoutInfo {
            code: "1x2".to_string(),
            tile_count: 2,
        },
        LayoutInfo {
            code: "2x2".to_string(),
            tile_count: 4,
        },
        LayoutInfo {
            code: "2x3".to_string(),
            tile_count: 6,
        },
        LayoutInfo {
            code: "3x2".to_string(),
            tile_count: 6,
        },
        LayoutInfo {
            code: "3x1".to_string(),
            tile_count: 3,
        },
        LayoutInfo {
            code: "1x3".to_string(),
            tile_count: 3,
        },
        LayoutInfo {
            code: "4x1".to_string(),
            tile_count: 4,
        },
        LayoutInfo {
            code: "1x4".to_string(),
            tile_count: 4,
        },
        LayoutInfo {
            code: "3x3".to_string(),
            tile_count: 9,
        },
        LayoutInfo {
            code: "2x2-focus".to_string(),
            tile_count: 3,
        },
        LayoutInfo {
            code: "3x3-focus".to_string(),
            tile_count: 6,
        },
        LayoutInfo {
            code: "pip".to_string(),
            tile_count: 2,
        },
        LayoutInfo {
            code: "1+2".to_string(),
            tile_count: 3,
        },
        LayoutInfo {
            code: "2+1".to_string(),
            tile_count: 3,
        },
        LayoutInfo {
            code: "1+3".to_string(),
            tile_count: 4,
        },
        LayoutInfo {
            code: "left-big-right-stack".to_string(),
            tile_count: 3,
        },
        LayoutInfo {
            code: "top-big-bottom-stack".to_string(),
            tile_count: 3,
        },
    ]
}

fn settings_path(root: &std::path::Path, project: Option<&str>) -> std::path::PathBuf {
    if let Some(p) = project {
        return root.join("src").join(p).join("tile_videos_settings.json");
    }
    root.join("configs").join("tile_videos_settings.json")
}

fn validate_project_settings_scope(root: &Path, project: Option<&str>) -> Result<(), String> {
    let Some(project) = project else {
        return Ok(());
    };
    if project.is_empty()
        || project.starts_with('.')
        || project.contains("..")
        || project.contains('/')
        || project.contains('\\')
        || Path::new(project).is_absolute()
        || !project.chars().all(|c| !c.is_control())
        || Path::new(project)
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("invalid project".to_string());
    }
    let project_dir = root.join("src").join(project);
    if !project_dir.exists() || !project_dir.is_dir() {
        return Err("project not found".to_string());
    }
    Ok(())
}
