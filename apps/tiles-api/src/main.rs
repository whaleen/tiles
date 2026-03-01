mod models;
mod routes;
mod services;
mod state;

use axum::routing::{get, post, delete};
use axum::Router;
use std::env;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

use state::AppState;

fn find_repo_root() -> Option<PathBuf> {
    let cwd = env::current_dir().ok()?;
    find_root_from(&cwd).or_else(|| {
        env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(Path::to_path_buf))
            .and_then(|p| find_root_from(&p))
    })
}

fn find_root_from(start: &Path) -> Option<PathBuf> {
    let mut cur = start.to_path_buf();
    loop {
        let has_markers = cur
            .join("apps")
            .join("tiles-tui")
            .join("Cargo.toml")
            .exists()
            && cur.join("src").is_dir();
        if has_markers {
            return Some(cur);
        }
        if !cur.pop() {
            return None;
        }
    }
}

fn find_tiles_bin() -> PathBuf {
    if let Some(root) = find_repo_root() {
        let debug_bin = root.join("target").join("debug").join("tiles");
        if debug_bin.exists() {
            return debug_bin;
        }
        let release_bin = root.join("target").join("release").join("tiles");
        if release_bin.exists() {
            return release_bin;
        }
        let debug_bin = root
            .join("apps")
            .join("tiles-tui")
            .join("target")
            .join("debug")
            .join("tiles");
        if debug_bin.exists() {
            return debug_bin;
        }
        let release_bin = root
            .join("apps")
            .join("tiles-tui")
            .join("target")
            .join("release")
            .join("tiles");
        if release_bin.exists() {
            return release_bin;
        }
    }
    if let Ok(exe) = env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join("tiles");
            if candidate.exists() {
                return candidate;
            }
        }
    }
    if let Ok(output) = std::process::Command::new("which").arg("tiles").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return PathBuf::from(path);
            }
        }
    }
    PathBuf::from("tiles")
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let root = find_repo_root().unwrap_or_else(|| {
        eprintln!("Warning: could not find tiles project root, using current directory");
        env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    });
    let tiles_bin = find_tiles_bin();

    tracing::info!("Tiles API starting");
    tracing::info!("  root: {}", root.display());
    tracing::info!("  tiles binary: {}", tiles_bin.display());

    let state = Arc::new(AppState::new(root, tiles_bin));

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let api_routes = Router::new()
        // Health
        .route("/api/health", get(health))
        // Projects
        .route("/api/projects", get(routes::projects::list_projects))
        .route("/api/projects", post(routes::projects::create_project))
        .route("/api/projects/{name}", get(routes::projects::get_project))
        .route(
            "/api/projects/{name}/meta",
            get(routes::projects::get_project_meta).put(routes::projects::put_project_meta),
        )
        // Folders
        .route("/api/folders/create", post(routes::folders::create_folder))
        .route("/api/folders/rename", post(routes::folders::rename_folder))
        .route("/api/folders/move", post(routes::folders::move_folder))
        .route("/api/folders/delete", post(routes::folders::delete_folder))
        .route("/api/folders/move-videos", post(routes::folders::move_videos))
        .route("/api/folders/order", get(routes::folders::get_folder_order).put(routes::folders::put_folder_order))
        // Videos
        .route("/api/videos", get(routes::videos::list_videos))
        .route("/api/videos/{*path}", delete(routes::videos::delete_video))
        .route("/api/videos/info", get(routes::videos::get_video_info))
        // Settings
        .route("/api/settings", get(routes::settings::get_settings).put(routes::settings::put_settings))
        .route("/api/settings/layouts", get(routes::settings::get_layouts))
        // Outputs
        .route("/api/outputs", get(routes::outputs::list_outputs))
        .route("/api/outputs/tree", get(routes::outputs::list_output_tree))
        .route("/api/outputs/{*path}", delete(routes::outputs::delete_output))
        // Actions
        .route("/api/actions", get(routes::actions::list_actions))
        .route("/api/actions/run", post(routes::actions::run_action))
        .route("/api/actions/running", get(routes::actions::list_running_actions))
        // Logs
        .route("/api/logs", get(list_logs))
        .route("/api/logs/{filename}", get(get_log));

    let media_routes = Router::new()
        .route("/api/media/files/{*path}", get(routes::media::serve_src_file))
        .route("/api/media/thumbs/{*path}", get(routes::media::serve_src_thumb))
        .route("/api/media/outfiles/{*path}", get(routes::media::serve_out_file))
        .route("/api/media/outthumbs/{*path}", get(routes::media::serve_out_thumb));

    let app = api_routes
        .merge(media_routes)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state.clone());

    // In production, serve the React build as a fallback
    let app = {
        let dist_dir = state.root.join("apps").join("tiles-studio").join("dist");
        if dist_dir.exists() {
            tracing::info!("Serving React build from {}", dist_dir.display());
            let serve_dir = tower_http::services::ServeDir::new(&dist_dir)
                .not_found_service(tower_http::services::ServeFile::new(dist_dir.join("index.html")));
            app.fallback_service(serve_dir)
        } else {
            tracing::info!("No React build found at {}, API-only mode", dist_dir.display());
            app
        }
    };

    let port: u16 = env::var("PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(3001);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    tracing::info!("Listening on http://{addr}");

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn health(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> axum::Json<models::HealthStatus> {
    axum::Json(models::HealthStatus {
        ok: services::ffprobe::check_ffmpeg() && services::ffprobe::check_ffprobe(),
        ffmpeg: services::ffprobe::check_ffmpeg(),
        ffprobe: services::ffprobe::check_ffprobe(),
        root: state.root.display().to_string(),
        tiles_bin: state.tiles_bin.display().to_string(),
    })
}

async fn list_logs(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> axum::Json<Vec<String>> {
    let log_dir = state.root.join("outputs").join("tui-logs");
    let mut logs = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&log_dir) {
        for entry in entries.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                if name.ends_with(".log") {
                    logs.push(name.to_string());
                }
            }
        }
    }
    logs.sort();
    logs.reverse();
    axum::Json(logs)
}

async fn get_log(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    axum::extract::Path(filename): axum::extract::Path<String>,
) -> Result<String, axum::http::StatusCode> {
    if filename.contains("..") || filename.contains('/') {
        return Err(axum::http::StatusCode::BAD_REQUEST);
    }
    let path = state.root.join("outputs").join("tui-logs").join(&filename);
    std::fs::read_to_string(&path).map_err(|_| axum::http::StatusCode::NOT_FOUND)
}
