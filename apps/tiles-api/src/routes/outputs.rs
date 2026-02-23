use axum::extract::{Path as AxumPath, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use std::path::Path;
use std::sync::Arc;

use crate::models::{OutputEntry, OutputRun};
use crate::services::fs_scanner;
use crate::state::AppState;

#[derive(Deserialize)]
pub struct OutputsQuery {
    pub project: Option<String>,
    pub action: Option<String>,
}

pub async fn list_outputs(
    State(state): State<Arc<AppState>>,
    Query(query): Query<OutputsQuery>,
) -> Json<Vec<OutputRun>> {
    let runs = fs_scanner::list_output_runs(
        &state.root,
        query.project.as_deref(),
        query.action.as_deref(),
    );
    Json(runs)
}

#[derive(Deserialize)]
pub struct OutputsTreeQuery {
    pub path: Option<String>,
}

pub async fn list_output_tree(
    State(state): State<Arc<AppState>>,
    Query(query): Query<OutputsTreeQuery>,
) -> Json<Vec<OutputEntry>> {
    let entries = fs_scanner::list_output_entries(&state.root, query.path.as_deref());
    Json(entries)
}

pub async fn delete_output(
    State(state): State<Arc<AppState>>,
    AxumPath(rel): AxumPath<String>,
) -> Result<StatusCode, StatusCode> {
    if rel.contains("..") || Path::new(&rel).is_absolute() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let rel_norm = rel.trim_matches('/');
    if rel_norm.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    if !rel_norm.starts_with("outputs/") && !rel_norm.starts_with("src/") {
        return Err(StatusCode::FORBIDDEN);
    }
    if rel_norm == "outputs" {
        return Err(StatusCode::FORBIDDEN);
    }
    if rel_norm.starts_with("src/") && !rel_norm.contains("/outputs/") {
        return Err(StatusCode::FORBIDDEN);
    }
    let parts: Vec<&str> = rel_norm.split('/').collect();
    if parts.len() == 3 && parts[0] == "src" && parts[2] == "outputs" {
        return Err(StatusCode::FORBIDDEN);
    }

    let full = state.root.join(rel_norm);
    if !full.exists() {
        return Err(StatusCode::NOT_FOUND);
    }
    if full.is_dir() {
        std::fs::remove_dir_all(&full).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    } else {
        std::fs::remove_file(&full).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    Ok(StatusCode::NO_CONTENT)
}
