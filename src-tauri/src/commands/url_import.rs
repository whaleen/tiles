use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::State;

use crate::models::{
    UrlImportAnalysis, UrlImportCandidate, UrlImportDownloadRequest, UrlImportDownloadResult,
    UrlImportOptions, UrlImportSourceAnalysis, YtDlpStatus,
};
use crate::state::AppState;

#[tauri::command]
pub async fn check_ytdlp() -> YtDlpStatus {
    let yt_dlp_bin = find_bin("yt-dlp");
    let ffmpeg_bin = find_bin("ffmpeg");
    let gallery_dl_bin = find_bin("gallery-dl");
    let yt_dlp_version = command_version(&yt_dlp_bin, &["--version"]);
    let ffmpeg_version = command_version(&ffmpeg_bin, &["-version"]);
    let gallery_dl_version = command_version(&gallery_dl_bin, &["--version"]);
    YtDlpStatus {
        yt_dlp: yt_dlp_version.is_some(),
        yt_dlp_version,
        ffmpeg: ffmpeg_version.is_some(),
        ffmpeg_version,
        gallery_dl: gallery_dl_version.is_some(),
        gallery_dl_version,
    }
}

#[tauri::command]
pub async fn analyze_url_import(
    urls: Vec<String>,
    mode: String,
    tool: Option<String>,
    cookies_from_browser: Option<String>,
) -> Result<UrlImportAnalysis, String> {
    let deep = mode == "deep";
    let use_gallery_dl = tool.as_deref() == Some("gallery-dl");
    let mut sources = Vec::new();
    for raw_url in urls {
        let url = raw_url.trim().to_string();
        if url.is_empty() {
            continue;
        }
        let analyzed = tokio::task::spawn_blocking({
            let url = url.clone();
            let cookies_from_browser = cookies_from_browser.clone();
            move || {
                if use_gallery_dl {
                    analyze_one_url_gallery_dl(&url)
                } else {
                    analyze_one_url(&url, deep, cookies_from_browser.as_deref())
                }
            }
        })
        .await
        .map_err(|e| e.to_string())?;
        sources.push(analyzed);
    }
    Ok(UrlImportAnalysis { sources })
}

#[tauri::command]
pub async fn download_url_import(
    state: State<'_, AppState>,
    req: UrlImportDownloadRequest,
) -> Result<UrlImportDownloadResult, String> {
    let root = state.root.read().unwrap().clone();
    validate_project_segment(&req.project)?;
    validate_folder(&req.folder)?;
    let dest = root.join("src").join(&req.project).join(&req.folder);
    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;

    let urls: Vec<String> = req
        .urls
        .iter()
        .map(|u| u.trim().to_string())
        .filter(|u| !u.is_empty())
        .collect();
    if urls.is_empty() {
        return Err("no URLs selected".to_string());
    }

    let options = req.options.unwrap_or_default();
    let result = tokio::task::spawn_blocking(move || download_urls(&dest, &urls, &options))
        .await
        .map_err(|e| e.to_string())?;
    state.invalidate_video_cache();
    result
}

