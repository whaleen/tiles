use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, RwLock};
use tauri::http::{header, Request, Response};

/// Custom URI scheme handler for `streamfile://`.
///
/// URL format: `streamfile://localhost/{rel_path}`
/// where `rel_path` is relative to `workspace/src/`.
///
/// Registered instead of HTTP for video files so that WKWebView
/// (which treats `tauri://localhost` as a secure context) doesn't
/// block the load as mixed content the way it does for `http://`.
pub fn handle(root: &Arc<RwLock<PathBuf>>, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let root_path = root.read().unwrap().clone();

    if root_path.as_os_str().is_empty() {
        return not_found();
    }

    let uri_path = request.uri().path();
    let rel = url_decode(uri_path.trim_start_matches('/'));
    let Some(file_path) = safe_join(&root_path.join("src"), &rel) else {
        return not_found();
    };

    if !file_path.exists() || !file_path.is_file() {
        return not_found();
    }

    let total = match std::fs::metadata(&file_path) {
        Ok(m) => m.len(),
        Err(_) => return server_error(),
    };

    let ct = content_type(&file_path);

    // Handle Range request (required for video seeking)
    if let Some(range_val) = request.headers().get(header::RANGE) {
        if let Ok(range_str) = range_val.to_str() {
            if let Some(range) = range_str.strip_prefix("bytes=") {
                let mut parts = range.split('-');
                let start: u64 = parts.next().unwrap_or("").parse().unwrap_or(0);
                let end: u64 = parts
                    .next()
                    .and_then(|s| if s.is_empty() { None } else { s.parse().ok() })
                    .unwrap_or(total.saturating_sub(1))
                    .min(total.saturating_sub(1));

                if start <= end && start < total {
                    let len = (end - start + 1) as usize;
                    let mut buf = vec![0u8; len];
                    if let Ok(mut file) = std::fs::File::open(&file_path) {
                        if file.seek(SeekFrom::Start(start)).is_ok() {
                            let _ = file.read(&mut buf);
                        }
                    }
                    return Response::builder()
                        .status(206u16)
                        .header(header::CONTENT_TYPE, ct)
                        .header(header::ACCEPT_RANGES, "bytes")
                        .header(
                            header::CONTENT_RANGE,
                            format!("bytes {start}-{end}/{total}"),
                        )
                        .header(header::CONTENT_LENGTH, len.to_string())
                        .body(buf)
                        .unwrap();
                }
            }
        }
    }

    // Full-file response
    let bytes = match std::fs::read(&file_path) {
        Ok(b) => b,
        Err(_) => return server_error(),
    };

    Response::builder()
        .status(200u16)
        .header(header::CONTENT_TYPE, ct)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, total.to_string())
        .body(bytes)
        .unwrap()
}

fn safe_join(base: &Path, rel: &str) -> Option<PathBuf> {
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() {
        return None;
    }
    if rel_path
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return None;
    }
    Some(base.join(rel_path))
}

fn not_found() -> Response<Vec<u8>> {
    Response::builder().status(404u16).body(Vec::new()).unwrap()
}

fn server_error() -> Response<Vec<u8>> {
    Response::builder().status(500u16).body(Vec::new()).unwrap()
}

fn content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .as_deref()
    {
        Some("mp4") | Some("m4v") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mov") => "video/quicktime",
        Some("mkv") => "video/x-matroska",
        Some("avi") => "video/x-msvideo",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("json") | Some("json3") => "application/json",
        Some("vtt") => "text/vtt; charset=utf-8",
        Some("srt") | Some("txt") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn url_decode(input: &str) -> String {
    let mut out = String::new();
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = bytes[i + 1];
            let lo = bytes[i + 2];
            if let (Some(h), Some(l)) = (hex(hi), hex(lo)) {
                out.push((h << 4 | l) as char);
                i += 3;
                continue;
            }
        }
        out.push(if bytes[i] == b'+' {
            ' '
        } else {
            bytes[i] as char
        });
        i += 1;
    }
    out
}

fn hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}
