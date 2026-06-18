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
    let parent = src_full
        .parent()
        .ok_or_else(|| "invalid path".to_string())?;
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
    Ok(MovedVideoPath {
        from: rel,
        to: dest_rel,
    })
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

/// Real durations (seconds) for a batch of src-relative video paths, aligned to
/// the input order (None where unknown/missing). Cached per file in AppState.
#[tauri::command]
pub fn get_video_durations(state: State<AppState>, paths: Vec<String>) -> Vec<Option<f64>> {
    state.get_durations(&paths)
}

/// Ensure (and return metadata for) a clip's scrub filmstrip sprite. The image
/// itself is served at `<media>/filmstrips/<path>`.
#[tauri::command]
pub fn get_filmstrip(
    state: State<AppState>,
    path: String,
) -> Result<crate::models::Filmstrip, String> {
    let root = state.root.read().unwrap().clone();
    if path.contains("..") || Path::new(&path).is_absolute() {
        return Err("invalid path".to_string());
    }
    let full = root.join("src").join(&path);
    if !full.exists() || !full.is_file() {
        return Err("not found".to_string());
    }
    let r = crate::services::filmstrip::ensure_filmstrip(&root, &full, &path)
        .ok_or_else(|| "filmstrip generation failed".to_string())?;
    Ok(crate::models::Filmstrip {
        frame_count: r.frame_count,
        columns: r.columns,
        frame_width: r.frame_width,
        frame_height: r.frame_height,
        duration: r.duration,
    })
}

#[tauri::command]
pub fn get_waveform(
    state: State<AppState>,
    path: String,
) -> Result<crate::models::Waveform, String> {
    let root = state.root.read().unwrap().clone();
    if path.contains("..") || Path::new(&path).is_absolute() {
        return Err("invalid path".to_string());
    }
    let full = root.join("src").join(&path);
    if !full.exists() || !full.is_file() {
        return Err("not found".to_string());
    }
    // No audio stream is an expected, non-error state (silent clip) — report it
    // explicitly so the UI can show a "no audio" placeholder rather than
    // conflating it with a generation failure.
    if !crate::services::ffprobe::has_audio_stream(&full, &root) {
        return Ok(crate::models::Waveform {
            has_audio: false,
            width: 0,
            height: 0,
            duration: 0.0,
        });
    }
    let r = crate::services::waveform::ensure_waveform(&root, &full, &path)
        .ok_or_else(|| "waveform generation failed".to_string())?;
    Ok(crate::models::Waveform {
        has_audio: true,
        width: r.width,
        height: r.height,
        duration: r.duration,
    })
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
    let root = state.root.read().unwrap().clone();
    // Preserve existing behaviour: prefer the human-readable .txt, then srt/vtt/json.
    find_transcript_file(&root, &path, &["txt", "srt", "vtt", "json"]).map(|(_, content)| content)
}

/// A transcript file resolved for a source video, tagged with its format so the
/// frontend can parse the right shape (whisper JSON / WebVTT / SRT / plain text).
#[derive(Debug, Serialize)]
pub struct TranscriptDoc {
    pub format: String,
    pub content: String,
}

#[tauri::command]
pub fn get_transcript_doc(state: State<AppState>, path: String) -> Option<TranscriptDoc> {
    let root = state.root.read().unwrap().clone();
    // Prefer timestamped formats so the viewer can offer click-to-seek; fall
    // back to plain text last.
    find_transcript_file(&root, &path, &["json", "vtt", "srt", "txt"])
        .map(|(format, content)| TranscriptDoc { format, content })
}

/// Locate a transcript for `path` (a src-relative video) by trying `exts` in
/// order; for each ext, checks outputs/transcribe, alongside the source, and the
/// per-project outputs/transcribe dir. Returns `(ext, content)` of the first hit.
fn find_transcript_file(root: &Path, path: &str, exts: &[&str]) -> Option<(String, String)> {
    if path.contains("..") || Path::new(path).is_absolute() {
        return None;
    }
    let stem = {
        let p = Path::new(path);
        let s = p.with_extension("");
        s.to_string_lossy().replace('\\', "/")
    };
    for ext in exts {
        let mut candidates: Vec<PathBuf> = vec![
            root.join("outputs")
                .join("transcribe")
                .join(format!("{stem}.{ext}")),
            root.join("src").join(format!("{stem}.{ext}")),
        ];
        let parts: Vec<&str> = stem.splitn(2, '/').collect();
        if parts.len() == 2 {
            candidates.push(
                root.join("src")
                    .join(parts[0])
                    .join("outputs")
                    .join("transcribe")
                    .join(format!("{}.{ext}", parts[1])),
            );
        }
        for candidate in candidates {
            if candidate.is_file() {
                if let Ok(content) = std::fs::read_to_string(&candidate) {
                    return Some((ext.to_string(), content));
                }
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
