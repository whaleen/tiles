use std::path::Path;
use tauri::State;

use crate::models::{VideoEntry, VideoInfo};
use crate::services::ffprobe;
use crate::state::AppState;

#[tauri::command]
pub fn list_videos(
    state: State<AppState>,
    project: Option<String>,
    search: Option<String>,
    folder: Option<String>,
    recursive: Option<bool>,
) -> Vec<VideoEntry> {
    state.get_videos(
        project.as_deref(),
        search.as_deref(),
        folder.as_deref(),
        recursive,
    )
}

#[tauri::command]
pub fn get_video_info(state: State<AppState>, path: String) -> Result<VideoInfo, String> {
    let root = state.root.read().unwrap().clone();
    if path.contains("..") || Path::new(&path).is_absolute() {
        return Err("invalid path".to_string());
    }
    let full = root.join("src").join(&path);
    if !full.exists() || !full.is_file() {
        return Err("not found".to_string());
    }
    ffprobe::get_video_info(&full, &root).ok_or_else(|| "ffprobe failed".to_string())
}

#[tauri::command]
pub fn get_transcript(state: State<AppState>, path: String) -> Option<String> {
    if path.contains("..") || Path::new(&path).is_absolute() {
        return None;
    }
    let root = state.root.read().unwrap().clone();
    let stem = {
        let p = Path::new(&path);
        let s = p.with_extension("");
        s.to_string_lossy().replace('\\', "/")
    };
    const EXTS: &[&str] = &["txt", "srt", "vtt", "json"];
    let candidates: Vec<std::path::PathBuf> = EXTS.iter().flat_map(|ext| {
        let mut v = vec![
            root.join("outputs").join("transcribe").join(format!("{stem}.{ext}")),
            root.join("src").join(format!("{stem}.{ext}")),
        ];
        let parts: Vec<&str> = stem.splitn(2, '/').collect();
        if parts.len() == 2 {
            v.push(root.join("src").join(parts[0]).join("outputs").join("transcribe").join(format!("{}.{ext}", parts[1])));
        }
        v
    }).collect();
    for candidate in candidates {
        if candidate.is_file() {
            if let Ok(content) = std::fs::read_to_string(&candidate) {
                return Some(content);
            }
        }
    }
    None
}

#[tauri::command]
pub fn delete_video(state: State<AppState>, path: String) -> Result<(), String> {
    let root = state.root.read().unwrap().clone();
    if path.contains("..") || Path::new(&path).is_absolute() {
        return Err("invalid path".to_string());
    }
    let full = root.join("src").join(&path);
    if !full.exists() || !full.is_file() {
        return Err("not found".to_string());
    }
    std::fs::remove_file(&full).map_err(|e| e.to_string())?;
    state.invalidate_video_cache();
    Ok(())
}
