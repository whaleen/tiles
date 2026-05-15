use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::{OutputEntry, OutputRun, ProjectDetail, ProjectSummary, VideoEntry};

const VIDEO_EXTENSIONS: &[&str] = &[
    ".mp4", ".mov", ".avi", ".mkv", ".flv", ".wmv", ".m4v", ".webm",
];
const IMAGE_EXTENSIONS: &[&str] = &[
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff",
];

pub fn is_video_file(path: &Path) -> bool {
    let ext = match path.extension() {
        Some(e) => format!(".{}", e.to_string_lossy().to_lowercase()),
        None => return false,
    };
    VIDEO_EXTENSIONS.iter().any(|v| *v == ext)
}

pub fn is_image_file(path: &Path) -> bool {
    let ext = match path.extension() {
        Some(e) => format!(".{}", e.to_string_lossy().to_lowercase()),
        None => return false,
    };
    IMAGE_EXTENSIONS.iter().any(|v| *v == ext)
}

pub fn is_media_file(path: &Path) -> bool {
    is_video_file(path) || is_image_file(path)
}

pub fn is_transcript_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .map(|ext| TRANSCRIPT_EXTENSIONS.iter().any(|v| *v == ext))
        .unwrap_or(false)
}

pub fn is_output_file(path: &Path) -> bool {
    is_media_file(path) || is_transcript_file(path)
}

fn output_kind(path: &Path) -> String {
    if is_video_file(path) {
        "video".to_string()
    } else if is_image_file(path) {
        "image".to_string()
    } else if is_transcript_file(path) {
        "text".to_string()
    } else {
        "other".to_string()
    }
}

fn should_skip_source_dir(path: &Path) -> bool {
    matches!(
        path.file_name().and_then(|s| s.to_str()),
        Some(".thumbs" | ".tiles" | ".git")
    )
}

pub fn list_projects(root: &Path) -> Vec<ProjectSummary> {
    let src = root.join("src");
    if !src.exists() || !src.is_dir() {
        return Vec::new();
    }
    let entries = match fs::read_dir(&src) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    const RESERVED: &[&str] = &["src", "outputs", "configs", "logs"];

    let mut projects: Vec<ProjectSummary> = entries
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || RESERVED.contains(&name.as_str()) {
                return None;
            }
            Some(ProjectSummary {
                path: name.clone(),
                name,
            })
        })
        .collect();
    projects.sort_by(|a, b| a.name.cmp(&b.name));
    projects
}

pub fn get_project_detail(root: &Path, name: &str) -> Option<ProjectDetail> {
    let project_dir = root.join("src").join(name);
    if !project_dir.exists() || !project_dir.is_dir() {
        return None;
    }

    let mut video_count = 0;
    let mut subfolders = Vec::new();

    let mut stack = vec![project_dir.clone()];
    while let Some(dir) = stack.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(v) => v,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if should_skip_source_dir(&path) {
                    continue;
                }
                if let Ok(rel) = path.strip_prefix(&project_dir) {
                    let rel_str = rel.to_string_lossy().replace('\\', "/");
                    if !rel_str.is_empty() {
                        subfolders.push(rel_str);
                    }
                }
                stack.push(path);
            } else if path.is_file() && is_video_file(&path) {
                video_count += 1;
            }
        }
    }
    subfolders.sort();

    Some(ProjectDetail {
        name: name.to_string(),
        path: name.to_string(),
        video_count,
        subfolders,
    })
}

