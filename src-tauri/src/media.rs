use axum::body::Body;
use axum::extract::Request;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::Response;
use axum::routing::get;
use std::io::SeekFrom;
use std::net::TcpListener;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, RwLock};

pub fn pick_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("no available port")
        .local_addr()
        .unwrap()
        .port()
}

pub async fn start(port: u16, root: Arc<RwLock<PathBuf>>) {
    let router = {
        let r = root.clone();
        axum::Router::new()
            .route("/files/{*path}", {
                let root = r.clone();
                get(move |req: Request| {
                    let root = root.clone();
                    async move { serve_src(root, req).await }
                })
            })
            .route("/thumbs/{*path}", {
                let root = r.clone();
                get(move |req: Request| {
                    let root = root.clone();
                    async move { serve_src_thumb(root, req).await }
                })
            })
            .route("/frames/{*path}", {
                let root = r.clone();
                get(move |req: Request| {
                    let root = root.clone();
                    async move { serve_src_frame(root, req).await }
                })
            })
            .route("/filmstrips/{*path}", {
                let root = r.clone();
                get(move |req: Request| {
                    let root = root.clone();
                    async move { serve_src_filmstrip(root, req).await }
                })
            })
            .route("/outfiles/{*path}", {
                let root = r.clone();
                get(move |req: Request| {
                    let root = root.clone();
                    async move { serve_out(root, req).await }
                })
            })
            .route("/outthumbs/{*path}", {
                let root = r.clone();
                get(move |req: Request| {
                    let root = root.clone();
                    async move { serve_out_thumb(root, req).await }
                })
            })
    };

    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{port}"))
        .await
        .expect("failed to bind media server");
    axum::serve(listener, router).await.unwrap();
}

async fn serve_src(root: Arc<RwLock<PathBuf>>, req: Request) -> Result<Response, StatusCode> {
    let root_path = root.read().unwrap().clone();
    let rel = strip_prefix(req.uri().path(), "/files");
    let decoded = url_decode(rel.trim_start_matches('/'));
    let Some(path) = safe_join(&root_path.join("src"), &decoded) else {
        return Err(StatusCode::NOT_FOUND);
    };
    if !path.exists() || !path.is_file() {
        return Err(StatusCode::NOT_FOUND);
    }
    serve_with_range(&path, req.headers()).await
}