fn analyze_one_url(
    url: &str,
    deep: bool,
    cookies_from_browser: Option<&str>,
) -> UrlImportSourceAnalysis {
    let mut cmd = Command::new(find_bin("yt-dlp"));
    cmd.arg("--dump-single-json")
        .arg("--skip-download")
        .arg("--no-warnings")
        .arg("--ignore-errors")
        .arg("--yes-playlist");
    if !deep {
        cmd.arg("--flat-playlist");
    }
    if let Some(browser) = cookies_from_browser.filter(|s| !s.is_empty()) {
        cmd.arg("--cookies-from-browser").arg(browser);
    }
    cmd.arg(url);

    let output = match cmd.output() {
        Ok(output) => output,
        Err(err) => {
            return UrlImportSourceAnalysis {
                url: url.to_string(),
                title: None,
                kind: "error".to_string(),
                candidate_count: 0,
                candidates: vec![],
                error: Some(format!("failed to run yt-dlp: {err}")),
            }
        }
    };
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return UrlImportSourceAnalysis {
            url: url.to_string(),
            title: None,
            kind: "error".to_string(),
            candidate_count: 0,
            candidates: vec![],
            error: Some(if err.is_empty() {
                "yt-dlp analysis failed".to_string()
            } else {
                err
            }),
        };
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = match serde_json::from_str(&stdout) {
        Ok(v) => v,
        Err(err) => {
            return UrlImportSourceAnalysis {
                url: url.to_string(),
                title: None,
                kind: "error".to_string(),
                candidate_count: 0,
                candidates: vec![],
                error: Some(format!("failed to parse yt-dlp JSON: {err}")),
            }
        }
    };

    let mut candidates = Vec::new();
    if let Some(entries) = json.get("entries").and_then(|v| v.as_array()) {
        for (idx, entry) in entries.iter().enumerate() {
            if entry.is_null() {
                continue;
            }
            if let Some(candidate) = candidate_from_value(entry, Some(idx + 1), deep) {
                candidates.push(candidate);
            }
        }
    } else if let Some(candidate) = candidate_from_value(&json, None, deep) {
        candidates.push(candidate);
    }

    let kind = if json.get("entries").is_some() {
        "playlist"
    } else {
        json.get("_type")
            .and_then(|v| v.as_str())
            .unwrap_or("video")
    };
    UrlImportSourceAnalysis {
        url: url.to_string(),
        title: json.get("title").and_then(|v| v.as_str()).map(String::from),
        kind: kind.to_string(),
        candidate_count: candidates.len(),
        candidates,
        error: None,
    }
}

