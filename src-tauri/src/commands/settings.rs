use std::path::{Component, Path};
use tauri::State;

use crate::models::{LayoutInfo, TileSettings};
use crate::state::AppState;

#[tauri::command]
pub fn get_settings(
    state: State<AppState>,
    project: Option<String>,
) -> Result<TileSettings, String> {
    let root = state.root.read().unwrap().clone();
    validate_project_settings_scope(&root, project.as_deref())?;
    let path = settings_path(&root, project.as_deref());
    if !path.exists() {
        return Ok(TileSettings {
            layout_code: Some("2x1".to_string()),
            crop_mode: Some("crop".to_string()),
            layout_mode: None,
            layout_rects: Vec::new(),
            layout_tree: None,
            render_mode: None,
            output_mode: None,
            no_overwrite: None,
            tile_folders: Vec::new(),
            audio_enabled: Some(false),
            audio_tiles: Vec::new(),
            audio_tile: None,
            max_total_duration: None,
            max_duration: None,
            distribution_mode: None,
            max_durations: Vec::new(),
            tile_settings: Vec::new(),
            sizing_mode: None,
            canvas_width: Some(1920),
            canvas_height: Some(1080),
            padding: Some(0),
            bg_color: Some("000000".to_string()),
            no_repeat: Some(false),
            output_length_policy: Some("longest".to_string()),
            source_repeat_policy: Some("allow".to_string()),
        });
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

#[tauri::command]
pub async fn get_modelslab_key(app: tauri::AppHandle) -> Option<String> {
    crate::prefs::read_prefs(&app).modelslab_api_key
}

#[tauri::command]
pub async fn set_modelslab_key(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let mut prefs = crate::prefs::read_prefs(&app);
    let trimmed = key.trim().to_string();
    prefs.modelslab_api_key = if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    };
    crate::prefs::write_prefs(&app, &prefs)
}

#[tauri::command]
pub fn list_layouts() -> Vec<LayoutInfo> {
    vec![
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