async fn serve_src_thumb(root: Arc<RwLock<PathBuf>>, req: Request) -> Result<Response, StatusCode> {
    let root_path = root.read().unwrap().clone();
    let rel = strip_prefix(req.uri().path(), "/thumbs");
    let decoded = url_decode(rel.trim_start_matches('/'));
    let Some(src) = safe_join(&root_path.join("src"), &decoded) else {
        return Err(StatusCode::NOT_FOUND);
    };
    if !src.exists() || !src.is_file() {
        return Err(StatusCode::NOT_FOUND);
    }
    let thumb = tokio::task::spawn_blocking(move || {
        crate::services::thumbnail::ensure_thumbnail(&root_path, &src, &decoded)
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::NOT_FOUND)?;
    serve_static(&thumb).await
}

async fn serve_src_frame(root: Arc<RwLock<PathBuf>>, req: Request) -> Result<Response, StatusCode> {
    let root_path = root.read().unwrap().clone();
    let rel = strip_prefix(req.uri().path(), "/frames");
    let decoded = url_decode(rel.trim_start_matches('/'));
    let seconds = req
        .uri()
        .query()
        .and_then(|q| {
            q.split('&').find_map(|part| {
                let (k, v) = part.split_once('=')?;
                if k == "t" {
                    v.parse::<f64>().ok()
                } else {
                    None
                }
            })
        })
        .unwrap_or(0.0);
    let Some(src) = safe_join(&root_path.join("src"), &decoded) else {
        return Err(StatusCode::NOT_FOUND);
    };
    if !src.exists() || !src.is_file() {
        return Err(StatusCode::NOT_FOUND);
    }
    let frame = tokio::task::spawn_blocking(move || {
        crate::services::thumbnail::ensure_frame_thumbnail(&root_path, &src, &decoded, seconds)
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::NOT_FOUND)?;
    serve_static(&frame).await
}

async fn serve_src_filmstrip(
    root: Arc<RwLock<PathBuf>>,
    req: Request,
) -> Result<Response, StatusCode> {
    let root_path = root.read().unwrap().clone();
    let rel = strip_prefix(req.uri().path(), "/filmstrips");
    let decoded = url_decode(rel.trim_start_matches('/'));
    let Some(src) = safe_join(&root_path.join("src"), &decoded) else {
        return Err(StatusCode::NOT_FOUND);
    };
    if !src.exists() || !src.is_file() {
        return Err(StatusCode::NOT_FOUND);
    }
    let strip = tokio::task::spawn_blocking(move || {
        crate::services::filmstrip::ensure_filmstrip(&root_path, &src, &decoded)
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::NOT_FOUND)?;
    serve_static(&strip.path).await
}

async fn serve_out(root: Arc<RwLock<PathBuf>>, req: Request) -> Result<Response, StatusCode> {
    let root_path = root.read().unwrap().clone();
    let rel = strip_prefix(req.uri().path(), "/outfiles");
    let decoded = url_decode(rel.trim_start_matches('/'));
    let Some(path) = safe_join(&root_path, &decoded) else {
        return Err(StatusCode::NOT_FOUND);
    };
    if !path.exists() || !path.is_file() {
        return Err(StatusCode::NOT_FOUND);
    }
    serve_with_range(&path, req.headers()).await
}

async fn serve_out_thumb(root: Arc<RwLock<PathBuf>>, req: Request) -> Result<Response, StatusCode> {
    let root_path = root.read().unwrap().clone();
    let rel = strip_prefix(req.uri().path(), "/outthumbs");
    let decoded = url_decode(rel.trim_start_matches('/'));
    let Some(src) = safe_join(&root_path, &decoded) else {
        return Err(StatusCode::NOT_FOUND);
    };
    if !src.exists() || !src.is_file() {
        return Err(StatusCode::NOT_FOUND);
    }
    let thumb = tokio::task::spawn_blocking(move || {
        crate::services::thumbnail::ensure_thumbnail(&root_path, &src, &decoded)
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::NOT_FOUND)?;
    serve_static(&thumb).await
}

async fn serve_with_range(path: &Path, headers: &HeaderMap) -> Result<Response, StatusCode> {
    let metadata = std::fs::metadata(path).map_err(|_| StatusCode::NOT_FOUND)?;
    let total = metadata.len();
    let ct = content_type(path);

    if let Some(range_val) = headers.get(header::RANGE) {
        if let Ok(range_str) = range_val.to_str() {
            if let Some(range) = range_str.strip_prefix("bytes=") {
                let mut parts = range.split('-');
                let start: u64 = parts.next().unwrap_or("").parse().unwrap_or(0);
                let end: u64 = parts
                    .next()
                    .and_then(|s| if s.is_empty() { None } else { s.parse().ok() })
                    .unwrap_or(total.saturating_sub(1))
                    .min(total.saturating_sub(1));

                if start > end || start >= total {
                    return Err(StatusCode::RANGE_NOT_SATISFIABLE);
                }

                let len = end - start + 1;
                use tokio::io::{AsyncReadExt, AsyncSeekExt};
                let mut file = tokio::fs::File::open(path)
                    .await
                    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                file.seek(SeekFrom::Start(start))
                    .await
                    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                let stream = tokio_util::io::ReaderStream::new(file.take(len));

                return Ok(Response::builder()
                    .status(StatusCode::PARTIAL_CONTENT)
                    .header(header::CONTENT_TYPE, ct)
                    .header(header::ACCEPT_RANGES, "bytes")
                    .header(
                        header::CONTENT_RANGE,
                        format!("bytes {start}-{end}/{total}"),
                    )
                    .header(header::CONTENT_LENGTH, len.to_string())
                    .body(Body::from_stream(stream))
                    .unwrap());
            }
        }
    }

    let file = tokio::fs::File::open(path)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, ct)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, total.to_string())
        .body(Body::from_stream(tokio_util::io::ReaderStream::new(file)))
        .unwrap())
}

async fn serve_static(path: &Path) -> Result<Response, StatusCode> {
    let bytes = tokio::fs::read(path)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    Ok(Response::builder()
        .header(header::CONTENT_TYPE, content_type(path))
        .body(Body::from(bytes))
        .unwrap())
}

fn strip_prefix<'a>(path: &'a str, prefix: &str) -> &'a str {
    path.strip_prefix(prefix).unwrap_or(path)
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