fn candidate_from_value(
    value: &serde_json::Value,
    playlist_index: Option<usize>,
    deep: bool,
) -> Option<UrlImportCandidate> {
    let title = value
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Untitled");
    let webpage_url = value
        .get("webpage_url")
        .or_else(|| value.get("url"))
        .and_then(|v| v.as_str())?
        .to_string();
    let formats = value
        .get("formats")
        .and_then(|v| v.as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    let ext = value
        .get("ext")
        .and_then(|v| v.as_str())
        .map(String::from)
        .or_else(|| infer_ext_from_formats(value));
    let resolution = value
        .get("resolution")
        .and_then(|v| v.as_str())
        .map(String::from)
        .or_else(|| infer_resolution(value));
    let subtitles = language_keys(value.get("subtitles"));
    let automatic_captions = language_keys(value.get("automatic_captions"));
    Some(UrlImportCandidate {
        id: value.get("id").and_then(|v| v.as_str()).map(String::from),
        title: title.to_string(),
        url: webpage_url,
        webpage_url: value
            .get("webpage_url")
            .and_then(|v| v.as_str())
            .map(String::from),
        uploader: value
            .get("uploader")
            .and_then(|v| v.as_str())
            .map(String::from),
        duration: value.get("duration").and_then(|v| v.as_f64()),
        duration_string: value
            .get("duration_string")
            .or_else(|| value.get("duration_str"))
            .or_else(|| value.get("duration").filter(|v| v.is_string()))
            .and_then(|v| v.as_str())
            .map(String::from),
        thumbnail: value
            .get("thumbnail")
            .and_then(|v| v.as_str())
            .map(String::from),
        ext,
        resolution,
        playlist_index,
        kind: value
            .get("_type")
            .and_then(|v| v.as_str())
            .unwrap_or("video")
            .to_string(),
        format_count: formats,
        has_formats: if deep { formats > 0 } else { true },
        subtitles,
        automatic_captions,
    })
}

fn infer_ext_from_formats(value: &serde_json::Value) -> Option<String> {
    let formats = value.get("formats")?.as_array()?;
    let mut exts = formats
        .iter()
        .filter_map(|format| format.get("ext").and_then(|v| v.as_str()))
        .filter(|ext| *ext != "none" && !ext.is_empty())
        .map(String::from)
        .collect::<Vec<_>>();
    exts.sort();
    exts.dedup();
    if exts.iter().any(|ext| ext == "mp4") {
        Some("mp4".to_string())
    } else {
        exts.into_iter().next()
    }
}

fn infer_resolution(value: &serde_json::Value) -> Option<String> {
    if let Some(height) = value.get("height").and_then(|v| v.as_u64()) {
        return Some(format!("{height}p"));
    }
    let width = value.get("width").and_then(|v| v.as_u64())?;
    let height = value.get("height").and_then(|v| v.as_u64())?;
    Some(format!("{width}×{height}"))
}

fn language_keys(value: Option<&serde_json::Value>) -> Vec<String> {
    value
        .and_then(|v| v.as_object())
        .map(|obj| obj.keys().cloned().collect())
        .unwrap_or_default()
}

fn download_urls(
    dest: &Path,
    urls: &[String],
    options: &UrlImportOptions,
) -> Result<UrlImportDownloadResult, String> {
    if options.tool.as_deref() == Some("gallery-dl") {
        let mut all_downloaded = Vec::new();
        let mut all_failures = Vec::new();
        for url in urls {
            match download_gallery_dl(dest, url, options) {
                Ok(r) => {
                    all_downloaded.extend(r.downloaded);
                    all_failures.extend(r.failures);
                }
                Err(e) => all_failures.push(e),
            }
        }
        return Ok(UrlImportDownloadResult {
            downloaded: all_downloaded,
            failures: all_failures,
        });
    }

    let include_images = options.include_images.unwrap_or(false);
    let before = list_media_files(dest, include_images);
    let mut downloaded = Vec::new();
    let mut failures = Vec::new();

    for url in urls {
        let mut cmd = Command::new(find_bin("yt-dlp"));
        cmd.arg("--newline")
            .arg("--ignore-errors")
            .arg("--no-playlist")
            .arg("--no-overwrites")
            .arg("--restrict-filenames")
            .arg("--windows-filenames")
            .arg("--merge-output-format")
            .arg("mp4")
            .arg("-f")
            .arg(format_selector(options.quality.as_deref()))
            .arg("-o")
            .arg(dest.join("%(title).200B [%(id)s].%(ext)s"));

        if options.write_info_json.unwrap_or(false) {
            cmd.arg("--write-info-json");
        }
        if options.write_thumbnail.unwrap_or(false) {
            cmd.arg("--write-thumbnail");
        }
        if options.write_subtitles.unwrap_or(true) {
            cmd.arg("--write-subs");
        }
        if options.write_auto_captions.unwrap_or(true) {
            cmd.arg("--write-auto-subs");
        }
        if options.write_subtitles.unwrap_or(true) || options.write_auto_captions.unwrap_or(true) {
            cmd.arg("--sub-langs")
                .arg(options.subtitle_languages.as_deref().unwrap_or("en.*,en"))
                .arg("--sub-format")
                .arg("vtt/srt/best");
        }
        if let Some(browser) = options
            .cookies_from_browser
            .as_deref()
            .filter(|s| !s.is_empty())
        {
            cmd.arg("--cookies-from-browser").arg(browser);
        }
        cmd.arg(url);
        match cmd.output() {
            Ok(out) if out.status.success() => {}
            Ok(out) => {
                let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
                failures.push(format!("{url}: {stderr}"));
            }
            Err(err) => failures.push(format!("{url}: {err}")),
        }
    }

    let include_images = options.include_images.unwrap_or(false);
    for path in list_media_files(dest, include_images) {
        normalize_subtitle_for_video(&path);
        if !before.contains(&path) {
            downloaded.push(
                path.file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string(),
            );
        }
    }
    Ok(UrlImportDownloadResult {
        downloaded,
        failures,
    })
}

fn normalize_subtitle_for_video(video: &Path) {
    let Some(parent) = video.parent() else {
        return;
    };
    let Some(stem) = video.file_stem().and_then(|s| s.to_str()) else {
        return;
    };
    let Ok(read) = std::fs::read_dir(parent) else {
        return;
    };
    let mut candidates = Vec::new();
    for entry in read.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !matches!(ext.as_str(), "vtt" | "srt") {
            continue;
        }
        let Some(file_stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if file_stem == stem || file_stem.starts_with(&format!("{stem}.")) {
            candidates.push(path);
        }
    }
    candidates.sort_by_key(|p| {
        let name = p
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        (
            if name.contains(".en") { 0 } else { 1 },
            if name.ends_with(".vtt") { 0 } else { 1 },
            name,
        )
    });
    let Some(best) = candidates.first() else {
        return;
    };
    let ext = best.extension().and_then(|e| e.to_str()).unwrap_or("vtt");
    let canonical = parent.join(format!("{stem}.{ext}"));
    if canonical != *best && !canonical.exists() {
        let _ = std::fs::copy(best, canonical);
    }
}

fn analyze_one_url_gallery_dl(url: &str) -> UrlImportSourceAnalysis {
    let mut cmd = Command::new(find_bin("gallery-dl"));
    cmd.arg("-j").arg("--simulate").arg(url); // -j = dump JSON, --simulate = no download
    let output = match cmd.output() {
        Ok(o) => o,
        Err(err) => {
            return UrlImportSourceAnalysis {
                url: url.to_string(),
                title: None,
                kind: "error".to_string(),
                candidate_count: 0,
                candidates: vec![],
                error: Some(format!("failed to run gallery-dl: {err}")),
            };
        }
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    let candidates = parse_gallery_dl_ndjson(&stdout);
    let title = candidates.first().and_then(|c| c.uploader.clone());
    let error = if !output.status.success() {
        let e = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if e.is_empty() {
            None
        } else {
            Some(e)
        }
    } else {
        None
    };
    UrlImportSourceAnalysis {
        url: url.to_string(),
        title,
        kind: if candidates.len() > 1 {
            "gallery"
        } else {
            "image"
        }
        .to_string(),
        candidate_count: candidates.len(),
        candidates,
        error,
    }
}

fn parse_gallery_dl_ndjson(stdout: &str) -> Vec<UrlImportCandidate> {
    let mut candidates = Vec::new();
    let mut file_index: usize = 0;
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let arr: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let arr = match arr.as_array() {
            Some(a) => a,
            None => continue,
        };
        // version 0 = directory/gallery info, skip
        if arr.first().and_then(|v| v.as_u64()).unwrap_or(0) != 1 {
            continue;
        }
        // metadata is the last element
        let meta = match arr.last().and_then(|v| v.as_object()) {
            Some(m) => m,
            None => continue,
        };
        let url = match meta.get("url").and_then(|v| v.as_str()) {
            Some(u) => u.to_string(),
            None => continue,
        };
        file_index += 1;
        let filename = meta
            .get("filename")
            .and_then(|v| v.as_str())
            .unwrap_or("untitled");
        let extension = meta
            .get("extension")
            .and_then(|v| v.as_str())
            .map(String::from);
        let title = meta
            .get("title")
            .or_else(|| meta.get("description"))
            .or_else(|| meta.get("content"))
            .and_then(|v| v.as_str())
            .map(|s| {
                let t = s.trim();
                if t.len() > 120 {
                    &t[..120]
                } else {
                    t
                }
            })
            .map(String::from)
            .unwrap_or_else(|| format!("{filename}.{}", extension.as_deref().unwrap_or("img")));
        let resolution = {
            let w = meta.get("width").and_then(|v| v.as_u64());
            let h = meta.get("height").and_then(|v| v.as_u64());
            match (w, h) {
                (Some(w), Some(h)) => Some(format!("{w}×{h}")),
                _ => None,
            }
        };
        candidates.push(UrlImportCandidate {
            id: meta.get("id").map(|v| v.to_string()),
            title,
            url,
            webpage_url: meta
                .get("post_url")
                .or_else(|| meta.get("webpage_url"))
                .and_then(|v| v.as_str())
                .map(String::from),
            uploader: meta
                .get("uploader")
                .or_else(|| meta.get("account"))
                .or_else(|| meta.get("artist"))
                .and_then(|v| v.as_str())
                .map(String::from),
            duration: None,
            duration_string: None,
            thumbnail: meta
                .get("thumbnail")
                .and_then(|v| v.as_str())
                .map(String::from),
            ext: extension,
            resolution,
            playlist_index: Some(file_index),
            kind: "image".to_string(),
            format_count: 0,
            has_formats: false,
            subtitles: vec![],
            automatic_captions: vec![],
        });
    }
    candidates
}

fn download_gallery_dl(
    dest: &Path,
    url: &str,
    options: &UrlImportOptions,
) -> Result<UrlImportDownloadResult, String> {
    let include_images = options.include_images.unwrap_or(true);
    let before: std::collections::HashSet<_> = list_media_files_recursive(dest, include_images)
        .into_iter()
        .collect();
    let mut cmd = Command::new(find_bin("gallery-dl"));
    cmd.arg("-d").arg(dest).arg("--no-part").arg(url);
    let mut failures = Vec::new();
    match cmd.output() {
        Ok(out) if out.status.success() => {}
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            if !stderr.is_empty() {
                failures.push(format!("{url}: {stderr}"));
            }
        }
        Err(err) => failures.push(format!("{url}: {err}")),
    }
    let downloaded = list_media_files_recursive(dest, include_images)
        .into_iter()
        .filter(|p| !before.contains(p))
        .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().to_string()))
        .collect();
    Ok(UrlImportDownloadResult {
        downloaded,
        failures,
    })
}