pub fn list_videos(
    root: &Path,
    project: Option<&str>,
    search: Option<&str>,
    folder: Option<&str>,
    recursive: Option<bool>,
) -> Vec<VideoEntry> {
    let src = root.join("src");
    if !src.exists() || !src.is_dir() {
        return Vec::new();
    }

    let start_dir = match project {
        Some(p) => {
            if !is_safe_path_segment(p) {
                return Vec::new();
            }
            let mut d = src.join(p);
            if let Some(folder) = folder
                .map(|f| f.trim_matches('/'))
                .filter(|f| !f.is_empty())
            {
                if !is_safe_rel_path(folder) {
                    return Vec::new();
                }
                d = d.join(folder);
            }
            if !d.exists() || !d.is_dir() {
                return Vec::new();
            }
            d
        }
        None => src.clone(),
    };

    let recursive = recursive.unwrap_or(true);
    let mut out = Vec::new();
    let mut stack = vec![start_dir];
    while let Some(dir) = stack.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(v) => v,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if recursive && !should_skip_source_dir(&path) {
                    stack.push(path);
                }
                continue;
            }
            if !path.is_file() || !is_media_file(&path) {
                continue;
            }
            let rel_path = match path.strip_prefix(&src) {
                Ok(r) => r.to_string_lossy().replace('\\', "/"),
                Err(_) => continue,
            };
            let folder = match path.parent().and_then(|p| p.strip_prefix(&src).ok()) {
                Some(p) => p.to_string_lossy().replace('\\', "/"),
                None => String::new(),
            };
            let name = path
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| rel_path.clone());

            if let Some(q) = search {
                let q_lower = q.to_lowercase();
                if !name.to_lowercase().contains(&q_lower)
                    && !folder.to_lowercase().contains(&q_lower)
                {
                    continue;
                }
            }

            let has_transcript = check_has_transcript(&root, &rel_path);
            let duration = if is_video_file(&path) {
                crate::services::ffprobe::get_video_duration(&path, root)
            } else {
                None
            };
            let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
            out.push(VideoEntry {
                folder,
                name,
                rel_path,
                duration,
                has_transcript,
                size_bytes,
            });
        }
    }
    out.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    out
}

const TRANSCRIPT_EXTENSIONS: &[&str] = &["txt", "srt", "vtt", "json"];

/// Check whether a transcript file exists for a source video at `rel_path`
/// (relative to `src/`, e.g. "project-a/footage/clip.mp4").
pub fn resolve_transcript_source_video(root: &Path, transcript_rel: &str) -> Option<String> {
    let stem = Path::new(transcript_rel)
        .with_extension("")
        .to_string_lossy()
        .replace('\\', "/");

    let source_stem = if let Some(rest) = stem.strip_prefix("outputs/transcribe/") {
        rest.to_string()
    } else if let Some(rest) = stem.strip_prefix("src/") {
        let parts: Vec<&str> = rest.split('/').collect();
        if parts.len() >= 4 && parts[1] == "outputs" && parts[2] == "transcribe" {
            let project = parts[0];
            let mut source_rest = parts[3..].join("/");
            // Compatibility with older transcripts written as
            // src/<project>/outputs/transcribe/<project>/...
            if source_rest.starts_with(&format!("{project}/")) {
                source_rest = source_rest[project.len() + 1..].to_string();
            }
            format!("{project}/{source_rest}")
        } else {
            return None;
        }
    } else {
        return None;
    };

    find_source_video_for_stem(root, &source_stem)
}

fn find_source_video_for_stem(root: &Path, source_stem: &str) -> Option<String> {
    let src = root.join("src");
    let stem_path = src.join(source_stem);
    for ext in VIDEO_EXTENSIONS {
        let ext = ext.trim_start_matches('.');
        let candidate = stem_path.with_extension(ext);
        if candidate.is_file() {
            return candidate
                .strip_prefix(&src)
                .ok()
                .map(|p| p.to_string_lossy().replace('\\', "/"));
        }
        let candidate_upper = stem_path.with_extension(ext.to_uppercase());
        if candidate_upper.is_file() {
            return candidate_upper
                .strip_prefix(&src)
                .ok()
                .map(|p| p.to_string_lossy().replace('\\', "/"));
        }
    }

    let parent = stem_path.parent()?;
    let wanted = stem_path.file_stem()?.to_string_lossy().to_lowercase();
    for entry in fs::read_dir(parent).ok()?.flatten() {
        let path = entry.path();
        if !path.is_file() || !is_video_file(&path) {
            continue;
        }
        let candidate_stem = path.file_stem()?.to_string_lossy().to_lowercase();
        if candidate_stem == wanted {
            return path
                .strip_prefix(&src)
                .ok()
                .map(|p| p.to_string_lossy().replace('\\', "/"));
        }
    }
    None
}

