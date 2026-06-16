use std::path::Path;
use std::process::Command;

use crate::models::VideoInfo;

pub fn get_video_info(path: &Path, root: &Path) -> Option<VideoInfo> {
    let out = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height:format=duration",
            "-of",
            "default=noprint_wrappers=1",
        ])
        .arg(path)
        .current_dir(root)
        .output()
        .ok()?;

    if !out.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&out.stdout);
    let mut duration = 0.0_f64;
    let mut width = 0_u32;
    let mut height = 0_u32;

    for line in text.lines() {
        if let Some(value) = line.strip_prefix("duration=") {
            duration = value.parse::<f64>().unwrap_or(0.0);
        } else if let Some(value) = line.strip_prefix("width=") {
            width = value.parse::<u32>().unwrap_or(0);
        } else if let Some(value) = line.strip_prefix("height=") {
            height = value.parse::<u32>().unwrap_or(0);
        }
    }

    if width == 0 || height == 0 {
        return None;
    }

    Some(VideoInfo {
        duration,
        width,
        height,
    })
}

pub fn get_video_duration(path: &Path, root: &Path) -> Option<f64> {
    let out = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
        ])
        .arg(path)
        .current_dir(root)
        .output()
        .ok()?;

    if !out.status.success() {
        return None;
    }
    String::from_utf8_lossy(&out.stdout)
        .trim()
        .parse::<f64>()
        .ok()
}

/// Whether the file has at least one audio stream.
pub fn has_audio_stream(path: &Path, root: &Path) -> bool {
    let out = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=codec_type",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
        ])
        .arg(path)
        .current_dir(root)
        .output();
    matches!(out, Ok(o) if o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == "audio")
}

pub fn check_ffmpeg() -> bool {
    Command::new("ffmpeg")
        .arg("-version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn check_ffprobe() -> bool {
    Command::new("ffprobe")
        .arg("-version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}
