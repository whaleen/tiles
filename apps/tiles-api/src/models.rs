use serde::{Deserialize, Serialize};

// --- Projects ---

#[derive(Debug, Serialize)]
pub struct ProjectSummary {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Serialize)]
pub struct ProjectDetail {
    pub name: String,
    pub path: String,
    pub video_count: usize,
    pub subfolders: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectMeta {
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub cover_image_rel: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

// --- Videos ---

#[derive(Debug, Serialize)]
pub struct VideoEntry {
    pub folder: String,
    pub name: String,
    pub rel_path: String,
    pub duration: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct VideoInfo {
    pub duration: f64,
    pub width: u32,
    pub height: u32,
}

// --- Settings ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TileSettings {
    #[serde(default)]
    pub layout_code: Option<String>,
    #[serde(default)]
    pub crop_mode: Option<String>,
    #[serde(default)]
    pub layout_mode: Option<String>,
    #[serde(default)]
    pub layout_rects: Vec<LayoutRect>,
    #[serde(default)]
    pub layout_tree: Option<serde_json::Value>,
    #[serde(default)]
    pub render_mode: Option<String>,
    #[serde(default)]
    pub output_mode: Option<String>,
    #[serde(default)]
    pub no_overwrite: Option<bool>,
    #[serde(default)]
    pub tile_folders: Vec<String>,
    #[serde(default)]
    pub audio_enabled: Option<bool>,
    #[serde(default)]
    pub audio_tiles: Vec<usize>,
    #[serde(default)]
    pub audio_tile: Option<usize>,
    #[serde(default)]
    pub max_total_duration: Option<f64>,
    #[serde(default)]
    pub max_duration: Option<f64>,
    #[serde(default)]
    pub distribution_mode: Option<String>,
    #[serde(default)]
    pub max_durations: Vec<Option<f64>>,
    #[serde(default)]
    pub tile_settings: Vec<TileSettingEntry>,
    #[serde(default)]
    pub sizing_mode: Option<String>,
    #[serde(default)]
    pub canvas_width: Option<u32>,
    #[serde(default)]
    pub canvas_height: Option<u32>,
    #[serde(default)]
    pub padding: Option<u32>,
    #[serde(default)]
    pub bg_color: Option<String>,
    #[serde(default)]
    pub no_repeat: Option<bool>,
    #[serde(default)]
    pub output_length_policy: Option<String>,
    #[serde(default)]
    pub source_repeat_policy: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayoutRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TileSettingEntry {
    #[serde(default = "default_trans_type")]
    pub trans_type: String,
    #[serde(default)]
    pub trans_duration: f64,
    #[serde(default = "default_crop_position")]
    pub crop_position: String,
    #[serde(default = "default_speed")]
    pub speed: f64,
    #[serde(default = "default_mode")]
    pub mode: String,
    #[serde(default = "default_image_duration")]
    pub image_duration: f64,
    #[serde(default)]
    pub use_landscape: bool,
    #[serde(default)]
    pub max_duration: Option<f64>,
}

fn default_trans_type() -> String {
    "none".to_string()
}
fn default_crop_position() -> String {
    "center".to_string()
}
fn default_speed() -> f64 {
    1.0
}
fn default_mode() -> String {
    "video".to_string()
}
fn default_image_duration() -> f64 {
    5.0
}

#[derive(Debug, Serialize)]
pub struct LayoutInfo {
    pub code: String,
    pub tile_count: usize,
}

// --- Outputs ---

#[derive(Debug, Serialize)]
pub struct OutputRun {
    pub project: String,
    pub tool: String,
    pub run_id: String,
    pub run_rel: String,
    pub sample_url: Option<String>,
    pub log_file: Option<String>,
    pub modified_epoch: u64,
    pub video_count: usize,
}

#[derive(Debug, Serialize)]
pub struct OutputEntry {
    pub name: String,
    pub rel_path: String,
    pub is_dir: bool,
    pub size_bytes: u64,
    pub modified_epoch: u64,
    pub kind: String,
}

// --- Actions ---

#[derive(Debug, Serialize)]
pub struct ActionInfo {
    pub name: String,
    pub label: String,
    pub description: String,
    pub target_type: String,
}

#[derive(Debug, Deserialize)]
pub struct ActionRunRequest {
    pub action: String,
    #[serde(default)]
    pub targets: Vec<String>,
    #[serde(default = "default_target_type")]
    pub target_type: String,
    #[serde(default = "default_output_mode")]
    pub output_mode: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

fn default_target_type() -> String {
    "folders".to_string()
}
fn default_output_mode() -> String {
    "source".to_string()
}

#[derive(Debug, Serialize)]
pub struct ActionRunResult {
    pub exit_code: i32,
    pub output: String,
    pub log_file: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct RunningAction {
    pub id: String,
    pub action: String,
    pub output_mode: String,
    pub output: Option<String>,
    pub project: Option<String>,
    pub started_epoch: u64,
    pub targets: Vec<String>,
}

// --- Health ---

#[derive(Debug, Serialize)]
pub struct HealthStatus {
    pub ok: bool,
    pub ffmpeg: bool,
    pub ffprobe: bool,
    pub root: String,
    pub tiles_bin: String,
}