pub fn check_has_transcript(root: &Path, rel_path: &str) -> bool {
    let stem = {
        let p = std::path::Path::new(rel_path);
        let s = p.with_extension("");
        s.to_string_lossy().replace('\\', "/")
    };

    for ext in TRANSCRIPT_EXTENSIONS {
        // Global mode: outputs/transcribe/<rel_stem>.<ext>
        if root
            .join("outputs")
            .join("transcribe")
            .join(format!("{stem}.{ext}"))
            .exists()
        {
            return true;
        }
        // Source mode: src/<project>/outputs/transcribe/<rest>.<ext>
        // rel_path = "project/folder/file.mp4" → project = "project", rest = "folder/file"
        let parts: Vec<&str> = stem.splitn(2, '/').collect();
        if parts.len() == 2 {
            let project = parts[0];
            let rest = parts[1];
            if root
                .join("src")
                .join(project)
                .join("outputs")
                .join("transcribe")
                .join(format!("{rest}.{ext}"))
                .exists()
            {
                return true;
            }
        }
        // Alongside: src/<rel_stem>.<ext>
        if root.join("src").join(format!("{stem}.{ext}")).exists() {
            return true;
        }
    }
    false
}

fn is_safe_path_segment(segment: &str) -> bool {
    !segment.is_empty()
        && !segment.starts_with('.')
        && !segment.contains("..")
        && !segment.contains('/')
        && !segment.contains('\\')
        && !segment.chars().any(|c| c.is_control())
}

fn is_safe_rel_path(path: &str) -> bool {
    if path.is_empty() || path.starts_with('/') || path.contains("..") || path.contains('\\') {
        return false;
    }
    path.split('/').all(is_safe_path_segment)
}

pub fn list_output_runs(
    root: &Path,
    project: Option<&str>,
    action: Option<&str>,
) -> Vec<OutputRun> {
    let src = root.join("src");
    let mut out = Vec::new();
    let log_index = build_log_index(root);

    collect_root_outputs(root, &mut out, &log_index);

    if src.exists() && src.is_dir() {
        let mut stack = vec![src.clone()];
        while let Some(dir) = stack.pop() {
            let entries = match fs::read_dir(&dir) {
                Ok(v) => v,
                Err(_) => continue,
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                        if name == "outputs" {
                            collect_output_runs_in(&src, &path, &mut out, &log_index);
                            continue;
                        }
                    }
                    stack.push(path);
                }
            }
        }
    }

    if let Some(p) = project {
        out.retain(|r| r.project == p);
    }
    if let Some(a) = action {
        out.retain(|r| r.tool == a);
    }

    out.sort_by(|a, b| b.modified_epoch.cmp(&a.modified_epoch));
    out
}

pub fn list_output_entries(root: &Path, rel_path: Option<&str>) -> Vec<OutputEntry> {
    let rel = rel_path.unwrap_or("").trim().trim_start_matches('/');
    if rel.is_empty() {
        return list_output_roots(root);
    }
    if !is_allowed_output_rel(rel) {
        return Vec::new();
    }
    let dir = root.join(rel);
    if !dir.exists() || !dir.is_dir() {
        return Vec::new();
    }
    let entries = match fs::read_dir(&dir) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let name = match path.file_name().and_then(|s| s.to_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => continue,
        };
        if name == ".DS_Store" {
            continue;
        }
        let is_dir = path.is_dir();
        let rel_path = match path.strip_prefix(root) {
            Ok(v) => v.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };
        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        let modified_epoch = modified
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let size_bytes = if is_dir { 0 } else { metadata.len() };
        let kind = if is_dir {
            "dir".to_string()
        } else {
            output_kind(&path)
        };
        out.push(OutputEntry {
            name,
            rel_path,
            is_dir,
            size_bytes,
            modified_epoch,
            kind,
        });
    }
    out.sort_by(|a, b| {
        if a.is_dir == b.is_dir {
            b.modified_epoch
                .cmp(&a.modified_epoch)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        } else if a.is_dir {
            std::cmp::Ordering::Less
        } else {
            std::cmp::Ordering::Greater
        }
    });
    out
}

