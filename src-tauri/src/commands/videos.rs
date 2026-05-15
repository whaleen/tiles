use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::State;

use crate::models::{VideoEntry, VideoInfo};
use crate::services::ffprobe;
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct MovedVideoPath {
    pub from: String,
    pub to: String,
}

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
pub fn rename_media(
    state: State<AppState>,
    project: String,
    path: String,
    new_name: String,
) -> Result<MovedVideoPath, String> {
    let root = state.root.read().unwrap().clone();
    let rel = normalize_media_rel(&path, &project)?;
    let new_name = new_name.trim();
    if !is_valid_file_name(new_name) {
        return Err("invalid file name".to_string());
    }

    let src_full = root.join("src").join(&rel);
    if !src_full.exists() || !src_full.is_file() {
        return Err("not found".to_string());
    }
    let parent = src_full.parent().ok_or_else(|| "invalid path".to_string())?;
    let dest_full = parent.join(new_name);
    if dest_full.exists() {
        return Err("already exists".to_string());
    }
    std::fs::rename(&src_full, &dest_full).map_err(|e| e.to_string())?;
    let dest_rel = dest_full
        .strip_prefix(root.join("src"))
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .map_err(|_| "path error".to_string())?;
    state.invalidate_video_cache();
    Ok(MovedVideoPath { from: rel, to: dest_rel })
}

#[tauri::command]
pub fn reveal_media(state: State<AppState>, project: String, path: String) -> Result<(), String> {
    let root = state.root.read().unwrap().clone();
    let rel = normalize_media_rel(&path, &project)?;
    let full = root.join("src").join(&rel);
    if !full.exists() || !full.is_file() {
        return Err("not found".to_string());
    }
    std::process::Command::new("open")
        .arg("-R")
        .arg(&full)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
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
    let candidates: Vec<std::path::PathBuf> = EXTS
        .iter()
        .flat_map(|ext| {
            let mut v = vec![
                root.join("outputs")
                    .join("transcribe")
                    .join(format!("{stem}.{ext}")),
                root.join("src").join(format!("{stem}.{ext}")),
            ];
            let parts: Vec<&str> = stem.splitn(2, '/').collect();
            if parts.len() == 2 {
                v.push(
                    root.join("src")
                        .join(parts[0])
                        .join("outputs")
                        .join("transcribe")
                        .join(format!("{}.{ext}", parts[1])),
                );
            }
            v
        })
        .collect();
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

fn normalize_media_rel(path: &str, project: &str) -> Result<String, String> {
    let rel = path.replace('\\', "/");
    if rel.is_empty() || rel.contains("..") || Path::new(&rel).is_absolute() {
        return Err("invalid path".to_string());
    }
    if !rel.starts_with(&format!("{project}/")) {
        return Err("path is outside project".to_string());
    }
    if PathBuf::from(&rel)
        .components()
        .any(|c| !matches!(c, std::path::Component::Normal(_)))
    {
        return Err("invalid path".to_string());
    }
    Ok(rel)
}

fn is_valid_file_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('.')
        && !name.contains("..")
        && !name.contains('/')
        && !name.contains('\\')
        && !Path::new(name).is_absolute()
        && name.chars().all(|c| !c.is_control())
}