fn list_media_files_recursive(dir: &Path, include_images: bool) -> Vec<std::path::PathBuf> {
    let Ok(read) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut paths = Vec::new();
    for entry in read.flatten() {
        let path = entry.path();
        if path.is_dir() {
            paths.extend(list_media_files_recursive(&path, include_images));
        } else if path.is_file() {
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            let is_video = matches!(ext.as_str(), "mp4" | "mov" | "mkv" | "webm" | "m4v");
            let is_image =
                include_images && matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "gif" | "webp");
            if is_video || is_image {
                paths.push(path);
            }
        }
    }
    paths.sort();
    paths
}

fn format_selector(quality: Option<&str>) -> &'static str {
    match quality.unwrap_or("best-compatible") {
        "2160" => "bv*[height<=2160][ext=mp4]+ba[ext=m4a]/b[height<=2160][ext=mp4]/bv*[height<=2160]+ba/b[height<=2160]",
        "1440" => "bv*[height<=1440][ext=mp4]+ba[ext=m4a]/b[height<=1440][ext=mp4]/bv*[height<=1440]+ba/b[height<=1440]",
        "1080" => "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/bv*[height<=1080]+ba/b[height<=1080]",
        "720" => "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/bv*[height<=720]+ba/b[height<=720]",
        "audio" => "ba/bestaudio/best",
        "best" => "bv*+ba/b",
        _ => "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b",
    }
}

