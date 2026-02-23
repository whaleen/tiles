use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::state::AppState;

fn validate_and_resolve(root: &Path, prefix: &str, uri_path: &str) -> Result<PathBuf, StatusCode> {
    let rel = uri_path
        .strip_prefix(prefix)
        .unwrap_or(uri_path)
        .trim_start_matches('/');
    let decoded = urlencoding_decode(rel);
    if decoded.contains("..") || Path::new(&decoded).is_absolute() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let full = root.join(&decoded);
    if !full.exists() || !full.is_file() {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(full)
}

/// Serve source videos from src/
pub async fn serve_src_file(
    State(state): State<Arc<AppState>>,
    req: Request,
) -> Result<Response, StatusCode> {
    let uri_path = req.uri().path().to_string();
    let rel = uri_path
        .strip_prefix("/api/media/files/")
        .unwrap_or(&uri_path)
        .trim_start_matches('/');
    let decoded = urlencoding_decode(rel);
    if decoded.contains("..") || Path::new(&decoded).is_absolute() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let full = state.root.join("src").join(&decoded);
    if !full.exists() || !full.is_file() {
        return Err(StatusCode::NOT_FOUND);
    }
    serve_file_with_range(&full, req.headers()).await
}

/// Serve thumbnails for src/ videos
pub async fn serve_src_thumb(
    State(state): State<Arc<AppState>>,
    req: Request,
) -> Result<Response, StatusCode> {
    let uri_path = req.uri().path().to_string();
    let rel = uri_path
        .strip_prefix("/api/media/thumbs/")
        .unwrap_or(&uri_path)
        .trim_start_matches('/');
    let decoded = urlencoding_decode(rel);
    if decoded.contains("..") || Path::new(&decoded).is_absolute() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let full = state.root.join("src").join(&decoded);
    let thumb = crate::services::thumbnail::ensure_thumbnail(&state.root, &full, &decoded)
        .ok_or(StatusCode::NOT_FOUND)?;
    serve_static_file(&thumb).await
}

/// Serve output videos from outputs/ or src/<project>/outputs/
pub async fn serve_out_file(
    State(state): State<Arc<AppState>>,
    req: Request,
) -> Result<Response, StatusCode> {
    let full = validate_and_resolve(
        &state.root,
        "/api/media/outfiles/",
        req.uri().path(),
    )?;
    serve_file_with_range(&full, req.headers()).await
}

/// Serve thumbnails for output videos
pub async fn serve_out_thumb(
    State(state): State<Arc<AppState>>,
    req: Request,
) -> Result<Response, StatusCode> {
    let uri_path = req.uri().path().to_string();
    let rel = uri_path
        .strip_prefix("/api/media/outthumbs/")
        .unwrap_or(&uri_path)
        .trim_start_matches('/');
    let decoded = urlencoding_decode(rel);
    if decoded.contains("..") || Path::new(&decoded).is_absolute() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let full = state.root.join(&decoded);
    let thumb = crate::services::thumbnail::ensure_thumbnail(&state.root, &full, &decoded)
        .ok_or(StatusCode::NOT_FOUND)?;
    serve_static_file(&thumb).await
}

async fn serve_file_with_range(
    path: &Path,
    headers: &HeaderMap,
) -> Result<Response, StatusCode> {
    let metadata = std::fs::metadata(path).map_err(|_| StatusCode::NOT_FOUND)?;
    let total = metadata.len();
    let content_type = content_type_for_path(path);

    if let Some(range_header) = headers.get(header::RANGE) {
        let range_str = range_header.to_str().map_err(|_| StatusCode::BAD_REQUEST)?;
        if let Some(range) = range_str.strip_prefix("bytes=") {
            let mut parts = range.split('-');
            let start_str = parts.next().unwrap_or("");
            let end_str = parts.next().unwrap_or("");

            let start: u64 = if start_str.is_empty() {
                0
            } else {
                start_str.parse().map_err(|_| StatusCode::BAD_REQUEST)?
            };
            let end: u64 = if end_str.is_empty() {
                total.saturating_sub(1)
            } else {
                end_str
                    .parse::<u64>()
                    .map_err(|_| StatusCode::BAD_REQUEST)?
                    .min(total.saturating_sub(1))
            };

            if start > end || start >= total {
                return Err(StatusCode::RANGE_NOT_SATISFIABLE);
            }

            let len = end - start + 1;
            use tokio::io::{AsyncReadExt, AsyncSeekExt};
            let mut file = tokio::fs::File::open(path)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            file.seek(std::io::SeekFrom::Start(start))
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            let stream = tokio_util::io::ReaderStream::new(file.take(len));
            let body = Body::from_stream(stream);

            return Ok(Response::builder()
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_TYPE, content_type)
                .header(header::ACCEPT_RANGES, "bytes")
                .header(
                    header::CONTENT_RANGE,
                    format!("bytes {start}-{end}/{total}"),
                )
                .header(header::CONTENT_LENGTH, len.to_string())
                .body(body)
                .unwrap());
        }
    }

    // Full file response
    let file = tokio::fs::File::open(path)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let stream = tokio_util::io::ReaderStream::new(file);
    let body = Body::from_stream(stream);

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, total.to_string())
        .body(body)
        .unwrap())
}

async fn serve_static_file(path: &Path) -> Result<Response, StatusCode> {
    let bytes = tokio::fs::read(path)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    let content_type = content_type_for_path(path);
    Ok((
        [(header::CONTENT_TYPE, content_type)],
        bytes,
    )
        .into_response())
}

fn content_type_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .as_deref()
    {
        Some("mp4") | Some("m4v") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mov") => "video/quicktime",
        Some("avi") => "video/x-msvideo",
        Some("mkv") => "video/x-matroska",
        Some("flv") => "video/x-flv",
        Some("wmv") => "video/x-ms-wmv",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    }
}

fn urlencoding_decode(input: &str) -> String {
    let mut out = String::new();
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = bytes[i + 1];
            let lo = bytes[i + 2];
            if let (Some(h), Some(l)) = (hex_val(hi), hex_val(lo)) {
                out.push((h << 4 | l) as char);
                i += 3;
                continue;
            }
        }
        if bytes[i] == b'+' {
            out.push(' ');
        } else {
            out.push(bytes[i] as char);
        }
        i += 1;
    }
    out
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}
