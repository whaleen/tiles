mod commands;
mod media;
mod models;
mod prefs;
mod protocol;
mod services;
mod state;

use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};

use state::AppState;

/// Resolve the path to the `tiles` CLI binary.
///
/// macOS apps launched from the Dock/Finder don't inherit the user's shell
/// PATH, so `Command::new("tiles")` fails. Check the standard Homebrew
/// locations first, then fall back to a bare name for development.
fn find_tiles_bin() -> PathBuf {
    // First choice: bundled sidecar sitting next to the app executable.
    // Inside the .app bundle this is tiles.app/Contents/MacOS/tiles-cli.
    // In dev (target/debug/) the sidecar is copied there by Tauri at build time.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let sidecar = dir.join("tiles-cli");
            if sidecar.exists() {
                return sidecar;
            }
        }
    }

    // Fallback: well-known installed locations (Homebrew, manual installs).
    // macOS apps don't inherit the user's shell PATH, so check explicitly.
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates: &[&str] = &[
        "/opt/homebrew/bin/tiles",         // Apple Silicon Homebrew
        "/usr/local/bin/tiles",            // Intel Homebrew / manual install
        &format!("{home}/.cargo/bin/tiles"),
        &format!("{home}/.local/bin/tiles"),
    ];
    for path in candidates {
        if std::path::Path::new(path).exists() {
            return PathBuf::from(path);
        }
    }

    PathBuf::from("tiles")
}

/// Shared state for the embedded media server port.
pub struct MediaPort(pub Mutex<u16>);

/// Tauri command to return the embedded media server port.
#[tauri::command]
fn media_port(port_state: tauri::State<MediaPort>) -> u16 {
    *port_state.0.lock().unwrap()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let media_port_num = media::pick_port();
    let shared_root: Arc<RwLock<PathBuf>> = Arc::new(RwLock::new(PathBuf::new()));

    tauri::Builder::default()
        .register_uri_scheme_protocol("streamfile", {
            let root = shared_root.clone();
            move |_app, request| protocol::handle(&root, request)
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new(shared_root.clone(), find_tiles_bin()))
        .manage(MediaPort(Mutex::new(media_port_num)))
        .setup(move |app| {
            use tauri::Manager;

            // Load workspace from prefs
            let prefs = prefs::read_prefs(&app.handle());
            if let Some(workspace) = prefs.workspace {
                let path = PathBuf::from(workspace);
                if path.exists() && path.is_dir() {
                    let state = app.state::<AppState>();
                    let mut root = state.root.write().unwrap();
                    *root = path;
                }
            }

            // Start media server with shared root
            let media_root = shared_root.clone();
            tauri::async_runtime::spawn(async move {
                media::start(media_port_num, media_root).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            media_port,
            // health
            commands::health::get_health,
            // projects
            commands::projects::list_projects,
            commands::projects::get_project,
            commands::projects::create_project,
            commands::projects::get_project_meta,
            commands::projects::put_project_meta,
            // videos
            commands::videos::list_videos,
            commands::videos::get_video_info,
            commands::videos::get_transcript,
            commands::videos::delete_video,
            // folders
            commands::folders::create_folder,
            commands::folders::rename_folder,
            commands::folders::move_folder,
            commands::folders::delete_folder,
            commands::folders::move_videos,
            commands::folders::import_files_to_folder,
            commands::folders::get_folder_order,
            commands::folders::put_folder_order,
            // settings
            commands::settings::get_settings,
            commands::settings::put_settings,
            commands::settings::list_layouts,
            // outputs
            commands::outputs::list_outputs,
            commands::outputs::list_output_tree,
            commands::outputs::delete_output,
            // actions
            commands::actions::list_actions,
            commands::actions::run_action,
            commands::actions::list_running_actions,
            // logs
            commands::logs::list_logs,
            commands::logs::get_log,
            // workspace
            commands::workspace::get_workspace,
            commands::workspace::default_workspace_path,
            commands::workspace::pick_workspace,
            commands::workspace::set_workspace,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