fn list_media_files(dir: &Path, include_images: bool) -> Vec<std::path::PathBuf> {
    let Ok(read) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut paths = Vec::new();
    for entry in read.flatten() {
        let path = entry.path();
        if path.is_file() {
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            let is_video = matches!(ext.as_str(), "mp4" | "mov" | "mkv" | "webm" | "m4v");
            let is_image =
                include_images && matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "gif" | "webp");
            if is_video || is_image {
                paths.push(path);
            }
        }
    }
    paths.sort();
    paths
}

fn command_version(bin: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new(bin).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout.lines().next().map(|s| s.to_string())
}

fn find_bin(name: &str) -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = [
        format!("/opt/homebrew/bin/{name}"),
        format!("/usr/local/bin/{name}"),
        format!("{home}/.local/bin/{name}"),
        format!("{home}/.cargo/bin/{name}"),
    ];
    for candidate in candidates {
        let path = PathBuf::from(candidate);
        if path.exists() {
            return path;
        }
    }
    PathBuf::from(name)
}

fn validate_project_segment(value: &str) -> Result<(), String> {
    if value.is_empty() || value.contains("..") || value.contains('/') || value.contains('\\') {
        return Err("invalid project".to_string());
    }
    Ok(())
}

fn validate_folder(value: &str) -> Result<(), String> {
    if value.contains("..") || Path::new(value).is_absolute() {
        return Err("invalid folder".to_string());
    }
    Ok(())
}
