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
    /// Name of the composition the tile builder last had open for this project.
    #[serde(default)]
    pub active_composition: Option<String>,
}

/// One saved tile-builder composition (a named `TileSettings` document).
#[derive(Debug, Serialize)]
pub struct CompositionSummary {
    pub name: String,
    pub modified_epoch: u64,
    pub active: bool,
}

// --- Videos ---

#[derive(Debug, Clone, Serialize)]
pub struct VideoEntry {
    pub folder: String,
    pub name: String,
    pub rel_path: String,
    pub duration: Option<f64>,
    pub has_transcript: bool,
    pub size_bytes: u64,
}

#[derive(Debug, Serialize)]
pub struct VideoInfo {
    pub duration: f64,
    pub width: u32,
    pub height: u32,
}

/// Sprite-sheet metadata for a clip's scrub filmstrip. The image is served at
/// `<media>/filmstrips/<rel_path>`; cell `i` covers source time
/// `(i / frame_count) * duration`.
#[derive(Debug, Serialize)]
pub struct Filmstrip {
    pub frame_count: u32,
    pub columns: u32,
    pub frame_width: u32,
    pub frame_height: u32,
    pub duration: f64,
}

/// Waveform image metadata for a clip's audio. The image is served at
/// `<media>/waveforms/<rel_path>` and covers [0, duration] of the source; the
/// frontend slices [trimIn, trimOut] per clip.
#[derive(Debug, Serialize)]
pub struct Waveform {
    /// Whether the source has an audio stream. `false` is an expected state
    /// (silent clip), distinct from a generation failure (a command error).
    pub has_audio: bool,
    pub width: u32,
    pub height: u32,
    pub duration: f64,
}

// --- Settings ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineClipEntry {
    pub id: String,
    pub rel_path: String,
    #[serde(default)]
    pub trim_in: Option<f64>,
    #[serde(default)]
    pub trim_out: Option<f64>,
}

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
    pub timeline_clips: Vec<Vec<TimelineClipEntry>>,
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
    /// "edit" (deterministic, default) or "randomized" (generative knobs on).
    /// Absent on comps saved before the flag — inferred from generative fields.
    #[serde(default)]
    pub mode: Option<String>,
    /// Preview-only: show platform safe-zone guide overlays in the editor.
    /// Layout guidance metadata; does not affect render/export.
    #[serde(default)]
    pub show_safe_zones: Option<bool>,
    /// Safe-zone platform: "youtube-shorts" | "tiktok" | "instagram-reels".
    #[serde(default)]
    pub safe_zone_type: Option<String>,
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
    pub thumbnail: Option<String>,
}

// --- URL Import ---

#[derive(Debug, Serialize)]
pub struct YtDlpStatus {
    pub yt_dlp: bool,
    pub yt_dlp_version: Option<String>,
    pub ffmpeg: bool,
    pub ffmpeg_version: Option<String>,
    pub gallery_dl: bool,
    pub gallery_dl_version: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UrlImportAnalysis {
    pub sources: Vec<UrlImportSourceAnalysis>,
}

#[derive(Debug, Serialize)]
pub struct UrlImportSourceAnalysis {
    pub url: String,
    pub title: Option<String>,
    pub kind: String,
    pub candidate_count: usize,
    pub candidates: Vec<UrlImportCandidate>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UrlImportCandidate {
    pub id: Option<String>,
    pub title: String,
    pub url: String,
    pub webpage_url: Option<String>,
    pub uploader: Option<String>,
    pub duration: Option<f64>,
    pub duration_string: Option<String>,
    pub thumbnail: Option<String>,
    pub ext: Option<String>,
    pub resolution: Option<String>,
    pub playlist_index: Option<usize>,
    pub kind: String,
    pub format_count: usize,
    pub has_formats: bool,
    pub subtitles: Vec<String>,
    pub automatic_captions: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct UrlImportDownloadRequest {
    pub project: String,
    #[serde(default)]
    pub folder: String,
    #[serde(default)]
    pub urls: Vec<String>,
    #[serde(default)]
    pub options: Option<UrlImportOptions>,
}

#[derive(Debug, Deserialize, Default)]
pub struct UrlImportOptions {
    #[serde(default)]
    pub quality: Option<String>,
    #[serde(default)]
    pub write_subtitles: Option<bool>,
    #[serde(default)]
    pub write_auto_captions: Option<bool>,
    #[serde(default)]
    pub subtitle_languages: Option<String>,
    #[serde(default)]
    pub write_thumbnail: Option<bool>,
    #[serde(default)]
    pub write_info_json: Option<bool>,
    #[serde(default)]
    pub cookies_from_browser: Option<String>,
    #[serde(default)]
    pub include_images: Option<bool>,
    #[serde(default)]
    pub tool: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UrlImportDownloadResult {
    pub downloaded: Vec<String>,
    pub failures: Vec<String>,
}

// --- Actions ---

#[derive(Debug, Serialize)]
pub struct ActionInfo {
    pub name: String,
    pub label: String,
    pub description: String,
    pub target_type: String,
    pub media_types: Vec<String>,
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
    pub progress: Option<ActionProgress>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ActionProgress {
    pub phase: String,
    pub current: Option<u64>,
    pub total: Option<u64>,
    pub percent: Option<f64>,
    pub message: Option<String>,
}

// --- Folder Order ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderOrder {
    #[serde(default)]
    pub video_order: Vec<String>,
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
