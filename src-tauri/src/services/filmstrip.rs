use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::UNIX_EPOCH;

use super::fs_scanner::is_video_file;

/// A generated filmstrip (sprite sheet of evenly-sampled frames) for one clip.
pub struct FilmstripResult {
    pub path: PathBuf,
    /// Number of frames in the strip (cells), covering [0, duration] evenly.
    pub frame_count: u32,
    /// Frames per row in the grid.
    pub columns: u32,
    pub frame_width: u32,
    pub frame_height: u32,
    pub duration: f64,
}

const FRAME_WIDTH: u32 = 160;
const COLUMNS: u32 = 10;
const FRAMES_PER_SECOND: f64 = 2.0;
const MIN_FRAMES: i64 = 12;
const MAX_FRAMES: i64 = 200;

/// Generate (or reuse a cached) filmstrip for a video: a single sprite image of
/// `frame_count` frames sampled evenly across the clip, tiled in a grid. The
/// frontend maps the playhead's source time to a cell, so scrubbing is an
/// instant image blit instead of seeking/decoding a video.
pub fn ensure_filmstrip(root: &Path, input: &Path, rel: &str) -> Option<FilmstripResult> {
    if !input.exists() || !input.is_file() || !is_video_file(input) {
        return None;
    }
    let info = crate::services::ffprobe::get_video_info(input, root)?;
    let duration = info.duration;
    if !duration.is_finite() || duration <= 0.0 {
        return None;
    }
    let (src_w, src_h) = (info.width.max(1), info.height.max(1));

    let frame_count = ((duration * FRAMES_PER_SECOND).round() as i64).clamp(MIN_FRAMES, MAX_FRAMES) as u32;
    let columns = COLUMNS;
    let rows = frame_count.div_ceil(columns);
    let frame_width = FRAME_WIDTH;
    let mut frame_height =
        ((frame_width as f64) * (src_h as f64) / (src_w as f64)).round() as u32;
    if frame_height < 2 {
        frame_height = 90;
    }
    if frame_height % 2 != 0 {
        frame_height += 1;
    }

    let mtime = input
        .metadata()
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let path = cache_path(root, rel, mtime, frame_count, frame_height);
    if path.exists() {
        return Some(FilmstripResult {
            path,
            frame_count,
            columns,
            frame_width,
            frame_height,
            duration,
        });
    }
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    // Sample `frame_count` frames evenly, scale to the cell size, tile into a grid.
    let rate = frame_count as f64 / duration;
    let vf = format!(
        "fps={rate:.6},scale={frame_width}:{frame_height},tile={columns}x{rows}"
    );
    let out = Command::new("ffmpeg")
        .args(["-i"])
        .arg(input)
        .args(["-frames:v", "1", "-q:v", "4", "-vf", &vf, "-y"])
        .arg(&path)
        .current_dir(root)
        .output();

    if matches!(out, Ok(o) if o.status.success()) && path.exists() {
        Some(FilmstripResult {
            path,
            frame_count,
            columns,
            frame_width,
            frame_height,
            duration,
        })
    } else {
        None
    }
}

fn cache_path(root: &Path, rel: &str, mtime: u64, frame_count: u32, frame_height: u32) -> PathBuf {
    let mut hasher = DefaultHasher::new();
    rel.hash(&mut hasher);
    mtime.hash(&mut hasher);
    frame_count.hash(&mut hasher);
    frame_height.hash(&mut hasher);
    let hash = hasher.finish();
    root.join("outputs")
        .join("tui-thumbs")
        .join("filmstrips")
        .join(format!("{hash:x}.jpg"))
}