pub fn list_all_output_files_recursive(root: &Path, rel_path: &str) -> Vec<OutputEntry> {
    let rel = rel_path
        .trim()
        .trim_start_matches('/')
        .trim_end_matches('/');
    if !is_allowed_output_rel(rel) {
        return Vec::new();
    }
    let base = root.join(rel);
    if !base.exists() || !base.is_dir() {
        return Vec::new();
    }

    let mut out = Vec::new();
    let mut stack = vec![base.clone()];

    while let Some(dir) = stack.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(v) => v,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
                if name == "tui-thumbs"
                    || name == "tui-logs"
                    || name == "tui-tmp"
                    || name.starts_with('.')
                {
                    continue;
                }
                stack.push(path);
                continue;
            }
            if !path.is_file() || !is_output_file(&path) {
                continue;
            }

            let name = path
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "unknown".to_string());

            let rel_path_val = match path.strip_prefix(root) {
                Ok(v) => v.to_string_lossy().replace('\\', "/"),
                Err(_) => continue,
            };

            let metadata = match path.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
            let modified_epoch = modified
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);

            let kind = output_kind(&path);

            out.push(OutputEntry {
                name,
                rel_path: rel_path_val,
                is_dir: false,
                size_bytes: metadata.len(),
                modified_epoch,
                kind,
            });
        }
    }

    out.sort_by(|a, b| b.modified_epoch.cmp(&a.modified_epoch));
    out
}

fn list_output_roots(root: &Path) -> Vec<OutputEntry> {
    let mut out = Vec::new();
    let outputs_dir = root.join("outputs");
    if outputs_dir.exists() && outputs_dir.is_dir() {
        let modified = outputs_dir
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        let modified_epoch = modified
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        out.push(OutputEntry {
            name: "outputs".to_string(),
            rel_path: "outputs".to_string(),
            is_dir: true,
            size_bytes: 0,
            modified_epoch,
            kind: "dir".to_string(),
        });
    }

    let src = root.join("src");
    if src.exists() && src.is_dir() {
        if let Ok(entries) = fs::read_dir(&src) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let name = match path.file_name().and_then(|s| s.to_str()) {
                    Some(s) if !s.is_empty() => s.to_string(),
                    _ => continue,
                };
                let outputs_path = path.join("outputs");
                if outputs_path.exists() && outputs_path.is_dir() {
                    let modified = outputs_path
                        .metadata()
                        .and_then(|m| m.modified())
                        .unwrap_or(SystemTime::UNIX_EPOCH);
                    let modified_epoch = modified
                        .duration_since(UNIX_EPOCH)
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    out.push(OutputEntry {
                        name: format!("{name} (project)"),
                        rel_path: format!("src/{name}/outputs"),
                        is_dir: true,
                        size_bytes: 0,
                        modified_epoch,
                        kind: "dir".to_string(),
                    });
                }
            }
        }
    }
    out.sort_by(|a, b| b.modified_epoch.cmp(&a.modified_epoch));
    out
}

fn is_allowed_output_rel(rel: &str) -> bool {
    if rel.is_empty()
        || rel.starts_with('/')
        || rel.contains('\\')
        || rel
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return false;
    }
    if rel == "outputs" || rel.starts_with("outputs/") {
        return true;
    }
    if rel.starts_with("src/") {
        let mut parts = rel.split('/');
        let _src = parts.next();
        let project = parts.next();
        let outputs = parts.next();
        return project.is_some() && matches!(outputs, Some("outputs"));
    }
    false
}

fn build_log_index(root: &Path) -> HashMap<String, Vec<(u64, String)>> {
    let mut index: HashMap<String, Vec<(u64, String)>> = HashMap::new();
    let log_dir = root.join("outputs").join("tui-logs");
    let entries = match fs::read_dir(&log_dir) {
        Ok(v) => v,
        Err(_) => return index,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = match path.file_name().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        if !name.ends_with(".log") {
            continue;
        }
        let tool = match extract_log_tool(&name) {
            Some(t) => t,
            None => continue,
        };
        let ts = extract_log_timestamp(&name).unwrap_or(0);
        index.entry(tool).or_default().push((ts, name));
    }
    for logs in index.values_mut() {
        logs.sort_by(|a, b| a.0.cmp(&b.0));
    }
    index
}

fn extract_log_tool(name: &str) -> Option<String> {
    let base = name.strip_suffix(".log")?;
    let base = if let Some(rest) = base.strip_prefix("studio_") {
        rest
    } else if let Some(rest) = base.strip_prefix("tui_") {
        rest
    } else {
        return None;
    };

    if let Some((tool, _)) = base.split_once("_run_") {
        return Some(tool.to_string());
    }
    if let Some((tool, _)) = base.split_once('_') {
        return Some(tool.to_string());
    }
    Some(base.to_string())
}

