use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::UNIX_EPOCH;

use super::fs_scanner::is_video_file;

/// A generated waveform image (ffmpeg `showwavespic`) for one clip's full
/// source audio, covering [0, duration].
pub struct WaveformResult {
    pub path: PathBuf,
    pub width: u32,
    pub height: u32,
    pub duration: f64,
}

const HEIGHT: u32 = 64;
const PX_PER_SECOND: f64 = 80.0;
const MIN_WIDTH: i64 = 600;
const MAX_WIDTH: i64 = 6000;
/// slate-400 — reads on both light and dark lane backgrounds.
const WAVE_COLOR: &str = "#94a3b8";

/// Generate (or reuse a cached) waveform PNG for a video's audio: one image
/// spanning [0, duration] of the source. The frontend slices [trimIn, trimOut]
/// per clip and scales it to the clip's on-screen width. Returns `None` if the
/// file has no audio stream (lane then renders a "no audio" placeholder).
pub fn ensure_waveform(root: &Path, input: &Path, rel: &str) -> Option<WaveformResult> {
    if !input.exists() || !input.is_file() || !is_video_file(input) {
        return None;
    }
    if !crate::services::ffprobe::has_audio_stream(input, root) {
        return None;
    }
    let duration = crate::services::ffprobe::get_video_duration(input, root)?;
    if !duration.is_finite() || duration <= 0.0 {
        return None;
    }

    let width = ((duration * PX_PER_SECOND).round() as i64).clamp(MIN_WIDTH, MAX_WIDTH) as u32;
    let height = HEIGHT;

    let mtime = input
        .metadata()
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let path = cache_path(root, rel, mtime, width, height);
    if path.exists() {
        return Some(WaveformResult { path, width, height, duration });
    }
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    // Mono waveform; key out the black background so the wave reads on any lane.
    let filter = format!(
        "aformat=channel_layouts=mono,showwavespic=s={width}x{height}:colors={WAVE_COLOR},format=rgba,colorkey=0x000000:0.10:0.05"
    );
    let out = Command::new("ffmpeg")
        .args(["-i"])
        .arg(input)
        .args(["-filter_complex", &filter, "-frames:v", "1", "-y"])
        .arg(&path)
        .current_dir(root)
        .output();

    if matches!(out, Ok(o) if o.status.success()) && path.exists() {
        Some(WaveformResult { path, width, height, duration })
    } else {
        None
    }
}

fn cache_path(root: &Path, rel: &str, mtime: u64, width: u32, height: u32) -> PathBuf {
    let mut hasher = DefaultHasher::new();
    rel.hash(&mut hasher);
    mtime.hash(&mut hasher);
    width.hash(&mut hasher);
    height.hash(&mut hasher);
    let hash = hasher.finish();
    root.join("outputs")
        .join("tui-thumbs")
        .join("waveforms")
        .join(format!("{hash:x}.png"))
}
