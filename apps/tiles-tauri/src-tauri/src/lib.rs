mod commands;
mod media;
mod models;
mod services;
mod state;

use std::env;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use state::AppState;

/// Shared state for the embedded media server port.
pub struct MediaPort(pub Mutex<u16>);

fn find_project_root() -> Option<PathBuf> {
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

fn find_tiles_bin(root: &Path) -> PathBuf {
    let candidates = [
        root.join("target").join("debug").join("tiles"),
        root.join("target").join("release").join("tiles"),
        root.join("apps")
            .join("tiles-tui")
            .join("target")
            .join("debug")
            .join("tiles"),
        root.join("apps")
            .join("tiles-tui")
            .join("target")
            .join("release")
            .join("tiles"),
    ];
    for c in &candidates {
        if c.exists() {
            return c.clone();
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

/// Tauri command to return the embedded media server port.
#[tauri::command]
fn media_port(port_state: tauri::State<MediaPort>) -> u16 {
    *port_state.0.lock().unwrap()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let root = find_project_root().unwrap_or_else(|| {
        eprintln!("Warning: could not find tiles project root, using current directory");
        env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    });
    let tiles_bin = find_tiles_bin(&root);

    let media_port_num = media::pick_port();
    let media_root = root.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new(root, tiles_bin))
        .manage(MediaPort(Mutex::new(media_port_num)))
        .setup(move |_app| {
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
            commands::videos::delete_video,
            // folders
            commands::folders::create_folder,
            commands::folders::rename_folder,
            commands::folders::move_folder,
            commands::folders::delete_folder,
            commands::folders::move_videos,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
