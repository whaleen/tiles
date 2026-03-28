use tauri::State;

use crate::models::HealthStatus;
use crate::services::ffprobe;
use crate::state::AppState;

#[tauri::command]
pub fn get_health(state: State<AppState>) -> HealthStatus {
    HealthStatus {
        ok: ffprobe::check_ffmpeg() && ffprobe::check_ffprobe(),
        ffmpeg: ffprobe::check_ffmpeg(),
        ffprobe: ffprobe::check_ffprobe(),
        root: state.root.read().unwrap().display().to_string(),
        tiles_bin: state.tiles_bin.display().to_string(),
    }
}