fn extract_log_timestamp(name: &str) -> Option<u64> {
    let base = name.strip_suffix(".log")?;
    let last = base.rsplit('_').next()?;
    if last.len() < 9 {
        return None;
    }
    last.parse::<u64>().ok()
}

fn find_best_log(
    log_index: &HashMap<String, Vec<(u64, String)>>,
    tool: &str,
    modified_epoch: u64,
) -> Option<String> {
    let logs = log_index.get(tool)?;
    if logs.is_empty() {
        return None;
    }
    let mut best: Option<&(u64, String)> = None;
    for entry in logs {
        if entry.0 == 0 {
            continue;
        }
        if entry.0 <= modified_epoch {
            best = Some(entry);
        }
    }
    if let Some(found) = best {
        return Some(found.1.clone());
    }
    let fallback = logs.last().or_else(|| logs.first());
    fallback.map(|e| e.1.clone())
}

fn collect_root_outputs(
    root: &Path,
    out: &mut Vec<OutputRun>,
    log_index: &HashMap<String, Vec<(u64, String)>>,
) {
    let outputs_dir = root.join("outputs");
    if !outputs_dir.exists() || !outputs_dir.is_dir() {
        return;
    }
    let tool_entries = match fs::read_dir(&outputs_dir) {
        Ok(v) => v,
        Err(_) => return,
    };
    for tool_entry in tool_entries.flatten() {
        let tool_path = tool_entry.path();
        if !tool_path.is_dir() {
            continue;
        }
        let tool = match tool_path.file_name().and_then(|s| s.to_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => continue,
        };
        if tool == "tui-logs" || tool == "tui-thumbs" || tool == "tui-tmp" {
            continue;
        }
        let run_entries = match fs::read_dir(&tool_path) {
            Ok(v) => v,
            Err(_) => continue,
        };
        for entry in run_entries.flatten() {
            let path = entry.path();
            if path.is_file() && is_output_file(&path) {
                let run_id = match path.file_name().and_then(|s| s.to_str()) {
                    Some(s) if !s.is_empty() => s.to_string(),
                    _ => continue,
                };
                let modified = entry
                    .metadata()
                    .and_then(|m| m.modified())
                    .unwrap_or(SystemTime::UNIX_EPOCH);
                let modified_epoch = modified
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let run_rel = match path.strip_prefix(root) {
                    Ok(v) => v.to_string_lossy().replace('\\', "/"),
                    Err(_) => continue,
                };
                let sample_url = if is_video_file(&path) || is_image_file(&path) {
                    Some(format!("/outfiles/{}", url_encode_path(&run_rel)))
                } else {
                    None
                };
                let log_file = find_best_log(log_index, &tool, modified_epoch);
                out.push(OutputRun {
                    project: "(global)".to_string(),
                    tool: tool.clone(),
                    run_id,
                    run_rel,
                    sample_url,
                    log_file,
                    modified_epoch,
                    video_count: 1,
                });
            }
        }
        let run_entries = match fs::read_dir(&tool_path) {
            Ok(v) => v,
            Err(_) => continue,
        };
        for run_entry in run_entries.flatten() {
            let run_path = run_entry.path();
            if !run_path.is_dir() {
                continue;
            }
            let run_id = match run_path.file_name().and_then(|s| s.to_str()) {
                Some(s) if !s.is_empty() => s.to_string(),
                _ => continue,
            };
            let modified = run_entry
                .metadata()
                .and_then(|m| m.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            let modified_epoch = modified
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let run_rel = match run_path.strip_prefix(root) {
                Ok(v) => v.to_string_lossy().replace('\\', "/"),
                Err(_) => continue,
            };
            let video_count = count_output_files_in_dir(&run_path);
            let log_file = find_best_log(log_index, &tool, modified_epoch);
            out.push(OutputRun {
                project: "(global)".to_string(),
                tool: tool.clone(),
                run_id,
                run_rel,
                sample_url: find_first_preview_rel(root, &run_path)
                    .map(|r| format!("/outfiles/{}", url_encode_path(&r))),
                log_file,
                modified_epoch,
                video_count,
            });
        }
    }
}

fn collect_output_runs_in(
    src_root: &Path,
    outputs_dir: &Path,
    out: &mut Vec<OutputRun>,
    log_index: &HashMap<String, Vec<(u64, String)>>,
) {
    let tool_entries = match fs::read_dir(outputs_dir) {
        Ok(v) => v,
        Err(_) => return,
    };
    for tool_entry in tool_entries.flatten() {
        let tool_path = tool_entry.path();
        if !tool_path.is_dir() {
            continue;
        }
        let tool = match tool_path.file_name().and_then(|s| s.to_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => continue,
        };
        let run_entries = match fs::read_dir(&tool_path) {
            Ok(v) => v,
            Err(_) => continue,
        };
        for entry in run_entries.flatten() {
            let path = entry.path();
            if path.is_file() && is_output_file(&path) {
                let run_id = match path.file_name().and_then(|s| s.to_str()) {
                    Some(s) if !s.is_empty() => s.to_string(),
                    _ => continue,
                };
                let modified = entry
                    .metadata()
                    .and_then(|m| m.modified())
                    .unwrap_or(SystemTime::UNIX_EPOCH);
                let modified_epoch = modified
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let rel = match path.strip_prefix(src_root) {
                    Ok(v) => v.to_string_lossy().replace('\\', "/"),
                    Err(_) => continue,
                };
                let folder = outputs_dir
                    .parent()
                    .and_then(|p| p.strip_prefix(src_root).ok())
                    .map(|p| p.to_string_lossy().replace('\\', "/"))
                    .unwrap_or_default();
                let project = project_from_folder(&folder);
                let sample_url = if is_video_file(&path) || is_image_file(&path) {
                    Some(format!("/files/{}", url_encode_path(&rel)))
                } else {
                    None
                };
                let log_file = find_best_log(log_index, &tool, modified_epoch);
                out.push(OutputRun {
                    project,
                    tool: tool.clone(),
                    run_id,
                    run_rel: format!("src/{}", rel),
                    sample_url,
                    log_file,
                    modified_epoch,
                    video_count: 1,
                });
            }
        }
        let run_entries = match fs::read_dir(&tool_path) {
            Ok(v) => v,
            Err(_) => continue,
        };
        for run_entry in run_entries.flatten() {
            let run_path = run_entry.path();
            if !run_path.is_dir() {
                continue;
            }
            let run_id = match run_path.file_name().and_then(|s| s.to_str()) {
                Some(s) if !s.is_empty() => s.to_string(),
                _ => continue,
            };
            let modified = run_entry
                .metadata()
                .and_then(|m| m.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            let modified_epoch = modified
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let run_rel = match run_path.strip_prefix(src_root) {
                Ok(v) => format!("src/{}", v.to_string_lossy().replace('\\', "/")),
                Err(_) => continue,
            };
            let folder = outputs_dir
                .parent()
                .and_then(|p| p.strip_prefix(src_root).ok())
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();
            let project = project_from_folder(&folder);
            let video_count = count_output_files_in_dir(&run_path);
            let sample_url = find_first_preview_rel_src(src_root, &run_path)
                .map(|r| format!("/files/{}", url_encode_path(&r)));
            let log_file = find_best_log(log_index, &tool, modified_epoch);
            out.push(OutputRun {
                project,
                tool: tool.clone(),
                run_id,
                run_rel,
                sample_url,
                log_file,
                modified_epoch,
                video_count,
            });
        }
    }
}

fn project_from_folder(folder: &str) -> String {
    folder.split('/').next().unwrap_or("(unknown)").to_string()
}

fn count_output_files_in_dir(dir: &Path) -> usize {
    let mut count = 0;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let entries = match fs::read_dir(&d) {
            Ok(v) => v,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.is_file() && is_output_file(&path) {
                count += 1;
            }
        }
    }
    count
}

fn find_first_preview_rel(root: &Path, dir: &Path) -> Option<String> {
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let entries = fs::read_dir(current).ok()?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.is_file() && (is_video_file(&path) || is_image_file(&path)) {
                let rel = path.strip_prefix(root).ok()?;
                return Some(rel.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    None
}

fn find_first_preview_rel_src(src_root: &Path, dir: &Path) -> Option<String> {
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let entries = fs::read_dir(current).ok()?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.is_file() && (is_video_file(&path) || is_image_file(&path)) {
                let rel = path.strip_prefix(src_root).ok()?;
                return Some(rel.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    None
}

fn url_encode_path(raw: &str) -> String {
    let mut out = String::new();
    for b in raw.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'/' => {
                out.push(b as char)
            }
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}
