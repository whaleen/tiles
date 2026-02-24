use axum::extract::{Path as AxumPath, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use std::path::Path;
use std::sync::Arc;

use crate::models::{VideoEntry, VideoInfo};
use crate::services::ffprobe;
use crate::state::AppState;

#[derive(Deserialize)]
pub struct VideoListQuery {
    pub project: Option<String>,
    pub search: Option<String>,
}

pub async fn list_videos(
    State(state): State<Arc<AppState>>,
    Query(query): Query<VideoListQuery>,
) -> Json<Vec<VideoEntry>> {
    let videos = state.get_videos(query.project.as_deref(), query.search.as_deref());
    Json(videos)
}

#[derive(Deserialize)]
pub struct VideoInfoQuery {
    pub path: String,
}

pub async fn get_video_info(
    State(state): State<Arc<AppState>>,
    Query(query): Query<VideoInfoQuery>,
) -> Result<Json<VideoInfo>, StatusCode> {
    let rel = &query.path;
    if rel.contains("..") || Path::new(rel).is_absolute() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let full = state.root.join("src").join(rel);
    if !full.exists() || !full.is_file() {
        return Err(StatusCode::NOT_FOUND);
    }
    ffprobe::get_video_info(&full, &state.root)
        .map(Json)
        .ok_or(StatusCode::INTERNAL_SERVER_ERROR)
}

pub async fn delete_video(
    State(state): State<Arc<AppState>>,
    AxumPath(rel): AxumPath<String>,
) -> Result<StatusCode, StatusCode> {
    if rel.contains("..") || Path::new(&rel).is_absolute() {
        return Err(StatusCode::BAD_REQUEST);
    }
    if rel.split('/').any(|seg| seg == "outputs") {
        return Err(StatusCode::FORBIDDEN);
    }
    let full = state.root.join("src").join(&rel);
    if !full.exists() || !full.is_file() {
        return Err(StatusCode::NOT_FOUND);
    }
    std::fs::remove_file(&full).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    state.invalidate_video_cache();
    Ok(StatusCode::NO_CONTENT)
}
