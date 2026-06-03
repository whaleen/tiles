use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use super::ffprobe::get_video_duration;
use super::fs_scanner::{is_image_file, is_video_file};

pub enum ThumbnailEnsureResult {
    Existing(PathBuf),
    Generated(PathBuf),
}

impl ThumbnailEnsureResult {
    pub fn path(&self) -> &Path {
        match self {
            Self::Existing(path) | Self::Generated(path) => path,
        }
    }
}

pub fn ensure_thumbnail(root: &Path, input: &Path, rel: &str) -> Option<PathBuf> {
    ensure_thumbnail_with_status(root, input, rel).map(|result| result.path().to_path_buf())
}

pub fn ensure_thumbnail_with_status(
    root: &Path,
    input: &Path,
    rel: &str,
) -> Option<ThumbnailEnsureResult> {
    if !input.exists() || !input.is_file() {
        return None;
    }
    if is_image_file(input) {
        return Some(ThumbnailEnsureResult::Existing(input.to_path_buf()));
    }
    if !is_video_file(input) {
        return None;
    }
    let mtime = input
        .metadata()
        .and_then(|m| m.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH)
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let thumb_path = thumb_cache_path(root, rel, mtime);
    if thumb_path.exists() {
        return Some(ThumbnailEnsureResult::Existing(thumb_path));
    }
    if let Some(parent) = thumb_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if generate_thumbnail(input, &thumb_path, root) {
        Some(ThumbnailEnsureResult::Generated(thumb_path))
    } else {
        None
    }
}

fn thumb_cache_path(root: &Path, rel: &str, mtime: u64) -> PathBuf {
    let mut hasher = DefaultHasher::new();
    rel.hash(&mut hasher);
    mtime.hash(&mut hasher);
    let hash = hasher.finish();
    root.join("outputs")
        .join("tui-thumbs")
        .join(format!("{hash:x}.jpg"))
}

fn generate_thumbnail(input: &Path, output: &Path, root: &Path) -> bool {
    let duration = get_video_duration(input, root).unwrap_or(0.0);
    let mid = if duration > 0.0 { duration / 2.0 } else { 0.0 };
    let mid_str = format!("{mid:.3}");
    let out = Command::new("ffmpeg")
        .args(["-ss", &mid_str, "-i"])
        .arg(input)
        .args(["-frames:v", "1", "-q:v", "4", "-vf", "scale=320:-1", "-y"])
        .arg(output)
        .current_dir(root)
        .output();
    matches!(out, Ok(o) if o.status.success())
}
