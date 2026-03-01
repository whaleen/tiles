use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use std::time::{SystemTime, UNIX_EPOCH};
use std::sync::Arc;

use crate::models::{ActionInfo, ActionRunRequest, ActionRunResult, RunningAction};
use crate::services::runner;
use crate::state::AppState;

pub async fn list_actions() -> Json<Vec<ActionInfo>> {
    Json(vec![
        ActionInfo {
            name: "concat".to_string(),
            label: "Concatenate".to_string(),
            description: "Join all videos in a folder into a single file. Choose a transition style between clips.".to_string(),
            target_type: "folders".to_string(),
        },
        ActionInfo {
            name: "trim".to_string(),
            label: "Trim".to_string(),
            description: "Cut a percentage off the start and/or end of each video. Useful for removing intros, outros, or unwanted edges.".to_string(),
            target_type: "folders_or_videos".to_string(),
        },
        ActionInfo {
            name: "detect".to_string(),
            label: "Detect Scenes".to_string(),
            description: "Find scene boundaries in videos and split them into separate clips at each cut point.".to_string(),
            target_type: "folders_or_videos".to_string(),
        },
        ActionInfo {
            name: "split-detect".to_string(),
            label: "Detect Split Screens".to_string(),
            description: "Detect split-screen regions in videos and export each split to its own folder.".to_string(),
            target_type: "folders_or_videos".to_string(),
        },
        ActionInfo {
            name: "yt-import".to_string(),
            label: "Import YouTube Video".to_string(),
            description: "Download a YouTube video, fetch transcript, and split into tiles.".to_string(),
            target_type: "url".to_string(),
        },
        ActionInfo {
            name: "strip-audio".to_string(),
            label: "Strip Audio".to_string(),
            description: "Remove the audio track from videos, producing silent video files.".to_string(),
            target_type: "folders_or_videos".to_string(),
        },
        ActionInfo {
            name: "chop".to_string(),
            label: "Chop".to_string(),
            description: "Split long videos into smaller segments by duration or count.".to_string(),
            target_type: "folders_or_videos".to_string(),
        },
        ActionInfo {
            name: "transcribe".to_string(),
            label: "Transcribe".to_string(),
            description: "Generate Whisper transcripts from audio using FFmpeg's whisper filter.".to_string(),
            target_type: "folders_or_videos".to_string(),
        },
        ActionInfo {
            name: "tile".to_string(),
            label: "Tile".to_string(),
            description: "Render a tiled video composition using saved settings from the Tile Builder.".to_string(),
            target_type: "settings".to_string(),
        },
        ActionInfo {
            name: "clean".to_string(),
            label: "Clean Filenames".to_string(),
            description: "Tidy up video filenames in a folder: remove duplicates, standardize naming, or both.".to_string(),
            target_type: "folders".to_string(),
        },
        ActionInfo {
            name: "doctor-reencode".to_string(),
            label: "Re-encode (Doctor)".to_string(),
            description: "Re-encode videos to a constant frame rate. Fixes choppy playback caused by variable frame rate recordings.".to_string(),
            target_type: "folders_or_videos".to_string(),
        },
        ActionInfo {
            name: "slowmo".to_string(),
            label: "Slow Motion".to_string(),
            description: "Slow videos down by a chosen factor. A 2x slowdown makes a 10-second clip last 20 seconds.".to_string(),
            target_type: "folders_or_videos".to_string(),
        },
        ActionInfo {
            name: "loop".to_string(),
            label: "Loop".to_string(),
            description: "Loop a video a set number of times. Useful for extending short clips. Transitions apply between loops.".to_string(),
            target_type: "folders_or_videos".to_string(),
        },
        ActionInfo {
            name: "crop".to_string(),
            label: "Crop".to_string(),
            description: "Crop videos to a specific region. Set the position and size of the crop rectangle.".to_string(),
            target_type: "folders_or_videos".to_string(),
        },
        ActionInfo {
            name: "organize-landscape".to_string(),
            label: "Organize by Orientation".to_string(),
            description: "Sort videos into landscape/ and portrait/ subfolders based on their aspect ratio.".to_string(),
            target_type: "folders".to_string(),
        },
        ActionInfo {
            name: "run".to_string(),
            label: "Run Saved Settings".to_string(),
            description: "Render a tiled composition from your saved Tile Builder settings without opening the builder.".to_string(),
            target_type: "settings".to_string(),
        },
        ActionInfo {
            name: "yolo".to_string(),
            label: "YOLO".to_string(),
            description: "Generate a random tile composition. Picks a random layout and assigns folders automatically.".to_string(),
            target_type: "settings".to_string(),
        },
    ])
}

pub async fn run_action(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ActionRunRequest>,
) -> Result<Json<ActionRunResult>, StatusCode> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let id = format!("{}_{}", now, std::process::id());
    let project = project_from_request(&req);
    let output = output_hint(&req, project.as_deref());
    let running = RunningAction {
        id: id.clone(),
        action: req.action.clone(),
        output_mode: req.output_mode.clone(),
        output,
        project,
        started_epoch: now,
        targets: req.targets.clone(),
    };
    if let Ok(mut guard) = state.running_actions.lock() {
        guard.push(running);
    }

    let result = runner::run_action(&state.root, &state.tiles_bin, &req);
    if let Ok(mut guard) = state.running_actions.lock() {
        guard.retain(|item| item.id != id);
    }
    state.invalidate_video_cache();
    let result = result.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(result))
}

pub async fn list_running_actions(
    State(state): State<Arc<AppState>>,
) -> Json<Vec<RunningAction>> {
    let actions = state
        .running_actions
        .lock()
        .map(|v| v.clone())
        .unwrap_or_default();
    Json(actions)
}

fn project_from_request(req: &ActionRunRequest) -> Option<String> {
    if let Some(path) = req.params.get("settings_path").and_then(|v| v.as_str()) {
        if let Some(p) = project_from_path(path) {
            return Some(p);
        }
    }
    if let Some(path) = req.params.get("output").and_then(|v| v.as_str()) {
        if let Some(p) = project_from_path(path) {
            return Some(p);
        }
    }
    let mut project: Option<String> = None;
    for target in &req.targets {
        let Some(candidate) = project_from_target(target) else {
            continue;
        };
        if let Some(existing) = &project {
            if existing != &candidate {
                return None;
            }
        } else {
            project = Some(candidate);
        }
    }
    project
}

fn project_from_path(path: &str) -> Option<String> {
    let normalized = path.replace('\\', "/");
    let mut parts = normalized.split('/');
    let first = parts.next()?;
    if first == "src" {
        let project = parts.next()?;
        return Some(project.to_string());
    }
    None
}

fn project_from_target(target: &str) -> Option<String> {
    let normalized = target.replace('\\', "/");
    let mut parts = normalized.split('/');
    let first = parts.next()?;
    if first == "src" {
        return parts.next().map(|p| p.to_string());
    }
    Some(first.to_string())
}

fn output_hint(req: &ActionRunRequest, project: Option<&str>) -> Option<String> {
    if let Some(path) = req.params.get("output").and_then(|v| v.as_str()) {
        if !path.is_empty() {
            return Some(path.to_string());
        }
    }
    match req.output_mode.as_str() {
        "global" => Some(format!("outputs/{}", req.action)),
        "project" => project.map(|p| format!("src/{p}/outputs/{}", req.action)),
        "source" => project
            .map(|p| format!("src/{p}/outputs/{}", req.action))
            .or_else(|| Some("source outputs".to_string())),
        "alongside" => Some("alongside originals".to_string()),
        _ => None,
    }
}
