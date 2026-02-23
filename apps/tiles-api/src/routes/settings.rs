use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use std::sync::Arc;
use serde::Deserialize;

use crate::models::{LayoutInfo, TileSettings};
use crate::state::AppState;

#[derive(Deserialize)]
pub struct SettingsQuery {
    pub project: Option<String>,
}

pub async fn get_settings(
    State(state): State<Arc<AppState>>,
    Query(query): Query<SettingsQuery>,
) -> Result<Json<TileSettings>, StatusCode> {
    let path = settings_path(&state.root, query.project.as_deref());
    if !path.exists() {
        return Ok(Json(TileSettings {
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
        }));
    }
    let content = std::fs::read_to_string(&path).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let settings: TileSettings =
        serde_json::from_str(&content).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(settings))
}

pub async fn put_settings(
    State(state): State<Arc<AppState>>,
    Query(query): Query<SettingsQuery>,
    Json(settings): Json<TileSettings>,
) -> Result<StatusCode, StatusCode> {
    let path = settings_path(&state.root, query.project.as_deref());
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    let json =
        serde_json::to_string_pretty(&settings).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    std::fs::write(&path, json).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::OK)
}

pub async fn get_layouts() -> Json<Vec<LayoutInfo>> {
    Json(vec![
        LayoutInfo { code: "2x1".to_string(), tile_count: 2 },
        LayoutInfo { code: "1x2".to_string(), tile_count: 2 },
        LayoutInfo { code: "2x2".to_string(), tile_count: 4 },
        LayoutInfo { code: "2x3".to_string(), tile_count: 6 },
        LayoutInfo { code: "3x2".to_string(), tile_count: 6 },
        LayoutInfo { code: "3x1".to_string(), tile_count: 3 },
        LayoutInfo { code: "1x3".to_string(), tile_count: 3 },
        LayoutInfo { code: "4x1".to_string(), tile_count: 4 },
        LayoutInfo { code: "1x4".to_string(), tile_count: 4 },
        LayoutInfo { code: "3x3".to_string(), tile_count: 9 },
        LayoutInfo { code: "2x2-focus".to_string(), tile_count: 3 },
        LayoutInfo { code: "3x3-focus".to_string(), tile_count: 6 },
        LayoutInfo { code: "pip".to_string(), tile_count: 2 },
        LayoutInfo { code: "1+2".to_string(), tile_count: 3 },
        LayoutInfo { code: "2+1".to_string(), tile_count: 3 },
        LayoutInfo { code: "1+3".to_string(), tile_count: 4 },
        LayoutInfo { code: "left-big-right-stack".to_string(), tile_count: 3 },
        LayoutInfo { code: "top-big-bottom-stack".to_string(), tile_count: 3 },
    ])
}

fn settings_path(root: &std::path::Path, project: Option<&str>) -> std::path::PathBuf {
    if let Some(p) = project {
        return root.join("src").join(p).join("tile_videos_settings.json");
    }
    root.join("configs").join("tile_videos_settings.json")
}
