use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::env;
use std::ffi::OsString;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{self, BufRead, Read, Seek, SeekFrom, Stdout, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::process::{exit, Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crossterm::event::{self, Event, KeyCode, KeyEventKind};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Alignment, Constraint, Direction, Layout};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, List, ListItem, ListState, Padding, Paragraph, Wrap};
use ratatui::Terminal;

const HELP_TEXT: &str = r#"tiles - Rust launcher for the tiles toolkit

USAGE:
  tiles                     Launch native interactive menu
  tiles tui                 Launch native interactive menu
  tiles tile [args...]      Run tile builder CLI (native Rust)
  tiles concat [args...]    Run concat CLI (native Rust)
  tiles trim [args...]      Run trim CLI (native Rust)
  tiles detect [args...]    Run scene-detect CLI (native Rust)
  tiles split-detect [args...]  Detect split-screen tiles and export clips
  tiles yt-import [args...]  Download YouTube, fetch transcript, split tiles
  tiles clean [args...]     Run clean-folder CLI (native Rust)
  tiles run [args...]       Run using saved settings (native Rust)
  tiles doctor-reencode     Doctor: re-encode CFR
  tiles doctor-trim-start   Doctor: trim start from clips
  tiles organize-landscape  Move landscape clips into landscape/ subdir
   tiles slowmo              Make slow-motion versions
   tiles strip-audio         Remove audio from videos
   tiles chop                Split videos into smaller segments
   tiles crop                Crop videos to a specific region
   tiles yolo                Run YOLO random tile render
   tiles web                 Launch minimal browser UI
  tiles help                Show this help

EXAMPLES:
  tiles
  tiles concat ready bench -o outputs/concatenated
  tiles trim ready --start 0.5 --end 0.25
  tiles clean ready -m 3 -n
  tiles detect ready --threshold 0.27
  tiles split-detect ready
  tiles yt-import "https://www.youtube.com/watch?v=..."
  tiles concat ready --transition fade --duration 1.0
  tiles run --render-mode preview --no-overwrite
"#;

const DETAILED_HELP_TEXT: &str = r#"Overview:
  - This TUI builds tiled videos from folders in src/
  - Settings default to configs/tile_videos_settings.json
  - Outputs go to outputs/tiled by default

Quick start:
  1) Run saved settings (or create/update in Tile workflows)
  2) Pick render mode
  3) Check outputs/tiled

Main menu:
  - Run saved settings
  - Tile workflows
  - Concat / Trim / Detect / Split Detect / Clean / YouTube Import
  - Tools and Doctor
  - Help

Tile workflows:
  - Quick tile run
  - Run default saved settings
  - Run from settings file
  - Create/update settings
  - Edit existing settings
  - YOLO random run

Layouts:
  - 2x1, 1x2, 2x2, 2x3, 3x2, 3x1, 1x3, 4x1, 1x4, 3x3
  - 2x2-focus, 3x3-focus, pip, 1+2, 2+1, 1+3
  - left-big-right-stack, top-big-bottom-stack

Distribution:
  - round-robin
  - sequential
  - random
  - shuffle-round-robin

Fit modes:
  - crop, pad, stretch

Logs:
  - Menu runs write logs to outputs/tui-logs
  - tile runs: tui_run_*.log
  - tools: tui_*.log
  - tiles web starts a minimal browser UI
  - source outputs: outputs/<tool>/run_<ts>/ under each src folder
"#;

const CONCAT_HELP: &str = r#"tiles concat - native Rust concat

USAGE:
  tiles concat <folder> [<folder> ...] [options]

OPTIONS:
  -o, --output <dir>          Output directory (default: outputs/concatenated)
  -t, --transition <type>     cut | fade | fadeblack | dissolve (default: cut)
  -d, --duration <seconds>    Transition duration (default: 1.0)
  -h, --help                  Show this help
"#;

const TRIM_HELP: &str = r#"tiles trim - native Rust trim

USAGE:
  tiles trim <input> [<input> ...] [options]

OPTIONS:
  -o, --output <dir>          Output directory (default: outputs/trimmed)
  -s, --start <seconds>       Trim from start (default: 0)
  -e, --end <seconds>         Trim from end (default: 0)
      --overwrite             Overwrite original videos in place
      --no-audio              Strip audio from the output
  -h, --help                  Show this help
"#;

const CLEAN_HELP: &str = r#"tiles clean - native Rust clean

USAGE:
  tiles clean <folder> [<folder> ...] [options]

OPTIONS:
  -m, --mode <1|2|3>         1=duplicates, 2=rename, 3=both (default: 3)
  -n, --number               Add sequential number prefix when renaming
  -h, --help                 Show this help
"#;

const DETECT_HELP: &str = r#"tiles detect - native Rust scene detect

USAGE:
  tiles detect <input> [<input> ...] [options]

OPTIONS:
  -o, --output <dir>          Output directory (default: outputs/scenes)
      --list-only             Only list detected scenes
  -t, --threshold <value>     Scene threshold (default: 0.27)
  -m, --method <name>         content | adaptive (adaptive uses ffmpeg scene heuristic)
  -h, --help                  Show this help
"#;

const SPLIT_DETECT_HELP: &str = r#"tiles split-detect - detect split-screen tiles

USAGE:
  tiles split-detect <input> [<input> ...] [options]

OPTIONS:
  -o, --output <dir>          Output directory (default: outputs/split-detect)
      --quality <level>       low | medium | high | ultra (default: medium)
      --clip-seconds <value>  Limit export duration (seconds)
      --fast-preview          Very fast encode (low fps + downscale)
      --force-2x1              Force a left/right two-panel split
  -h, --help                  Show this help
"#;

const YT_IMPORT_HELP: &str = r#"tiles yt-import - download YouTube, split tiles, fetch transcript

USAGE:
  tiles yt-import <url> [<url> ...] [options]

OPTIONS:
  -o, --output <dir>          Output directory (default: outputs/yt-import)
      --quality <level>       low | medium | high | ultra (default: medium)
      --clip-seconds <value>  Limit export duration (seconds)
      --fast-preview          Very fast encode (low fps + downscale)
      --force-2x1              Force a left/right two-panel split
      --cookies-from-browser <name>  Use browser cookies (chrome|brave|edge|firefox|safari)
      --cookies <file>         Path to cookies.txt
  -h, --help                  Show this help
"#;

const TILE_HELP: &str = r#"tiles tile - native Rust tiler

USAGE:
  tiles tile <folder> [<folder> ...] [options]

OPTIONS:
  -l, --layout <code>         Layout code (2x1,1x2,2x2,2x3,3x2,3x1,1x3,4x1,1x4,3x3,2x2-focus,3x3-focus,pip,1+2,2+1,1+3,left-big-right-stack,top-big-bottom-stack)
  -o, --output <file>         Output file path (default: outputs/tiled/<auto>.mp4)
  -w, --width <px>            Output width (default: 1920)
      --height <px>           Output height (default: 1080)
      --settings <file>       Load settings JSON (configs/tile_videos_settings.json)
      --render-mode <mode>    full | preview | fast-preview (default: full)
      --crop-mode <mode>      crop | pad | stretch (default: crop)
      --transition <type>     cut | fade | fadeblack | dissolve (default: cut)
      --transition-duration <s> Transition duration for fade/fadeblack/dissolve
      --speed <factor>        Playback speed factor (default: 1.0)
      --distribution-mode <m> none | round-robin | sequential | random | shuffle-round-robin
      --max-duration <s>      Ignore source clips longer than this duration
      --audio-tiles <list>    Comma-separated tile indexes for audio mix (default: 0)
      --no-audio              Disable audio
      --max-total-duration <s>Cap final output duration
      --no-overwrite          Avoid clobbering output by adding numeric suffix
      --force-cfr             Force CFR for intermediate/final renders
  -h, --help                  Show this help
"#;

const DOCTOR_REENCODE_HELP: &str = r#"tiles doctor-reencode - re-encode clips to CFR

USAGE:
  tiles doctor-reencode <folder> [<folder> ...] [options]

OPTIONS:
  -o, --output <dir>     Output directory (default: doctor_cfr/ per folder)
      --fps <value>        Target FPS (default: 30)
      --no-audio           Strip audio
      --overwrite          Overwrite originals (default writes to doctor_cfr/)
  -h, --help               Show this help
"#;

const DOCTOR_TRIM_HELP: &str = r#"tiles doctor-trim-start - trim start from clips

USAGE:
  tiles doctor-trim-start <folder> [<folder> ...] [options]

OPTIONS:
  -o, --output <dir>     Output directory (default: doctor_trim/ per folder)
      --seconds <value>    Seconds to trim from start (default: 1.0)
      --no-audio           Strip audio
      --overwrite          Overwrite originals (default writes to doctor_trim/)
  -h, --help               Show this help
"#;

const ORGANIZE_LANDSCAPE_HELP: &str = r#"tiles organize-landscape - move landscape clips into landscape/

USAGE:
  tiles organize-landscape <folder> [<folder> ...]

OPTIONS:
  -h, --help               Show this help
"#;

const SLOWMO_HELP: &str = r#"tiles slowmo - create slow-motion clips

USAGE:
  tiles slowmo <folder> [<folder> ...] [options]

OPTIONS:
  -o, --output <dir>      Output directory (default: slowmo/ per folder)
      --factor <value>     Speed factor (e.g. 0.5 = 2x slower, default: 0.5)
      --no-audio           Strip audio
      --overwrite          Overwrite originals (default writes to slowmo/)
  -h, --help               Show this help
"#;

const CROP_HELP: &str = r#"tiles crop - crop videos to a specific region

USAGE:
  tiles crop <input> [<input> ...] [options]

OPTIONS:
  -o, --output <dir>          Output directory (default: outputs/crop)
      --x <pixels>            Left offset (default: 0)
      --y <pixels>            Top offset (default: 0)
      --w <pixels>            Crop width (required)
      --h <pixels>            Crop height (required)
      --overwrite             Overwrite original videos in place
  -h, --help                  Show this help

EXAMPLES:
  tiles crop src/myproject/video.mp4 --x 100 --y 50 --w 1280 --h 720
  tiles crop src/myproject --w 1080 --h 1080 --overwrite
"#;

const STRIP_AUDIO_HELP: &str = r#"tiles strip-audio - remove audio from videos

USAGE:
  tiles strip-audio <input> [<input> ...] [options]

OPTIONS:
  -o, --output <dir>          Output directory (default: outputs/strip-audio)
      --overwrite             Overwrite original videos in place
  -h, --help                  Show this help
"#;

const CHOP_HELP: &str = r#"tiles chop - split videos into smaller segments

USAGE:
  tiles chop <input> [<input> ...] [options]

OPTIONS:
  -o, --output <dir>          Output directory (default: outputs/chop)
      --duration <seconds>    Split every N seconds (default mode, 30s)
      --count <n>             Split into N equal parts (overrides --duration)
      --overwrite             Overwrite original videos in place
  -h, --help                  Show this help

EXAMPLES:
  tiles chop src/myproject/long-video.mp4 --duration 30
  tiles chop src/myproject --count 4
"#;

const LOOP_HELP: &str = r#"tiles loop - loop a video N times

USAGE:
  tiles loop <input> [<input> ...] [options]

OPTIONS:
  -o, --output <dir>          Output directory (default: outputs/loop)
  -c, --count <n>             Number of loops (default: 2)
  -t, --transition <type>     cut | fade | fadeblack | dissolve (default: cut)
  -d, --duration <seconds>    Transition duration (default: 1.0)
  -h, --help                  Show this help

EXAMPLES:
  tiles loop src/myproject/clip.mp4 --count 3
  tiles loop src/myproject/clip.mp4 --count 4 --transition fade --duration 0.5
"#;

const RUN_HELP: &str = r#"tiles run - run using saved settings

USAGE:
  tiles run [options]

OPTIONS:
      --settings <file>     Settings file path (default from VIDEO_TILING_SETTINGS_PATH or configs/tile_videos_settings.json)
      --render-mode <mode>  full | preview | fast-preview (default: full)
      --output <file>       Output file path override
      --no-overwrite        Avoid overwriting output
      --force-cfr           Force CFR for intermediate/final renders
  -h, --help               Show this help
"#;

const VIDEO_EXTENSIONS: &[&str] = &[
    ".mp4", ".mov", ".avi", ".mkv", ".flv", ".wmv", ".m4v", ".webm",
];
const IMAGE_EXTENSIONS: &[&str] = &[
    ".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tiff", ".tif", ".heic", ".heif", ".avif",
];
const SOURCE_OUTPUT_TOKEN: &str = "__source_outputs__";
const ALONGSIDE_TOKEN: &str = "__alongside__";

#[derive(Debug, Clone)]
struct ConcatOptions {
    folders: Vec<String>,
    output_dir: String,
    transition: String,
    duration: f64,
}

#[derive(Debug, Clone)]
struct LoopOptions {
    inputs: Vec<String>,
    output_dir: String,
    count: u32,
    transition: String,
    duration: f64,
}

#[derive(Debug, Clone)]
struct TrimOptions {
    folders: Vec<String>,
    output_dir: String,
    trim_start: f64,
    trim_end: f64,
    overwrite: bool,
    no_audio: bool,
}

#[derive(Debug, Clone)]
struct ChopOptions {
    folders: Vec<String>,
    output_dir: String,
    duration: Option<f64>,
    count: Option<u64>,
    overwrite: bool,
}

#[derive(Debug, Clone)]
struct CleanOptions {
    folders: Vec<String>,
    mode: String,
    add_number: bool,
}

#[derive(Debug, Clone)]
struct DetectOptions {
    inputs: Vec<String>,
    output_dir: String,
    list_only: bool,
    threshold: f64,
    method: String,
}

#[derive(Debug, Clone)]
struct SplitDetectOptions {
    inputs: Vec<String>,
    output_dir: String,
    force_two_panel: bool,
    quality: String,
    clip_seconds: Option<f64>,
    fast_preview: bool,
}

#[derive(Debug, Clone)]
struct YtImportOptions {
    urls: Vec<String>,
    output_dir: String,
    force_two_panel: bool,
    quality: String,
    clip_seconds: Option<f64>,
    cookies_from_browser: Option<String>,
    cookies_file: Option<String>,
    fast_preview: bool,
}

#[derive(Debug, Clone)]
struct StripAudioOptions {
    inputs: Vec<String>,
    output_dir: String,
    overwrite: bool,
}

#[derive(Debug, Clone)]
struct TileOptions {
    folders: Vec<String>,
    layout: String,
    output: Option<String>,
    width: u32,
    height: u32,
    settings_path: Option<String>,
    render_mode: String,
    crop_mode: String,
    transition: String,
    transition_duration: f64,
    speed: f64,
    distribution_mode: String,
    max_duration: Option<f64>,
    audio_tiles: Vec<usize>,
    audio_enabled: bool,
    max_total_duration: Option<f64>,
    no_overwrite: bool,
    force_cfr: bool,
    layout_mode: String,
    sizing_mode: String,
    padding: u32,
    bg_color: String,
    no_repeat: bool,
    output_length_policy: String,
    source_repeat_policy: String,
}

#[derive(Debug, Clone, Default)]
struct LoadedSettings {
    layout_code: Option<String>,
    crop_mode: Option<String>,
    layout_mode: Option<String>,
    layout_rects: Vec<LayoutRect>,
    render_mode: Option<String>,
    tile_folders: Vec<String>,
    audio_enabled: Option<bool>,
    audio_tiles: Vec<usize>,
    max_total_duration: Option<f64>,
    tile_transitions: Vec<String>,
    tile_transition_durations: Vec<f64>,
    tile_speeds: Vec<f64>,
    tile_modes: Vec<String>,
    tile_image_durations: Vec<f64>,
    tile_use_landscape: Vec<bool>,
    tile_crop_positions: Vec<String>,
    max_durations: Vec<Option<f64>>,
    max_duration: Option<f64>,
    distribution_mode: Option<String>,
    audio_tile: Option<usize>,
    sizing_mode: Option<String>,
    canvas_width: Option<u32>,
    canvas_height: Option<u32>,
    padding: Option<u32>,
    bg_color: Option<String>,
    no_repeat: Option<bool>,
    output_length_policy: Option<String>,
    source_repeat_policy: Option<String>,
}

#[derive(Debug, Clone)]
struct LayoutRect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[derive(Debug, Clone)]
struct ClipInfo {
    duration: f64,
    width: u32,
    height: u32,
    has_audio: bool,
    video_stream_index: u32,
}

#[derive(Debug, Clone)]
struct TileRect {
    x: u32,
    y: u32,
    w: u32,
    h: u32,
}

// --- FFmpeg Pipeline Contract ---

struct FFmpegPipeline {
    cmd: Command,
    has_video: bool,
    has_audio: bool,
}

impl FFmpegPipeline {
    fn new(root: &Path) -> Self {
        let mut cmd = Command::new("ffmpeg");
        cmd.current_dir(root);
        // Force monotonic PTS at the input level
        cmd.arg("-fflags").arg("+genpts");
        Self {
            cmd,
            has_video: false,
            has_audio: false,
        }
    }

    fn add_input(&mut self, path: &Path, loop_input: bool) -> &mut Self {
        if loop_input {
            self.cmd.arg("-stream_loop").arg("-1");
        }
        self.cmd.arg("-i").arg(path);
        self
    }

    // Helper to restore the command after a mutable borrow (Rust Command doesn't chain well with custom logic)
    fn set_cmd(&mut self, cmd: Command) {
        self.cmd = cmd;
    }

    fn apply_canonical_video_params(&mut self) -> &mut Self {
        // Enforce CFR, 30fps, and yuv420p for all outputs
        self.cmd.args(["-vf", "fps=30,format=yuv420p", "-vsync", "cfr"]);
        self.cmd.args(["-c:v", "libx264", "-preset", "medium", "-crf", "23"]);
        self.has_video = true;
        self
    }

    fn apply_video_params(&mut self, filter: Option<String>) -> &mut Self {
        let base_filter = "fps=30,format=yuv420p";
        let final_filter = match filter {
            Some(f) => format!("{f},{base_filter}"),
            None => base_filter.to_string(),
        };
        self.cmd.arg("-vf").arg(final_filter);
        self.cmd.args(["-vsync", "cfr", "-fps_mode", "cfr"]);
        self.cmd.args(["-c:v", "libx264", "-preset", "medium", "-crf", "23"]);
        self.has_video = true;
        self
    }

    fn apply_canonical_audio_params(&mut self, enabled: bool) -> &mut Self {
        if !enabled {
            self.cmd.arg("-an");
        } else {
            // Enforce fixed sample rate and layout
            self.cmd.args([
                "-c:a", "aac", 
                "-b:a", "192k", 
                "-ar", "48000", 
                "-ac", "2"
            ]);
        }
        self.has_audio = enabled;
        self
    }

    fn apply_audio_params(&mut self, filter: Option<String>) -> &mut Self {
        if let Some(f) = filter {
            self.cmd.arg("-af").arg(f);
        }
        self.apply_canonical_audio_params(true)
    }

    fn set_duration(&mut self, duration: f64) -> &mut Self {
        self.cmd.arg("-t").arg(format!("{duration:.6}"));
        self
    }

    fn run(mut self, output: &Path) -> bool {
        self.cmd.arg("-y").arg(output);
        match self.cmd.output() {
            Ok(o) => o.status.success(),
            Err(_) => false,
        }
    }
}

fn normalize_video(input: &Path, output: &Path, root: &Path) -> bool {
    let mut pipeline = FFmpegPipeline::new(root);
    pipeline.cmd.arg("-i").arg(input);
    pipeline.apply_video_params(None);
    pipeline.apply_canonical_audio_params(has_audio_stream(input, root));
    pipeline.run(output)
}

fn main() {
    let code = run();
    exit(code);
}

fn run() -> i32 {
    let args: Vec<OsString> = env::args_os().skip(1).collect();
    if args.is_empty() {
        return run_native_menu();
    }

    let cmd = args[0].to_string_lossy().to_string();
    let rest = &args[1..];

    match cmd.as_str() {
        "tui" => run_native_menu(),
        "tile" => run_tile(rest),
        "concat" => run_concat(rest),
        "loop" => run_loop(rest),
        "trim" => run_trim(rest),
        "detect" | "scenes" => run_detect(rest),
        "split-detect" => run_split_detect(rest),
        "yt-import" => run_yt_import(rest),
        "clean" => run_clean(rest),
        "run" => run_saved_settings_cli(rest),
        "doctor-reencode" => run_doctor_reencode(rest),
        "doctor-trim-start" => run_doctor_trim_start(rest),
        "organize-landscape" => run_organize_landscape(rest),
        "slowmo" => run_slowmo(rest),
        "strip-audio" => run_strip_audio(rest),
        "chop" => run_chop(rest),
        "crop" => run_crop(rest),
        "web" => run_web_ui(),
        "yolo" => match run_yolo_tile(find_repo_root().as_deref()) {
            Ok(code) => code,
            Err(err) => {
                eprintln!("error: {err}");
                1
            }
        },
        "help" | "--help" | "-h" => {
            println!("{HELP_TEXT}");
            0
        }
        "--version" | "-V" | "version" => {
            println!("tiles {}", env!("CARGO_PKG_VERSION"));
            0
        }
        other => {
            eprintln!("error: unknown command '{other}'\n");
            eprintln!("{HELP_TEXT}");
            2
        }
    }
}

fn run_native_menu() -> i32 {
    match run_native_menu_tui() {
        Ok(code) => code,
        Err(err) => {
            eprintln!(
                "warning: failed to start full-screen TUI ({err}), falling back to prompt mode"
            );
            run_native_menu_prompt()
        }
    }
}

fn run_native_menu_prompt() -> i32 {
    let root = find_repo_root();
    loop {
        println!();
        println!("tiles");
        println!("  1) Run saved settings");
        println!("  2) Tile workflows");
        println!("  3) Concat videos");
        println!("  4) Trim videos");
        println!("  5) Detect scenes");
        println!("  6) Clean folders");
        println!("  7) Tools and Doctor");
        println!("  8) Help");
        println!("  9) Exit");
        print!("Select an option: ");
        let _ = io::stdout().flush();

        let mut choice = String::new();
        if io::stdin().read_line(&mut choice).is_err() {
            return 1;
        }
        let choice = choice.trim();

        match choice {
            "1" => {
                let code = run_tile_default_settings(root.as_deref());
                if code != 0 {
                    eprintln!("tile failed with exit code {code}");
                }
            }
            "2" => {
                let code = run_tile_menu(root.as_deref());
                if code != 0 {
                    eprintln!("tile menu failed with exit code {code}");
                }
            }
            "3" => {
                let args = build_concat_args_wizard(root.as_deref());
                let code = run_logged_subcommand("concat", &args);
                if code != 0 {
                    eprintln!("concat failed with exit code {code}");
                }
            }
            "4" => {
                let args = build_trim_args_wizard(root.as_deref());
                let code = run_logged_subcommand("trim", &args);
                if code != 0 {
                    eprintln!("trim failed with exit code {code}");
                }
            }
            "5" => {
                let args = build_detect_args_wizard(root.as_deref());
                let code = run_logged_subcommand("detect", &args);
                if code != 0 {
                    eprintln!("detect failed with exit code {code}");
                }
            }
            "6" => {
                let args = build_clean_args_wizard(root.as_deref());
                let code = run_logged_subcommand("clean", &args);
                if code != 0 {
                    eprintln!("clean failed with exit code {code}");
                }
            }
            "7" => {
                let code = run_tools_menu(root.as_deref());
                if code != 0 {
                    eprintln!("tools menu failed with exit code {code}");
                }
            }
            "8" => {
                println!("{DETAILED_HELP_TEXT}");
            }
            "9" | "q" | "quit" | "exit" => return 0,
            _ => println!("Invalid option."),
        }
    }
}

fn run_web_ui() -> i32 {
    let (listener, port) = match bind_web_listener() {
        Some(v) => v,
        None => {
            eprintln!("error: failed to bind web server port");
            return 1;
        }
    };
    let url = format!("http://127.0.0.1:{port}/");
    println!("tiles web running at {url}");
    open_browser(&url);
    for stream in listener.incoming() {
        let Ok(mut stream) = stream else {
            continue;
        };
        let Some(req) = read_http_request(&mut stream) else {
            let _ = respond_text(&mut stream, 400, "Bad Request", "Bad Request");
            continue;
        };
        let response = match (req.method.as_str(), req.path.as_str()) {
            ("GET", "/") => respond_html(
                &mut stream,
                200,
                "OK",
                &web_index_html_studio_v2(find_repo_root().as_deref()),
            ),
            ("GET", path) if path.starts_with("/files/") => handle_web_file(&mut stream, &req),
            ("GET", path) if path.starts_with("/thumbs/") => handle_web_thumb(&mut stream, &req),
            ("GET", path) if path.starts_with("/outfiles/") => {
                handle_web_outfile(&mut stream, &req)
            }
            ("GET", path) if path.starts_with("/outthumbs/") => {
                handle_web_outthumb(&mut stream, &req)
            }
            ("POST", "/run") => handle_web_run(&mut stream, &req),
            _ => respond_text(&mut stream, 404, "Not Found", "Not Found"),
        };
        if response.is_err() {
            let _ = stream.shutdown(std::net::Shutdown::Both);
        }
    }
    0
}

fn bind_web_listener() -> Option<(TcpListener, u16)> {
    for port in 8787..=8797 {
        let addr = format!("127.0.0.1:{port}");
        if let Ok(listener) = TcpListener::bind(addr) {
            return Some((listener, port));
        }
    }
    None
}

fn open_browser(url: &str) {
    if cfg!(target_os = "macos") {
        let _ = Command::new("open").arg(url).status();
    } else if cfg!(target_os = "windows") {
        let _ = Command::new("cmd").args(["/C", "start", "", url]).status();
    } else {
        let _ = Command::new("xdg-open").arg(url).status();
    }
}

#[derive(Debug)]
struct WebRequest {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

fn read_http_request(stream: &mut TcpStream) -> Option<WebRequest> {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 1024];
    loop {
        let n = stream.read(&mut tmp).ok()?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&tmp[..n]);
        if buf.windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
    }
    let header_end = buf
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .map(|i| i + 4)?;
    let header_text = String::from_utf8_lossy(&buf[..header_end]);
    let mut lines = header_text.lines();
    let request_line = lines.next()?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next()?.to_string();
    let path = parts.next()?.to_string();
    let mut headers = HashMap::new();
    for line in lines {
        if line.is_empty() {
            continue;
        }
        if let Some((k, v)) = line.split_once(':') {
            headers.insert(k.trim().to_lowercase(), v.trim().to_string());
        }
    }
    let content_len = headers
        .get("content-length")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(0);
    let mut body = buf[header_end..].to_vec();
    while body.len() < content_len {
        let n = stream.read(&mut tmp).ok()?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&tmp[..n]);
    }
    body.truncate(content_len);
    Some(WebRequest {
        method,
        path,
        headers,
        body,
    })
}

fn respond_html(stream: &mut TcpStream, code: u16, status: &str, body: &str) -> io::Result<()> {
    respond_with(stream, code, status, "text/html; charset=utf-8", body)
}

fn respond_text(stream: &mut TcpStream, code: u16, status: &str, body: &str) -> io::Result<()> {
    respond_with(stream, code, status, "text/plain; charset=utf-8", body)
}

fn respond_with(
    stream: &mut TcpStream,
    code: u16,
    status: &str,
    content_type: &str,
    body: &str,
) -> io::Result<()> {
    let response = format!(
        "HTTP/1.1 {code} {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.as_bytes().len(),
        body
    );
    stream.write_all(response.as_bytes())
}

fn respond_bytes(
    stream: &mut TcpStream,
    code: u16,
    status: &str,
    content_type: &str,
    body: &[u8],
    extra_headers: &[(&str, String)],
) -> io::Result<()> {
    let mut header = format!(
        "HTTP/1.1 {code} {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n",
        body.len()
    );
    for (k, v) in extra_headers {
        header.push_str(&format!("{k}: {v}\r\n"));
    }
    header.push_str("\r\n");
    stream.write_all(header.as_bytes())?;
    stream.write_all(body)
}

fn handle_web_run(stream: &mut TcpStream, req: &WebRequest) -> io::Result<()> {
    let body = String::from_utf8_lossy(&req.body);
    let form = parse_urlencoded(&body);
    let cmd = form
        .get("cmd")
        .cloned()
        .unwrap_or_else(|| "concat".to_string());
    let raw_folders = form.get("folders").cloned().unwrap_or_default();
    let folders = parse_csv_paths(&raw_folders)
        .into_iter()
        .filter(|v| !v.is_empty())
        .collect::<Vec<_>>();
    let raw_videos = form.get("videos").cloned().unwrap_or_default();
    let videos = parse_csv_paths(&raw_videos)
        .into_iter()
        .filter(|v| !v.is_empty())
        .collect::<Vec<_>>();
    if folders.is_empty() && videos.is_empty() {
        return respond_html(
            stream,
            400,
            "Bad Request",
            "<h2>Missing inputs</h2><p>Select folders or videos.</p><p><a href=\"/\">Back</a></p>",
        );
    }
    let output_mode = form
        .get("output_mode")
        .cloned()
        .unwrap_or_else(|| "source".to_string());
    let source_subdir = form
        .get("source_subdir")
        .cloned()
        .unwrap_or_else(|| "outputs".to_string());
    let custom_output = form.get("custom_output").cloned().unwrap_or_default();
    let mut output_value: Option<String> = None;
    let mut overwrite = false;
    match output_mode.as_str() {
        "overwrite" => overwrite = true,
        "global" => {}
        "custom" => {
            if !custom_output.trim().is_empty() {
                output_value = Some(custom_output);
            } else {
                output_value = Some(build_source_output_token(&source_subdir));
            }
        }
        _ => {
            output_value = Some(build_source_output_token(&source_subdir));
        }
    }

    if overwrite && cmd != "trim" && cmd != "strip-audio" {
        return respond_html(
            stream,
            400,
            "Bad Request",
            "<h2>Overwrite not supported</h2><p>Overwrite works with trim or strip-audio only.</p><p><a href=\"/\">Back</a></p>",
        );
    }

    if !videos.is_empty() && cmd == "concat" {
        return respond_html(
            stream,
            400,
            "Bad Request",
            "<h2>Concat needs folders</h2><p>Clear video selection or pick folders.</p><p><a href=\"/\">Back</a></p>",
        );
    }

    let mut args: Vec<OsString> = if !videos.is_empty() {
        videos.into_iter().map(OsString::from).collect()
    } else {
        folders.into_iter().map(OsString::from).collect()
    };
    match cmd.as_str() {
        "concat" => {
            if let Some(v) = form.get("transition") {
                if !v.trim().is_empty() {
                    args.push("--transition".into());
                    args.push(v.into());
                }
            }
            if let Some(v) = form.get("duration") {
                if !v.trim().is_empty() {
                    args.push("--duration".into());
                    args.push(v.into());
                }
            }
        }
        "trim" => {
            if let Some(v) = form.get("trim_start") {
                if !v.trim().is_empty() {
                    args.push("--start".into());
                    args.push(v.into());
                }
            }
            if let Some(v) = form.get("trim_end") {
                if !v.trim().is_empty() {
                    args.push("--end".into());
                    args.push(v.into());
                }
            }
        }
        "detect" => {
            if let Some(v) = form.get("threshold") {
                if !v.trim().is_empty() {
                    args.push("--threshold".into());
                    args.push(v.into());
                }
            }
            if let Some(v) = form.get("method") {
                if !v.trim().is_empty() {
                    args.push("--method".into());
                    args.push(v.into());
                }
            }
            if form.get("list_only").is_some() {
                args.push("--list-only".into());
            }
        }
        "strip-audio" => {}
        _ => {}
    }
    if overwrite {
        args.push("--overwrite".into());
    }
    if !overwrite {
        if let Some(output) = output_value {
            args.push("--output".into());
            args.push(output.into());
        }
    }

    let (status, combined, log_path) = run_web_subcommand(&cmd, &args);
    let body = web_result_html(&cmd, &args, status, &combined, &log_path);
    respond_html(stream, 200, "OK", &body)
}

fn handle_web_file(stream: &mut TcpStream, req: &WebRequest) -> io::Result<()> {
    let root = match find_repo_root() {
        Some(r) => r,
        None => return respond_text(stream, 404, "Not Found", "Not Found"),
    };
    let rel = req.path.trim_start_matches("/files/");
    let rel = url_decode(rel);
    let rel_path = Path::new(&rel);
    if rel_path.is_absolute() || rel.contains("..") {
        return respond_text(stream, 400, "Bad Request", "Bad Request");
    }
    let full = root.join("src").join(rel_path);
    if !full.exists() || !full.is_file() {
        return respond_text(stream, 404, "Not Found", "Not Found");
    }
    let mut file = match fs::File::open(&full) {
        Ok(f) => f,
        Err(_) => return respond_text(stream, 404, "Not Found", "Not Found"),
    };
    let metadata = match file.metadata() {
        Ok(m) => m,
        Err(_) => return respond_text(stream, 404, "Not Found", "Not Found"),
    };
    let total = metadata.len();
    let mut start = 0u64;
    let mut end = total.saturating_sub(1);
    let mut status = (200, "OK");
    if let Some(range) = req.headers.get("range") {
        if let Some(range) = range.strip_prefix("bytes=") {
            let mut parts = range.split('-');
            let start_str = parts.next().unwrap_or("");
            let end_str = parts.next().unwrap_or("");
            if !start_str.is_empty() {
                start = start_str.parse::<u64>().unwrap_or(0);
            }
            if !end_str.is_empty() {
                end = end_str.parse::<u64>().unwrap_or(end);
            }
            if start > end || start >= total {
                return respond_text(stream, 416, "Range Not Satisfiable", "");
            }
            end = end.min(total.saturating_sub(1));
            status = (206, "Partial Content");
        }
    }
    let len = end.saturating_sub(start) + 1;
    if file.seek(SeekFrom::Start(start)).is_err() {
        return respond_text(stream, 500, "Server Error", "");
    }
    let mut buf = vec![0u8; len as usize];
    if file.read_exact(&mut buf).is_err() {
        return respond_text(stream, 500, "Server Error", "");
    }
    let content_type = content_type_for_path(&full);
    let mut headers = vec![("Accept-Ranges", "bytes".to_string())];
    if status.0 == 206 {
        headers.push(("Content-Range", format!("bytes {start}-{end}/{total}")));
    }
    respond_bytes(stream, status.0, status.1, content_type, &buf, &headers)
}

fn handle_web_outfile(stream: &mut TcpStream, req: &WebRequest) -> io::Result<()> {
    let root = match find_repo_root() {
        Some(r) => r,
        None => return respond_text(stream, 404, "Not Found", "Not Found"),
    };
    let rel = req.path.trim_start_matches("/outfiles/");
    let rel = url_decode(rel);
    let rel_path = Path::new(&rel);
    if rel_path.is_absolute() || rel.contains("..") {
        return respond_text(stream, 400, "Bad Request", "Bad Request");
    }
    let full = root.join(rel_path);
    if !full.exists() || !full.is_file() {
        return respond_text(stream, 404, "Not Found", "Not Found");
    }
    let mut file = match fs::File::open(&full) {
        Ok(f) => f,
        Err(_) => return respond_text(stream, 404, "Not Found", "Not Found"),
    };
    let metadata = match file.metadata() {
        Ok(m) => m,
        Err(_) => return respond_text(stream, 404, "Not Found", "Not Found"),
    };
    let total = metadata.len();
    let mut start = 0u64;
    let mut end = total.saturating_sub(1);
    let mut status = (200, "OK");
    if let Some(range) = req.headers.get("range") {
        if let Some(range) = range.strip_prefix("bytes=") {
            let mut parts = range.split('-');
            let start_str = parts.next().unwrap_or("");
            let end_str = parts.next().unwrap_or("");
            if !start_str.is_empty() {
                start = start_str.parse::<u64>().unwrap_or(0);
            }
            if !end_str.is_empty() {
                end = end_str.parse::<u64>().unwrap_or(end);
            }
            if start > end || start >= total {
                return respond_text(stream, 416, "Range Not Satisfiable", "");
            }
            end = end.min(total.saturating_sub(1));
            status = (206, "Partial Content");
        }
    }
    let len = end.saturating_sub(start) + 1;
    if file.seek(SeekFrom::Start(start)).is_err() {
        return respond_text(stream, 500, "Server Error", "");
    }
    let mut buf = vec![0u8; len as usize];
    if file.read_exact(&mut buf).is_err() {
        return respond_text(stream, 500, "Server Error", "");
    }
    let content_type = content_type_for_path(&full);
    let mut headers = vec![("Accept-Ranges", "bytes".to_string())];
    if status.0 == 206 {
        headers.push(("Content-Range", format!("bytes {start}-{end}/{total}")));
    }
    respond_bytes(stream, status.0, status.1, content_type, &buf, &headers)
}

fn handle_web_thumb(stream: &mut TcpStream, req: &WebRequest) -> io::Result<()> {
    let root = match find_repo_root() {
        Some(r) => r,
        None => return respond_text(stream, 404, "Not Found", "Not Found"),
    };
    let rel = req.path.trim_start_matches("/thumbs/");
    let rel = url_decode(rel);
    let rel_path = Path::new(&rel);
    if rel_path.is_absolute() || rel.contains("..") {
        return respond_text(stream, 400, "Bad Request", "Bad Request");
    }
    let full = root.join("src").join(rel_path);
    let Some(thumb_path) = ensure_thumbnail(&root, &full, &rel) else {
        return respond_text(stream, 404, "Not Found", "Not Found");
    };
    serve_thumb_file(stream, &thumb_path)
}

fn handle_web_outthumb(stream: &mut TcpStream, req: &WebRequest) -> io::Result<()> {
    let root = match find_repo_root() {
        Some(r) => r,
        None => return respond_text(stream, 404, "Not Found", "Not Found"),
    };
    let rel = req.path.trim_start_matches("/outthumbs/");
    let rel = url_decode(rel);
    let rel_path = Path::new(&rel);
    if rel_path.is_absolute() || rel.contains("..") {
        return respond_text(stream, 400, "Bad Request", "Bad Request");
    }
    let full = root.join(rel_path);
    let Some(thumb_path) = ensure_thumbnail(&root, &full, &rel) else {
        return respond_text(stream, 404, "Not Found", "Not Found");
    };
    serve_thumb_file(stream, &thumb_path)
}

fn serve_thumb_file(stream: &mut TcpStream, thumb_path: &Path) -> io::Result<()> {
    let mut file = match fs::File::open(thumb_path) {
        Ok(f) => f,
        Err(_) => return respond_text(stream, 404, "Not Found", "Not Found"),
    };
    let mut buf = Vec::new();
    if file.read_to_end(&mut buf).is_err() {
        return respond_text(stream, 500, "Server Error", "");
    }
    respond_bytes(stream, 200, "OK", "image/jpeg", &buf, &[])
}

fn parse_urlencoded(body: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for pair in body.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (k, v) = match pair.split_once('=') {
            Some(v) => v,
            None => (pair, ""),
        };
        let key = url_decode(k);
        let val = url_decode(v);
        out.insert(key, val);
    }
    out
}

fn url_decode(raw: &str) -> String {
    let mut out = String::new();
    let mut chars = raw.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '+' => out.push(' '),
            '%' => {
                let hi = chars.next();
                let lo = chars.next();
                if let (Some(hi), Some(lo)) = (hi, lo) {
                    let hex = format!("{hi}{lo}");
                    if let Ok(v) = u8::from_str_radix(&hex, 16) {
                        out.push(v as char);
                    }
                }
            }
            _ => out.push(c),
        }
    }
    out
}

fn url_encode(raw: &str) -> String {
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

fn ensure_thumbnail(root: &Path, input: &Path, rel: &str) -> Option<PathBuf> {
    if !input.exists() || !input.is_file() || !is_video_file(input) {
        return None;
    }
    let mtime = input
        .metadata()
        .and_then(|m| m.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH)
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let thumb_path = thumb_cache_path(root, rel, mtime);
    if thumb_path.exists() {
        return Some(thumb_path);
    }
    if let Some(parent) = thumb_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if generate_thumbnail(input, &thumb_path, root) {
        Some(thumb_path)
    } else {
        None
    }
}

fn thumb_cache_path(root: &Path, rel: &str, mtime: u64) -> PathBuf {
    let mut hasher = DefaultHasher::new();
    rel.hash(&mut hasher);
    mtime.hash(&mut hasher);
    let hash = hasher.finish();
    root.join("outputs")
        .join("tui-thumbs")
        .join(format!("{hash:x}.jpg"))
}

fn generate_thumbnail(input: &Path, output: &Path, root: &Path) -> bool {
    let duration = get_video_duration(input, root).unwrap_or(0.0);
    let mid = if duration > 0.0 { duration / 2.0 } else { 0.0 };
    let mid_str = format!("{mid:.3}");
    let out = Command::new("ffmpeg")
        .args(["-ss", &mid_str, "-i"])
        .arg(input)
        .args(["-frames:v", "1", "-q:v", "4", "-vf", "scale=320:-1", "-y"])
        .arg(output)
        .current_dir(root)
        .output();
    match out {
        Ok(o) if o.status.success() => true,
        _ => false,
    }
}

fn content_type_for_path(path: &Path) -> &'static str {
    match path.extension().and_then(|s| s.to_str()) {
        Some(ext) => match ext.to_lowercase().as_str() {
            "mp4" => "video/mp4",
            "mov" => "video/quicktime",
            "webm" => "video/webm",
            "mkv" => "video/x-matroska",
            "avi" => "video/x-msvideo",
            "m4v" => "video/mp4",
            "jpg" | "jpeg" => "image/jpeg",
            "png" => "image/png",
            "webp" => "image/webp",
            "gif" => "image/gif",
            _ => "application/octet-stream",
        },
        None => "application/octet-stream",
    }
}

fn run_timestamp_id() -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("run_{ts}")
}

fn html_escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[allow(dead_code)]
fn web_index_html(root: Option<&Path>) -> String {
    let folders = root
        .map(|r| collect_src_folder_entries(r, true))
        .unwrap_or_default();
    let videos = root.map(collect_src_videos).unwrap_or_default();

    let mut folder_rows = String::new();
    for (label, value) in folders {
        let depth = value.split('/').count().saturating_sub(1);
        let indent = depth * 12;
        folder_rows.push_str(&format!(
            "<label class=\"folder-item\" style=\"margin-left:{}px\"><input type=\"checkbox\" name=\"folder_pick\" value=\"{}\"/> <span>{}</span></label>",
            indent,
            html_escape(&value),
            html_escape(&label)
        ));
    }
    if folder_rows.is_empty() {
        folder_rows
            .push_str("<div class=\"hint\">No folders found in src/. Use custom input.</div>");
    }

    let mut video_cards = String::new();
    for (folder, name, rel) in videos {
        let folder_label = if folder.is_empty() { "(root)" } else { &folder };
        let src = url_encode(&rel);
        video_cards.push_str(&format!(
            "<div class=\"video-card\" data-folder=\"{}\">\n  <div class=\"thumb\">\n    <video src=\"/files/{}\" muted preload=\"metadata\" playsinline></video>\n  </div>\n  <div class=\"meta\">\n    <div class=\"title\">{}</div>\n    <div class=\"sub\">{}</div>\n  </div>\n</div>",
            html_escape(&folder),
            src,
            html_escape(&name),
            html_escape(folder_label)
        ));
    }
    if video_cards.is_empty() {
        video_cards.push_str(
            "<div class=\"hint\">No videos found in src/. Add videos to src/ to see thumbnails.</div>",
        );
    }

    let body = format!(
        r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>tiles studio</title>
  <style>
    :root{{--bg:#0d1117;--panel:#121826;--muted:#9aa4b2;--line:#263043;--accent:#22c55e;--accent-2:#38bdf8;--warn:#f59e0b}}
    body{{font-family:"IBM Plex Sans",system-ui,-apple-system,Segoe UI,Arial,sans-serif;background:radial-gradient(1200px 600px at 10% -10%,#1b2332 0%,#0d1117 60%);color:#e5e7eb;margin:0}}
    .app{{display:grid;grid-template-columns:280px 1fr 320px;min-height:100vh}}
    header{{grid-column:1/4;padding:16px 24px;border-bottom:1px solid var(--line);background:#0c111b;position:sticky;top:0;z-index:5}}
    header h1{{margin:0;font-size:20px;letter-spacing:.3px}}
    header p{{margin:6px 0 0;color:var(--muted);font-size:13px}}
    aside{{padding:16px 14px;border-right:1px solid var(--line);background:#0b0f18}}
    .inspector{{border-left:1px solid var(--line);background:#0f1522}}
    main{{padding:16px 18px}}
    h2{{margin:0 0 10px;font-size:15px;color:#f8fafc}}
    .section{{margin-bottom:18px}}
    .hint{{opacity:.7;font-size:12px;color:var(--muted)}}
    .folder-list{{max-height:360px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:10px;background:#0b0f18}}
    .folder-item{{display:flex;gap:8px;align-items:center;margin:6px 0;font-size:13px}}
    .folder-item input{{width:auto}}
    .toolbar{{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:12px}}
    .pill{{display:inline-block;padding:2px 8px;border-radius:999px;background:#101826;color:#9ef7c6;font-size:12px;border:1px solid #1e3b2b}}
    .search{{flex:1;min-width:200px}}
    input,select,textarea{{width:100%;padding:8px;border-radius:10px;border:1px solid var(--line);background:#0c111b;color:#e5e7eb}}
    textarea{{min-height:60px}}
    .video-grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}}
    .video-card{{background:#0c111b;border:1px solid var(--line);border-radius:12px;overflow:hidden}}
    .thumb{{background:#070a12;aspect-ratio:16/9;display:flex;align-items:center;justify-content:center}}
    .thumb-img{{width:100%;height:100%;object-fit:cover;display:block}}
    .meta-video{{display:none}}
    .meta{{padding:8px}}
    .meta .title{{font-size:12px;color:#f8fafc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
    .meta .sub{{font-size:11px;color:var(--muted)}}
    .btn{{padding:10px 12px;border:0;border-radius:10px;background:var(--accent);color:#0b111a;font-weight:700;cursor:pointer}}
    .btn.secondary{{background:#1f2937;color:#e5e7eb}}
    .row{{display:flex;gap:10px}}
    .row>div{{flex:1}}
    .output-choices{{display:grid;gap:10px}}
    .choice{{display:flex;gap:10px;align-items:flex-start;padding:10px;border:1px solid var(--line);border-radius:12px;background:#0c111b;cursor:pointer}}
    .choice input{{margin-top:3px}}
    .choice .title{{font-size:13px;font-weight:700;color:#f8fafc}}
    .choice .desc{{font-size:12px;color:var(--muted)}}
    .choice.disabled{{opacity:.5;pointer-events:none}}
    .choice.danger{{border-color:#3a1b1b;background:#120b0b}}
    .choice.danger .title{{color:#fecaca}}
    .callout{{padding:10px;border:1px solid #2b3b22;border-radius:10px;background:#101a13;color:#b7f7d0;font-size:12px}}
  </style>
</head>
<body>
  <header>
    <h1>tiles studio</h1>
    <p>Manage all videos in <strong>src/</strong>. Pick folders on the left, preview clips in the middle, and run actions on the right.</p>
  </header>
  <form method="POST" action="/run" class="app">
    <aside>
      <h2>Folders</h2>
      <div class="section">
        <input class="search" id="folder-search" placeholder="Filter folders" />
      </div>
      <div class="folder-list" id="folder-list">{folder_rows}</div>
      <div class="section">
        <button type="button" class="btn secondary" id="select-all">Select all</button>
        <button type="button" class="btn secondary" id="clear-all">Clear</button>
        <div class="hint" style="margin-top:8px;">Selected folders drive the preview grid and commands.</div>
      </div>
      <input type="hidden" name="folders" value="" />
    </aside>
    <main>
      <div class="toolbar">
        <input id="video-search" class="search" placeholder="Search videos" />
        <span class="pill" id="video-count">0 videos</span>
      </div>
      <div class="video-grid" id="video-grid">
        {video_cards}
      </div>
    </main>
    <aside class="inspector">
      <div class="section">
        <h2>Action</h2>
        <div class="hint">Choose what to do with the selected folders.</div>
        <select name="cmd" id="cmd">
          <option value="concat">Concatenate clips</option>
          <option value="trim">Trim clip heads/tails</option>
          <option value="detect">Detect scenes</option>
        </select>
      </div>

      <div class="section">
        <h2>Output</h2>
        <div class="hint">Default writes to a subfolder next to your source clips.</div>
        <div class="row">
          <div>
            <label><input type="radio" name="output_mode" value="source" checked /> Source folder outputs</label>
          </div>
          <div>
            <label><input type="radio" name="output_mode" value="custom" /> Custom output folder</label>
          </div>
        </div>
        <label>Source output subdir</label>
        <input name="source_subdir" value="outputs" />
        <label>Custom output dir</label>
        <input name="custom_output" placeholder="outputs/concatenated" />
      </div>

      <div class="section">
        <h2>Concat</h2>
        <div class="hint">Combine all clips in each folder into one video.</div>
        <div class="row">
          <div>
            <label>Transition</label>
            <select name="transition">
              <option value="cut">Cut (no fade)</option>
              <option value="fade">Fade</option>
              <option value="fadeblack">Fade to black</option>
            </select>
          </div>
          <div>
            <label>Transition duration</label>
            <input name="duration" value="1.0" />
          </div>
        </div>
      </div>

      <div class="section">
        <h2>Trim</h2>
        <div class="hint">Remove time from the start and end of every clip.</div>
        <div class="row">
          <div>
            <label>Trim start (seconds)</label>
            <input name="trim_start" value="0" />
          </div>
          <div>
            <label>Trim end (seconds)</label>
            <input name="trim_end" value="0" />
          </div>
        </div>
      </div>

      <div class="section">
        <h2>Detect</h2>
        <div class="hint">Find scene changes and optionally split into clips.</div>
        <div class="row">
          <div>
            <label>Threshold</label>
            <input name="threshold" value="0.27" />
          </div>
          <div>
            <label>Method</label>
            <select name="method">
              <option value="content">Content</option>
              <option value="adaptive">Adaptive</option>
            </select>
          </div>
        </div>
        <label><input type="checkbox" name="list_only" /> List only (do not split)</label>
      </div>

      <div class="section">
        <div class="callout">Tip: pick folders on the left, then hit Run. No typing required.</div>
        <button class="btn" type="submit">Run</button>
      </div>
    </aside>
  </form>
  <div id="player-modal" class="modal" role="dialog" aria-modal="true">
    <div class="modal-card">
      <div class="modal-header">
        <h3 id="player-title">Preview</h3>
        <button type="button" id="player-close">Close</button>
      </div>
      <div class="modal-body">
        <video id="player-video" controls playsinline></video>
      </div>
    </div>
  </div>
  <script>
    const folderChecks = Array.from(document.querySelectorAll('input[name="folder_pick"]'));
    const foldersField = document.querySelector('input[name="folders"]');
    const folderSearch = document.getElementById('folder-search');
    const videoSearch = document.getElementById('video-search');
    const videoGrid = document.getElementById('video-grid');
    const videoCount = document.getElementById('video-count');

    function selectedFolders() {{
      return folderChecks.filter(c => c.checked).map(c => c.value);
    }}

    function syncFolders() {{
      const values = selectedFolders();
      foldersField.value = values.join(',');
      filterVideos();
    }}

    function updateActionContext(selectedCount) {{
      const contextMode = document.getElementById('context-mode');
      const contextNote = document.getElementById('context-note');
      const cmd = document.getElementById('cmd');
      const concatWarning = document.getElementById('concat-warning');
      if (!contextMode || !contextNote || !cmd || !concatWarning) return;
      const inClipMode = selectedCount > 0;
      contextMode.textContent = inClipMode ? 'Clip mode' : 'Folders mode';
      contextNote.textContent = inClipMode
        ? 'Actions apply to the selected clips only.'
        : 'Select one clip for a single run, or multiple for batch.';
      const concatOption = Array.from(cmd.options).find(o => o.value === 'concat');
      if (concatOption) concatOption.disabled = inClipMode;
      concatWarning.style.display = inClipMode ? 'block' : 'none';
      if (inClipMode && cmd.value === 'concat') {{
        cmd.value = 'trim';
      }}
    }}

    function syncVideos() {{
      const selected = videoSelects.filter(c => c.checked).map(c => c.dataset.rel || '');
      const cleaned = selected.filter(Boolean);
      videosField.value = cleaned.join(',');
      videoSelected.textContent = `${{cleaned.length}} selected`;
      videoSelects.forEach(c => {{
        const card = c.closest('.video-card');
        if (card) card.classList.toggle('selected', c.checked);
      }});
      updateActionContext(cleaned.length);
    }}

    function openModal(card) {{
      if (!modal || !modalVideo || !modalTitle) return;
      const title = card.querySelector('.title');
      const src = card.getAttribute('data-src');
      if (!src) return;
      modalVideo.src = src;
      modalTitle.textContent = title ? title.textContent : 'Preview';
      modal.classList.add('active');
      modalVideo.play().catch(() => {{}});
    }}

    function closeModal() {{
      if (!modal || !modalVideo) return;
      modal.classList.remove('active');
      modalVideo.pause();
      modalVideo.removeAttribute('src');
      modalVideo.load();
    }}

    function updateActionContext(selectedCount) {{
      const contextMode = document.getElementById('context-mode');
      const contextNote = document.getElementById('context-note');
      const cmd = document.getElementById('cmd');
      const concatWarning = document.getElementById('concat-warning');
      if (!contextMode || !contextNote || !cmd || !concatWarning) return;
      const inClipMode = selectedCount > 0;
      contextMode.textContent = inClipMode ? 'Clip mode' : 'Folders mode';
      contextNote.textContent = inClipMode
        ? 'Actions apply to the selected clips only.'
        : 'Select one clip for a single run, or multiple for batch.';
      const concatOption = Array.from(cmd.options).find(o => o.value === 'concat');
      if (concatOption) concatOption.disabled = inClipMode;
      concatWarning.style.display = inClipMode ? 'block' : 'none';
      if (inClipMode && cmd.value === 'concat') {{
        cmd.value = 'trim';
      }}
    }}

    function syncVideos() {{
      const selected = videoSelects.filter(c => c.checked).map(c => c.dataset.rel || '');
      const cleaned = selected.filter(Boolean);
      videosField.value = cleaned.join(',');
      videoSelected.textContent = `${{cleaned.length}} selected`;
      videoSelects.forEach(c => {{
        const card = c.closest('.video-card');
        if (card) card.classList.toggle('selected', c.checked);
      }});
      updateActionContext(cleaned.length);
    }}

    function openModal(card) {{
      if (!modal || !modalVideo || !modalTitle) return;
      const video = card.querySelector('video');
      const title = card.querySelector('.title');
      if (!video) return;
      modalVideo.src = video.getAttribute('src') || '';
      modalTitle.textContent = title ? title.textContent : 'Preview';
      modal.classList.add('active');
      modalVideo.play().catch(() => {{}});
    }}

    function closeModal() {{
      if (!modal || !modalVideo) return;
      modal.classList.remove('active');
      modalVideo.pause();
      modalVideo.removeAttribute('src');
      modalVideo.load();
    }}

    function updateActionContext(selectedCount) {{
      const contextMode = document.getElementById('context-mode');
      const contextNote = document.getElementById('context-note');
      const cmd = document.getElementById('cmd');
      const concatWarning = document.getElementById('concat-warning');
      if (!contextMode || !contextNote || !cmd || !concatWarning) return;
      const inClipMode = selectedCount > 0;
      contextMode.textContent = inClipMode ? 'Clip mode' : 'Folders mode';
      contextNote.textContent = inClipMode
        ? 'Actions apply to selected clips only.'
        : 'Select clips to switch to clip mode.';
      const concatOption = Array.from(cmd.options).find(o => o.value === 'concat');
      if (concatOption) concatOption.disabled = inClipMode;
      concatWarning.style.display = inClipMode ? 'block' : 'none';
      if (inClipMode && cmd.value === 'concat') {{
        cmd.value = 'trim';
      }}
    }}

    function syncVideos() {{
      const selected = videoSelects.filter(c => c.checked).map(c => c.dataset.rel || '');
      const cleaned = selected.filter(Boolean);
      videosField.value = cleaned.join(',');
      videoSelected.textContent = `${{cleaned.length}} selected`;
      videoSelects.forEach(c => {{
        const card = c.closest('.video-card');
        if (card) card.classList.toggle('selected', c.checked);
      }});
      updateActionContext(cleaned.length);
    }}

    function openModal(card) {{
      if (!modal || !modalVideo || !modalTitle) return;
      const video = card.querySelector('video');
      const title = card.querySelector('.title');
      if (!video) return;
      modalVideo.src = video.getAttribute('src') || '';
      modalTitle.textContent = title ? title.textContent : 'Preview';
      modal.classList.add('active');
      modalVideo.play().catch(() => {{}});
    }}

    function closeModal() {{
      if (!modal || !modalVideo) return;
      modal.classList.remove('active');
      modalVideo.pause();
      modalVideo.removeAttribute('src');
      modalVideo.load();
    }}

    function updateActionContext(selectedCount) {{
      const contextMode = document.getElementById('context-mode');
      const contextNote = document.getElementById('context-note');
      const cmd = document.getElementById('cmd');
      const concatWarning = document.getElementById('concat-warning');
      if (!contextMode || !contextNote || !cmd || !concatWarning) return;
      const inClipMode = selectedCount > 0;
      contextMode.textContent = inClipMode ? 'Clip mode' : 'Folders mode';
      contextNote.textContent = inClipMode
        ? 'Actions apply to selected clips only.'
        : 'Select clips to switch to clip mode.';
      const concatOption = Array.from(cmd.options).find(o => o.value === 'concat');
      if (concatOption) concatOption.disabled = inClipMode;
      concatWarning.style.display = inClipMode ? 'block' : 'none';
      if (inClipMode && cmd.value === 'concat') {{
        cmd.value = 'trim';
      }}
    }}

    function syncVideos() {{
      const selected = videoSelects.filter(c => c.checked).map(c => c.dataset.rel || '');
      const cleaned = selected.filter(Boolean);
      videosField.value = cleaned.join(',');
      videoSelected.textContent = `${{cleaned.length}} selected`;
      videoSelects.forEach(c => {{
        const card = c.closest('.video-card');
        if (card) card.classList.toggle('selected', c.checked);
      }});
      updateActionContext(cleaned.length);
    }}

    function openModal(card) {{
      if (!modal || !modalVideo || !modalTitle) return;
      const video = card.querySelector('video');
      const title = card.querySelector('.title');
      if (!video) return;
      modalVideo.src = video.getAttribute('src') || '';
      modalTitle.textContent = title ? title.textContent : 'Preview';
      modal.classList.add('active');
      modalVideo.play().catch(() => {{}});
    }}

    function closeModal() {{
      if (!modal || !modalVideo) return;
      modal.classList.remove('active');
      modalVideo.pause();
      modalVideo.removeAttribute('src');
      modalVideo.load();
    }}

    function updateActionContext(selectedCount) {{
      const contextMode = document.getElementById('context-mode');
      const contextNote = document.getElementById('context-note');
      const cmd = document.getElementById('cmd');
      const concatWarning = document.getElementById('concat-warning');
      if (!contextMode || !contextNote || !cmd || !concatWarning) return;
      const inClipMode = selectedCount > 0;
      contextMode.textContent = inClipMode ? 'Clip mode' : 'Folders mode';
      contextNote.textContent = inClipMode
        ? 'Actions apply to selected clips only.'
        : 'Select clips to switch to clip mode.';
      const concatOption = Array.from(cmd.options).find(o => o.value === 'concat');
      if (concatOption) concatOption.disabled = inClipMode;
      concatWarning.style.display = inClipMode ? 'block' : 'none';
      if (inClipMode && cmd.value === 'concat') {{
        cmd.value = 'trim';
      }}
    }}

    function syncVideos() {{
      const selected = videoSelects.filter(c => c.checked).map(c => c.dataset.rel || '');
      const cleaned = selected.filter(Boolean);
      videosField.value = cleaned.join(',');
      videoSelected.textContent = `${{cleaned.length}} selected`;
      videoSelects.forEach(c => {{
        const card = c.closest('.video-card');
        if (card) card.classList.toggle('selected', c.checked);
      }});
      updateActionContext(cleaned.length);
    }}

    function openModal(card) {{
      if (!modal || !modalVideo || !modalTitle) return;
      const video = card.querySelector('video');
      const title = card.querySelector('.title');
      if (!video) return;
      modalVideo.src = video.getAttribute('src') || '';
      modalTitle.textContent = title ? title.textContent : 'Preview';
      modal.classList.add('active');
      modalVideo.play().catch(() => {{}});
    }}

    function closeModal() {{
      if (!modal || !modalVideo) return;
      modal.classList.remove('active');
      modalVideo.pause();
      modalVideo.removeAttribute('src');
      modalVideo.load();
    }}

    function updateActionContext(selectedCount) {{
      const contextMode = document.getElementById('context-mode');
      const contextNote = document.getElementById('context-note');
      const cmd = document.getElementById('cmd');
      const concatWarning = document.getElementById('concat-warning');
      if (!contextMode || !contextNote || !cmd || !concatWarning) return;
      const inClipMode = selectedCount > 0;
      contextMode.textContent = inClipMode ? 'Clip mode' : 'Folders mode';
      contextNote.textContent = inClipMode
        ? 'Actions apply to selected clips only.'
        : 'Select clips to switch to clip mode.';
      const concatOption = Array.from(cmd.options).find(o => o.value === 'concat');
      if (concatOption) concatOption.disabled = inClipMode;
      concatWarning.style.display = inClipMode ? 'block' : 'none';
      if (inClipMode && cmd.value === 'concat') {{
        cmd.value = 'trim';
      }}
    }}

    function syncVideos() {{
      const selected = videoSelects.filter(c => c.checked).map(c => c.dataset.rel || '');
      const cleaned = selected.filter(Boolean);
      videosField.value = cleaned.join(',');
      videoSelected.textContent = `${{cleaned.length}} selected`;
      videoSelects.forEach(c => {{
        const card = c.closest('.video-card');
        if (card) card.classList.toggle('selected', c.checked);
      }});
      updateActionContext(cleaned.length);
    }}

    function openModal(card) {{
      if (!modal || !modalVideo || !modalTitle) return;
      const video = card.querySelector('video');
      const title = card.querySelector('.title');
      if (!video) return;
      modalVideo.src = video.getAttribute('src') || '';
      modalTitle.textContent = title ? title.textContent : 'Preview';
      modal.classList.add('active');
      modalVideo.play().catch(() => {{}});
    }}

    function closeModal() {{
      if (!modal || !modalVideo) return;
      modal.classList.remove('active');
      modalVideo.pause();
      modalVideo.removeAttribute('src');
      modalVideo.load();
    }}

    function syncVideos() {{
      const selected = videoSelects.filter(c => c.checked).map(c => c.dataset.rel || '');
      const cleaned = selected.filter(Boolean);
      videosField.value = cleaned.join(',');
      videoSelected.textContent = `${{cleaned.length}} selected`;
      videoSelects.forEach(c => {{
        const card = c.closest('.video-card');
        if (card) card.classList.toggle('selected', c.checked);
      }});
      updateActionContext(cleaned.length);
    }}

    function filterFolders() {{
      const q = (folderSearch.value || '').toLowerCase();
      folderChecks.forEach(c => {{
        const label = c.parentElement.textContent.toLowerCase();
        c.parentElement.style.display = label.includes(q) ? 'flex' : 'none';
      }});
    }}

    function filterVideos() {{
      const folders = selectedFolders();
      const q = (videoSearch.value || '').toLowerCase();
      let count = 0;
      Array.from(videoGrid.children).forEach(card => {{
        const folder = card.getAttribute('data-folder') || '';
        const text = card.textContent.toLowerCase();
        const folderMatch = folders.length === 0 ? true : folders.includes(folder);
        const textMatch = text.includes(q);
        const show = folderMatch && textMatch;
        card.style.display = show ? 'block' : 'none';
        if (show) count += 1;
      }});
      videoCount.textContent = `${{count}} videos`;
    }}

    function openModal(card) {{
      const video = card.querySelector('video');
      const title = card.querySelector('.title');
      if (!video) return;
      modalVideo.src = video.getAttribute('src') || '';
      modalTitle.textContent = title ? title.textContent : 'Preview';
      modal.classList.add('active');
      modalVideo.play().catch(() => {{}});
    }}

    function closeModal() {{
      modal.classList.remove('active');
      modalVideo.pause();
      modalVideo.removeAttribute('src');
      modalVideo.load();
    }}

    function updateActionContext(selectedCount) {{
      const contextMode = document.getElementById('context-mode');
      const contextNote = document.getElementById('context-note');
      const cmd = document.getElementById('cmd');
      const concatWarning = document.getElementById('concat-warning');
      const inClipMode = selectedCount > 0;
      contextMode.textContent = inClipMode ? 'Clip mode' : 'Folders mode';
      contextNote.textContent = inClipMode
        ? 'Actions apply to selected clips only.'
        : 'Select clips to switch to clip mode.';
      const concatOption = Array.from(cmd.options).find(o => o.value === 'concat');
      if (concatOption) concatOption.disabled = inClipMode;
      concatWarning.style.display = inClipMode ? 'block' : 'none';
      if (inClipMode && cmd.value === 'concat') {{
        cmd.value = 'trim';
      }}
    }}

    document.getElementById('select-all').addEventListener('click', () => {{
      folderChecks.forEach(c => c.checked = true);
      syncFolders();
    }});
    document.getElementById('clear-all').addEventListener('click', () => {{
      folderChecks.forEach(c => c.checked = false);
      syncFolders();
    }});
    folderChecks.forEach(c => c.addEventListener('change', syncFolders));
    videoSelects.forEach(c => c.addEventListener('change', syncVideos));
    folderSearch.addEventListener('input', filterFolders);
    videoSearch.addEventListener('input', filterVideos);

    syncFolders();
  </script>
</body>
</html>"#,
        folder_rows = folder_rows,
        video_cards = video_cards
    );
    body
}

#[allow(dead_code)]
fn web_index_html_studio(root: Option<&Path>) -> String {
    let folders = root
        .map(|r| collect_src_folder_entries(r, true))
        .unwrap_or_default();
    let videos = root.map(collect_src_videos).unwrap_or_default();
    let output_runs = root.map(collect_output_runs).unwrap_or_default();

    let mut folder_rows = String::new();
    for (label, value) in folders {
        let depth = value.split('/').count().saturating_sub(1);
        let indent = depth * 12;
        folder_rows.push_str(&format!(
            "<label class=\"folder-item\" style=\"margin-left:{}px\"><input type=\"checkbox\" name=\"folder_pick\" value=\"{}\"/> <span>{}</span></label>",
            indent,
            html_escape(&value),
            html_escape(&label)
        ));
    }
    if folder_rows.is_empty() {
        folder_rows
            .push_str("<div class=\"hint\">No folders found in src/. Use custom input.</div>");
    }

    let mut video_cards = String::new();
    for (folder, name, rel) in videos {
        let folder_label = if folder.is_empty() { "(root)" } else { &folder };
        let src = url_encode(&rel);
        let thumb = format!("/thumbs/{src}");
        video_cards.push_str(&format!(
            "<div class=\"video-card\" data-folder=\"{}\" data-rel=\"{}\" data-src=\"/files/{}\">\n  <div class=\"thumb\">\n    <div class=\"thumb-spinner\" aria-hidden=\"true\"></div>\n    <img class=\"thumb-img\" src=\"{}\" alt=\"\" loading=\"lazy\" />\n    <video class=\"meta-video\" src=\"/files/{}\" muted preload=\"metadata\" playsinline></video>\n    <button type=\"button\" class=\"play-btn\">Play</button>\n    <div class=\"duration\">--:--</div>\n  </div>\n  <div class=\"meta\">\n    <div class=\"title\">{}</div>\n    <div class=\"sub\">{}</div>\n  </div>\n  <label class=\"select-flag\"><input type=\"checkbox\" class=\"video-select\" data-rel=\"{}\"/> Select</label>\n</div>",
            html_escape(&folder),
            html_escape(&rel),
            src,
            thumb,
            src,
            html_escape(&name),
            html_escape(folder_label),
            html_escape(&rel)
        ));
    }
    if video_cards.is_empty() {
        video_cards.push_str(
            "<div class=\"hint\">No videos found in src/. Add videos to src/ to see thumbnails.</div>",
        );
    }

    let mut output_rows = String::new();
    let mut grouped: HashMap<(String, String), Vec<OutputRun>> = HashMap::new();
    for run in output_runs {
        grouped
            .entry((run.project.clone(), run.tool.clone()))
            .or_default()
            .push(run);
    }
    let mut groups = grouped
        .into_iter()
        .map(|(key, mut runs)| {
            runs.sort_by(|a, b| b.modified.cmp(&a.modified));
            let latest = runs
                .first()
                .map(|r| r.modified)
                .unwrap_or(SystemTime::UNIX_EPOCH);
            (key, runs, latest)
        })
        .collect::<Vec<_>>();
    groups.sort_by(|a, b| b.2.cmp(&a.2));

    for ((folder, tool), runs, _) in groups {
        let count = runs.len();
        output_rows.push_str(&format!(
            "<details class=\"output-group\" open><summary><span class=\"group-title\">{}</span><span class=\"group-sub\">{}</span></summary>",
            html_escape(&format!("{folder}/{tool}")),
            html_escape(&format!("{count} runs"))
        ));
        for run in runs {
            let sample = run.sample_url.as_ref().cloned().unwrap_or_default();
            let thumb = if sample.is_empty() {
                "<div class=\"output-thumb empty\">No preview</div>".to_string()
            } else {
                format!(
                        "<div class=\"output-thumb\"><video src=\"{}\" muted preload=\"metadata\" playsinline></video></div>",
                        sample
                    )
            };
            let sample_link = if sample.is_empty() {
                "".to_string()
            } else {
                format!("<a href=\"{}\" target=\"_blank\">Preview</a>", sample)
            };
            output_rows.push_str(&format!(
                    "<div class=\"output-row\">\n  {thumb}\n  <div class=\"output-main\">\n    <div class=\"output-title\">{}</div>\n    <div class=\"output-sub\">{}</div>\n  </div>\n  <div class=\"output-actions\">{}<button type=\"button\" data-copy=\"{}\">Copy path</button></div>\n</div>",
                    html_escape(&run.run_id),
                    html_escape(&run.run_rel),
                    sample_link,
                    html_escape(&run.run_rel)
                ));
        }
        output_rows.push_str("</details>");
    }
    if output_rows.is_empty() {
        output_rows.push_str(
            "<div class=\"hint\">No outputs found yet. Run a tool to generate outputs.</div>",
        );
    }

    let body = format!(
        r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>tiles studio</title>
  <style>
    :root{{--bg:#0d1117;--panel:#121826;--muted:#9aa4b2;--line:#263043;--accent:#22c55e;--accent-2:#38bdf8}}
    body{{font-family:"IBM Plex Sans",system-ui,-apple-system,Segoe UI,Arial,sans-serif;background:radial-gradient(1200px 600px at 10% -10%,#1b2332 0%,#0d1117 60%);color:#e5e7eb;margin:0}}
    .app{{display:grid;grid-template-columns:280px 1fr 320px;min-height:100vh}}
    header{{grid-column:1/4;padding:16px 24px;border-bottom:1px solid var(--line);background:#0c111b;position:sticky;top:0;z-index:5}}
    header h1{{margin:0;font-size:20px;letter-spacing:.3px}}
    header p{{margin:6px 0 0;color:var(--muted);font-size:13px}}
    nav{{display:flex;gap:12px;margin-top:10px;flex-wrap:wrap}}
    nav button{{padding:6px 10px;border-radius:999px;border:1px solid var(--line);background:#0b0f18;color:#e5e7eb;cursor:pointer}}
    nav button.active{{background:var(--accent);color:#0b111a;border-color:transparent}}
    aside{{padding:16px 14px;border-right:1px solid var(--line);background:#0b0f18}}
    .inspector{{border-left:1px solid var(--line);background:#0f1522}}
    main{{padding:16px 18px}}
    h2{{margin:0 0 10px;font-size:15px;color:#f8fafc}}
    .section{{margin-bottom:18px}}
    .hint{{opacity:.7;font-size:12px;color:var(--muted)}}
    .folder-list{{max-height:360px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:10px;background:#0b0f18}}
    .folder-item{{display:flex;gap:8px;align-items:center;margin:6px 0;font-size:13px}}
    .folder-item input{{width:auto}}
    .toolbar{{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:12px}}
    .pill{{display:inline-block;padding:2px 8px;border-radius:999px;background:#101826;color:#9ef7c6;font-size:12px;border:1px solid #1e3b2b}}
    .search{{flex:1;min-width:200px}}
    input,select,textarea{{width:100%;padding:8px;border-radius:10px;border:1px solid var(--line);background:#0c111b;color:#e5e7eb}}
    textarea{{min-height:60px}}
    .video-grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}}
    .video-card{{background:#0c111b;border:1px solid var(--line);border-radius:12px;overflow:hidden;position:relative;transition:border-color .2s,box-shadow .2s}}
    .video-card.selected{{border-color:var(--accent);box-shadow:0 0 0 1px rgba(34,197,94,.4)}}
    .thumb{{background:#070a12;aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;position:relative}}
    .thumb video{{width:100%;height:100%;object-fit:cover}}
    .play-btn{{position:absolute;left:8px;bottom:6px;padding:4px 8px;border-radius:6px;border:0;background:rgba(0,0,0,.6);color:#e5e7eb;font-size:11px;cursor:pointer;z-index:2}}
    .duration{{position:absolute;bottom:6px;right:6px;background:rgba(0,0,0,.6);padding:2px 6px;border-radius:6px;font-size:11px}}
    .select-flag{{position:absolute;top:8px;left:8px;background:rgba(12,17,27,.8);padding:3px 6px;border-radius:8px;font-size:11px;display:flex;gap:6px;align-items:center;z-index:2}}
    .select-flag input{{width:auto}}
    .meta{{padding:8px}}
    .meta .title{{font-size:12px;color:#f8fafc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
    .meta .sub{{font-size:11px;color:var(--muted)}}
    .btn{{padding:10px 12px;border:0;border-radius:10px;background:var(--accent);color:#0b111a;font-weight:700;cursor:pointer}}
    .btn.secondary{{background:#1f2937;color:#e5e7eb}}
    .row{{display:flex;gap:10px}}
    .row>div{{flex:1}}
    .callout{{padding:10px;border:1px solid #2b3b22;border-radius:10px;background:#101a13;color:#b7f7d0;font-size:12px}}
    .output-list{{display:flex;flex-direction:column;gap:12px}}
    .outputs-hero{{background:#0a0f1b;border:1px solid #243045;border-radius:16px;padding:16px;margin-bottom:16px}}
    .project-nav{{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}}
    .project-chip{{padding:6px 10px;border-radius:999px;border:1px solid var(--line);background:#0b0f18;color:#e5e7eb;text-decoration:none;font-size:12px}}
    .project-chip:hover{{border-color:var(--accent-2);color:#e2f4ff}}
    .output-project{{border:1px solid #232f44;border-radius:18px;background:linear-gradient(180deg,#0b0f18 0%,#0a0e17 100%);padding:14px;margin-bottom:16px}}
    .project-header{{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}}
    .project-title{{font-size:16px;color:#f8fafc}}
    .project-sub{{font-size:12px;color:var(--muted)}}
    .project-count{{font-size:12px;color:#9ef7c6;border:1px solid #1f3b2c;border-radius:999px;padding:4px 8px;background:#0c1712}}
    .output-tool{{border:1px solid var(--line);border-radius:14px;background:#0b0f18;padding:10px;margin-bottom:12px}}
    .output-tool-header{{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}}
    .tool-title{{font-size:13px;color:#f8fafc}}
    .tool-sub{{font-size:12px;color:var(--muted)}}
    .output-run-grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}}
    .output-run{{border:1px solid #202b3f;border-radius:12px;background:#0c111b;overflow:hidden;display:flex;flex-direction:column}}
    .output-run .output-thumb{{width:100%;aspect-ratio:16/9;border-radius:0}}
    .output-meta{{padding:10px}}
    .output-actions{{display:flex;gap:8px;align-items:center;padding:0 10px 10px}}
    .output-actions button{{padding:6px 8px;border-radius:8px;border:1px solid var(--line);background:#0c111b;color:#e5e7eb;cursor:pointer}}
    .output-actions a{{color:var(--accent-2);text-decoration:none;font-size:12px}}
    .group-title{{font-size:13px;color:#f8fafc}}
    .group-sub{{font-size:12px;color:var(--muted)}}
    .output-row{{display:grid;grid-template-columns:120px 1fr auto;gap:12px;align-items:center;padding:10px;border-top:1px solid var(--line)}}
    .output-thumb{{width:120px;aspect-ratio:16/9;border-radius:8px;overflow:hidden;background:#070a12;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:11px}}
    .output-thumb img{{width:100%;height:100%;object-fit:cover}}
    .output-thumb.empty{{background:#0c111b}}
    .output-title{{font-size:13px;color:#f8fafc}}
    .output-sub{{font-size:12px;color:var(--muted)}}
    .output-actions{{display:flex;gap:8px;align-items:center}}
    .output-actions button{{padding:6px 8px;border-radius:8px;border:1px solid var(--line);background:#0c111b;color:#e5e7eb;cursor:pointer}}
    .output-actions a{{color:var(--accent-2);text-decoration:none;font-size:12px}}
    .view{{display:none}}
    .view.active{{display:block}}
    .modal{{position:fixed;inset:0;background:rgba(3,6,11,.75);display:none;align-items:center;justify-content:center;z-index:50}}
    .modal.active{{display:flex}}
    .modal-card{{width:min(900px,92vw);background:#0b0f18;border:1px solid var(--line);border-radius:14px;overflow:hidden}}
    .modal-header{{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--line)}}
    .modal-header h3{{margin:0;font-size:14px}}
    .modal-header button{{border:0;background:#1f2937;color:#e5e7eb;border-radius:8px;padding:6px 10px;cursor:pointer}}
    .modal-body{{padding:12px}}
    .modal-body video{{width:100%;height:auto;background:#000;border-radius:10px}}
  </style>
</head>
<body>
  <header>
    <h1>tiles studio</h1>
    <p>Manage all videos in <strong>src/</strong>. Pick folders on the left, preview clips in the middle, and run actions on the right.</p>
    <nav>
      <button type="button" class="active" data-view="library">Library</button>
      <button type="button" data-view="actions">Actions</button>
      <button type="button" data-view="outputs">Outputs</button>
      <button type="button" data-view="logs">Logs</button>
    </nav>
  </header>
  <form method="POST" action="/run" class="app">
    <aside>
      <div class="view active" data-view="library">
        <h2>Folders</h2>
        <div class="section">
          <input class="search" id="folder-search" placeholder="Filter folders" />
        </div>
        <div class="folder-list" id="folder-list">{folder_rows}</div>
        <div class="section">
          <button type="button" class="btn secondary" id="select-all">Select all</button>
          <button type="button" class="btn secondary" id="clear-all">Clear</button>
          <div class="hint" style="margin-top:8px;">Selected folders drive previews and actions.</div>
        </div>
        <input type="hidden" name="folders" value="" />
        <input type="hidden" name="videos" value="" />
      </div>
      <div class="view" data-view="outputs">
        <h2>Output Structure</h2>
        <div class="callout">Source outputs are standardized under each folder.</div>
        <div class="hint" style="margin-top:10px;">Example:</div>
        <div class="hint">src/&lt;folder&gt;/outputs/&lt;tool&gt;/run_123456/</div>
        <div class="hint" style="margin-top:10px;">Tools: concat, trim, detect, strip-audio</div>
      </div>
      <div class="view" data-view="logs">
        <h2>Logs</h2>
        <div class="hint">See outputs/tui-logs for run logs.</div>
      </div>
    </aside>
    <main>
      <div class="view active" data-view="library">
        <div class="toolbar">
          <input id="video-search" class="search" placeholder="Search videos" />
          <span class="pill" id="video-count">0 videos</span>
          <span class="pill" id="video-selected">0 selected</span>
        </div>
        <div class="video-grid" id="video-grid">
          {video_cards}
        </div>
      </div>
      <div class="view" data-view="actions">
        <div class="hint">Choose an action on the right and click Run.</div>
      </div>
      <div class="view" data-view="outputs">
        <div class="section">
          <h2>Recent outputs</h2>
          <div class="hint">Newest runs first. Paths are relative to src/.</div>
        </div>
        <div class="output-list" id="output-list">
          {output_rows}
        </div>
      </div>
      <div class="view" data-view="logs">
        <div class="hint">Open output logs from outputs/tui-logs/</div>
      </div>
    </main>
    <aside class="inspector">
      <div class="view active" data-view="actions">
        <div class="section">
          <h2>Action</h2>
          <div class="hint">Choose what to do with the selected folders.</div>
          <div class="hint">Selected clips override folder selection for trim, detect, strip audio.</div>
          <div class="row" style="margin-top:8px;">
            <div><span id="context-mode" class="pill">Folders mode</span></div>
            <div class="hint" id="context-note">Select clips to switch to clip mode.</div>
          </div>
          <select name="cmd" id="cmd">
            <option value="concat">Concatenate clips</option>
            <option value="trim">Trim clip heads/tails</option>
            <option value="detect">Detect scenes</option>
            <option value="strip-audio">Strip audio</option>
          </select>
          <div class="hint" id="concat-warning" style="display:none;">Concat requires folder selection.</div>
        </div>

        <div class="section">
          <h2>Output</h2>
          <div class="hint">Default writes to a subfolder next to your source clips.</div>
          <div class="row">
            <div>
              <label><input type="radio" name="output_mode" value="source" checked /> Source folder outputs</label>
            </div>
            <div>
              <label><input type="radio" name="output_mode" value="custom" /> Custom output folder</label>
            </div>
          </div>
          <label>Source output subdir</label>
          <input name="source_subdir" value="outputs" />
          <label>Custom output dir</label>
          <input name="custom_output" placeholder="outputs/concatenated" />
        </div>

        <div class="section">
          <h2>Concat</h2>
          <div class="hint">Combine all clips in each folder into one video.</div>
          <div class="row">
            <div>
              <label>Transition</label>
              <select name="transition">
                <option value="cut">Cut (no fade)</option>
                <option value="fade">Fade</option>
                <option value="fadeblack">Fade to black</option>
              </select>
            </div>
            <div>
              <label>Transition duration</label>
              <input name="duration" value="1.0" />
            </div>
          </div>
        </div>

        <div class="section">
          <h2>Trim</h2>
          <div class="hint">Remove time from the start and end of every clip.</div>
          <div class="row">
            <div>
              <label>Trim start (seconds)</label>
              <input name="trim_start" value="0" />
            </div>
            <div>
              <label>Trim end (seconds)</label>
              <input name="trim_end" value="0" />
            </div>
          </div>
        </div>

        <div class="section">
          <h2>Detect</h2>
          <div class="hint">Find scene changes and optionally split into clips.</div>
          <div class="row">
            <div>
              <label>Threshold</label>
              <input name="threshold" value="0.27" />
            </div>
            <div>
              <label>Method</label>
              <select name="method">
                <option value="content">Content</option>
                <option value="adaptive">Adaptive</option>
              </select>
            </div>
          </div>
          <label><input type="checkbox" name="list_only" /> List only (do not split)</label>
        </div>

        <div class="section">
          <h2>Strip audio</h2>
          <div class="hint">Remove audio from each selected clip.</div>
        </div>

        <div class="section">
          <div class="callout">Tip: pick folders on the left, then hit Run. No typing required.</div>
          <button class="btn" type="submit">Run</button>
        </div>
      </div>
    </aside>
  </form>
  <div id="player-modal" class="modal" role="dialog" aria-modal="true">
    <div class="modal-card">
      <div class="modal-header">
        <h3 id="player-title">Preview</h3>
        <button type="button" id="player-close">Close</button>
      </div>
      <div class="modal-body">
        <video id="player-video" controls playsinline></video>
      </div>
    </div>
  </div>
  <script>
    const folderChecks = Array.from(document.querySelectorAll('input[name="folder_pick"]'));
    const foldersField = document.querySelector('input[name="folders"]');
    const videosField = document.querySelector('input[name="videos"]');
    const folderSearch = document.getElementById('folder-search');
    const videoSearch = document.getElementById('video-search');
    const videoGrid = document.getElementById('video-grid');
    const videoCount = document.getElementById('video-count');
    const videoSelected = document.getElementById('video-selected');
    const videoSelects = Array.from(document.querySelectorAll('.video-select'));
    const navButtons = Array.from(document.querySelectorAll('nav button[data-view]'));
    const views = Array.from(document.querySelectorAll('.view'));
    const modal = document.getElementById('player-modal');
    const modalVideo = document.getElementById('player-video');
    const modalTitle = document.getElementById('player-title');
    const modalClose = document.getElementById('player-close');

    function selectedFolders() {{
      return folderChecks.filter(c => c.checked).map(c => c.value);
    }}

    function syncFolders() {{
      const values = selectedFolders();
      foldersField.value = values.join(',');
      filterVideos();
    }}

    function updateActionContext(selectedCount) {{
      const contextMode = document.getElementById('context-mode');
      const contextNote = document.getElementById('context-note');
      const cmd = document.getElementById('cmd');
      const concatWarning = document.getElementById('concat-warning');
      if (!contextMode || !contextNote || !cmd || !concatWarning) return;
      const inClipMode = selectedCount > 0;
      contextMode.textContent = inClipMode ? 'Clip mode' : 'Folders mode';
      contextNote.textContent = inClipMode
        ? 'Actions apply to selected clips only.'
        : 'Select clips to switch to clip mode.';
      const concatOption = Array.from(cmd.options).find(o => o.value === 'concat');
      if (concatOption) concatOption.disabled = inClipMode;
      concatWarning.style.display = inClipMode ? 'block' : 'none';
      if (inClipMode && cmd.value === 'concat') {{
        cmd.value = 'trim';
      }}
    }}

    function syncVideos() {{
      const selected = videoSelects.filter(c => c.checked).map(c => c.dataset.rel || '');
      const cleaned = selected.filter(Boolean);
      videosField.value = cleaned.join(',');
      videoSelected.textContent = `${{cleaned.length}} selected`;
      videoSelects.forEach(c => {{
        const card = c.closest('.video-card');
        if (card) card.classList.toggle('selected', c.checked);
      }});
      updateActionContext(cleaned.length);
    }}

    function openModal(card) {{
      if (!modal || !modalVideo || !modalTitle) return;
      const video = card.querySelector('video');
      const title = card.querySelector('.title');
      if (!video) return;
      modalVideo.src = video.getAttribute('src') || '';
      modalTitle.textContent = title ? title.textContent : 'Preview';
      modal.classList.add('active');
      modalVideo.play().catch(() => {{}});
    }}

    function closeModal() {{
      if (!modal || !modalVideo) return;
      modal.classList.remove('active');
      modalVideo.pause();
      modalVideo.removeAttribute('src');
      modalVideo.load();
    }}

    function filterFolders() {{
      const q = (folderSearch.value || '').toLowerCase();
      folderChecks.forEach(c => {{
        const label = c.parentElement.textContent.toLowerCase();
        c.parentElement.style.display = label.includes(q) ? 'flex' : 'none';
      }});
    }}

    function filterVideos() {{
      const folders = selectedFolders();
      const q = (videoSearch.value || '').toLowerCase();
      let count = 0;
      Array.from(videoGrid.children).forEach(card => {{
        const folder = card.getAttribute('data-folder') || '';
        const text = card.textContent.toLowerCase();
        const folderMatch = folders.length === 0 ? true : folders.includes(folder);
        const textMatch = text.includes(q);
        const show = folderMatch && textMatch;
        card.style.display = show ? 'block' : 'none';
        if (show) count += 1;
      }});
      videoCount.textContent = `${{count}} videos`;
    }}

    function selectView(name) {{
      navButtons.forEach(b => b.classList.toggle('active', b.dataset.view === name));
      views.forEach(v => v.classList.toggle('active', v.dataset.view === name));
    }}

    navButtons.forEach(b => b.addEventListener('click', () => selectView(b.dataset.view)));

    document.getElementById('select-all').addEventListener('click', () => {{
      folderChecks.forEach(c => c.checked = true);
      syncFolders();
    }});
    document.getElementById('clear-all').addEventListener('click', () => {{
      folderChecks.forEach(c => c.checked = false);
      syncFolders();
    }});
    folderChecks.forEach(c => c.addEventListener('change', syncFolders));
    videoSelects.forEach(c => c.addEventListener('change', syncVideos));
    folderSearch.addEventListener('input', filterFolders);
    videoSearch.addEventListener('input', filterVideos);

    Array.from(document.querySelectorAll('.meta-video')).forEach(v => {{
      const badge = v.parentElement.querySelector('.duration');
      v.addEventListener('loadedmetadata', () => {{
        const d = v.duration || 0;
        const m = Math.floor(d / 60).toString().padStart(2,'0');
        const s = Math.floor(d % 60).toString().padStart(2,'0');
        if (badge) badge.textContent = `${{m}}:${{s}}`;
      }});
    }});

    Array.from(document.querySelectorAll('.video-card .thumb')).forEach(thumb => {{
      thumb.addEventListener('click', (e) => {{
        if (e.target.closest('.play-btn')) return;
        const card = thumb.closest('.video-card');
        if (card) openModal(card);
      }});
    }});
    if (modalClose) modalClose.addEventListener('click', closeModal);
    if (modal) modal.addEventListener('click', (e) => {{
      if (e.target === modal) closeModal();
    }});
    document.addEventListener('keydown', (e) => {{
      if (e.key === 'Escape') closeModal();
    }});

    Array.from(document.querySelectorAll('.video-card .play-btn')).forEach(btn => {{
      btn.addEventListener('click', (e) => {{
        e.stopPropagation();
        const card = btn.closest('.video-card');
        if (card) openModal(card);
      }});
    }});
    Array.from(document.querySelectorAll('.video-card .thumb')).forEach(thumb => {{
      thumb.addEventListener('click', (e) => {{
        if (e.target.closest('.play-btn')) return;
        const card = thumb.closest('.video-card');
        if (card) openModal(card);
      }});
    }});
    modalClose.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {{
      if (e.target === modal) closeModal();
    }});
    document.addEventListener('keydown', (e) => {{
      if (e.key === 'Escape') closeModal();
    }});

    document.querySelectorAll('[data-copy]').forEach(btn => {{
      btn.addEventListener('click', () => {{
        const text = btn.getAttribute('data-copy') || '';
        navigator.clipboard?.writeText(text);
        btn.textContent = 'Copied';
        setTimeout(() => btn.textContent = 'Copy path', 1200);
      }});
    }});

    Array.from(document.querySelectorAll('.output-thumb video')).forEach(v => {{
      v.addEventListener('mouseenter', () => {{
        v.currentTime = Math.min(v.currentTime, 1.0);
        v.play().catch(() => {{}});
      }});
      v.addEventListener('mouseleave', () => {{
        v.pause();
        v.currentTime = 0;
      }});
    }});

    syncFolders();
    syncVideos();
  </script>
</body>
</html>"#,
        folder_rows = folder_rows,
        video_cards = video_cards,
        output_rows = output_rows
    );
    body
}

fn web_index_html_studio_v2(root: Option<&Path>) -> String {
    let folders = root
        .map(|r| collect_src_folder_entries(r, true))
        .unwrap_or_default();
    let videos = root.map(collect_src_videos).unwrap_or_default();
    let output_runs = root.map(collect_output_runs).unwrap_or_default();

    let mut folder_rows = String::new();
    for (label, value) in folders {
        let depth = value.split('/').count().saturating_sub(1);
        let indent = depth * 12;
        folder_rows.push_str(&format!(
            "<label class=\"folder-item\" style=\"margin-left:{}px\"><input type=\"checkbox\" name=\"folder_pick\" value=\"{}\"/> <span>{}</span></label>",
            indent,
            html_escape(&value),
            html_escape(&label)
        ));
    }
    if folder_rows.is_empty() {
        folder_rows
            .push_str("<div class=\"hint\">No folders found in src/. Use custom input.</div>");
    }

    let mut video_cards = String::new();
    for (folder, name, rel) in videos {
        let folder_label = if folder.is_empty() { "(root)" } else { &folder };
        let src = url_encode(&rel);
        let thumb = format!("/thumbs/{src}");
        video_cards.push_str(&format!(
            "<div class=\"video-card\" data-folder=\"{}\" data-rel=\"{}\" data-src=\"/files/{}\">\n  <div class=\"thumb\">\n    <img class=\"thumb-img\" src=\"{}\" alt=\"\" />\n    <video class=\"meta-video\" src=\"/files/{}\" muted preload=\"metadata\" playsinline></video>\n    <button type=\"button\" class=\"play-btn\">Play</button>\n    <div class=\"duration\">--:--</div>\n  </div>\n  <div class=\"meta\">\n    <div class=\"title\">{}</div>\n    <div class=\"sub\">{}</div>\n  </div>\n  <label class=\"select-flag\"><input type=\"checkbox\" class=\"video-select\" data-rel=\"{}\"/> Select</label>\n</div>",
            html_escape(&folder),
            html_escape(&rel),
            src,
            thumb,
            src,
            html_escape(&name),
            html_escape(folder_label),
            html_escape(&rel)
        ));
    }
    if video_cards.is_empty() {
        video_cards.push_str(
            "<div class=\"hint\">No videos found in src/. Add videos to src/ to see thumbnails.</div>",
        );
    }

    let mut output_rows = String::new();
    let mut project_nav = String::new();
    let mut grouped: HashMap<String, HashMap<String, Vec<OutputRun>>> = HashMap::new();
    for run in output_runs {
        grouped
            .entry(run.project.clone())
            .or_default()
            .entry(run.tool.clone())
            .or_default()
            .push(run);
    }
    let mut project_groups = grouped
        .into_iter()
        .map(|(project, tool_map)| {
            let mut latest = SystemTime::UNIX_EPOCH;
            let total = tool_map.values().map(|v| v.len()).sum::<usize>();
            for runs in tool_map.values() {
                if let Some(m) = runs.iter().map(|r| r.modified).max() {
                    if m > latest {
                        latest = m;
                    }
                }
            }
            (project, tool_map, total, latest)
        })
        .collect::<Vec<_>>();
    project_groups.sort_by(|a, b| b.3.cmp(&a.3));

    for (project, tool_map, total, _) in project_groups {
        let project_label = if project == "(global)" {
            "Global outputs".to_string()
        } else if project == "(root)" {
            "src/ (root)".to_string()
        } else {
            format!("src/{project}")
        };
        let tool_count = tool_map.len();
        let mut project_id = "project-".to_string();
        for c in project.chars() {
            if c.is_ascii_alphanumeric() {
                project_id.push(c.to_ascii_lowercase());
            } else {
                project_id.push('-');
            }
        }
        project_nav.push_str(&format!(
            "<a class=\"project-chip\" href=\"#{}\">{}</a>",
            html_escape(&project_id),
            html_escape(&project_label)
        ));
        output_rows.push_str(&format!(
            "<section class=\"output-project\" id=\"{}\">\n  <div class=\"project-header\">\n    <div>\n      <div class=\"project-title\">{}</div>\n      <div class=\"project-sub\">{}</div>\n    </div>\n    <div class=\"project-count\">{}</div>\n  </div>",
            html_escape(&project_id),
            html_escape(&project_label),
            html_escape(&format!("{tool_count} actions · {total} runs")),
            html_escape(&format!("{total} runs"))
        ));
        let mut tools = tool_map.into_iter().collect::<Vec<_>>();
        tools.sort_by(|a, b| a.0.cmp(&b.0));
        for (tool, mut runs) in tools {
            runs.sort_by(|a, b| b.modified.cmp(&a.modified));
            let count = runs.len();
            output_rows.push_str(&format!(
                "<div class=\"output-tool\">\n  <div class=\"output-tool-header\">\n    <div class=\"tool-title\">{}</div>\n    <div class=\"tool-sub\">{}</div>\n  </div>\n  <div class=\"output-run-grid\">",
                html_escape(&tool),
                html_escape(&format!("{count} runs"))
            ));
            for run in runs {
                let sample = run.sample_url.as_ref().cloned().unwrap_or_default();
                let thumb_url = if sample.starts_with("/files/") {
                    sample.replace("/files/", "/thumbs/")
                } else if sample.starts_with("/outfiles/") {
                    sample.replace("/outfiles/", "/outthumbs/")
                } else {
                    String::new()
                };
                let thumb = if thumb_url.is_empty() {
                    "<div class=\"output-thumb empty\">No preview</div>".to_string()
                } else {
                    format!(
                        "<div class=\"output-thumb\"><img src=\"{}\" alt=\"\" /></div>",
                        thumb_url
                    )
                };
                let sample_link = if sample.is_empty() {
                    "".to_string()
                } else {
                    format!("<a href=\"{}\" target=\"_blank\">Preview</a>", sample)
                };
                output_rows.push_str(&format!(
                    "<div class=\"output-run\">\n  {thumb}\n  <div class=\"output-meta\">\n    <div class=\"output-title\">{}</div>\n    <div class=\"output-sub\">{}</div>\n  </div>\n  <div class=\"output-actions\">{}<button type=\"button\" data-copy=\"{}\">Copy path</button></div>\n</div>",
                    html_escape(&run.run_id),
                    html_escape(&run.run_rel),
                    sample_link,
                    html_escape(&run.run_rel)
                ));
            }
            output_rows.push_str("</div></div>");
        }
        output_rows.push_str("</section>");
    }
    if output_rows.is_empty() {
        output_rows.push_str(
            "<div class=\"hint\">No outputs found yet. Run a tool to generate outputs.</div>",
        );
    }

    let body = format!(
        r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>tiles studio</title>
  <style>
    :root{{--bg:#0d1117;--panel:#121826;--muted:#9aa4b2;--line:#263043;--accent:#22c55e;--accent-2:#38bdf8}}
    body{{font-family:"IBM Plex Sans",system-ui,-apple-system,Segoe UI,Arial,sans-serif;background:radial-gradient(1200px 600px at 10% -10%,#1b2332 0%,#0d1117 60%);color:#e5e7eb;margin:0}}
    .app{{display:grid;grid-template-columns:280px 1fr 360px;min-height:100vh}}
    header{{grid-column:1/4;padding:16px 24px;border-bottom:1px solid var(--line);background:#0c111b;position:sticky;top:0;z-index:5}}
    header h1{{margin:0;font-size:20px;letter-spacing:.3px}}
    header p{{margin:6px 0 0;color:var(--muted);font-size:13px}}
    nav{{display:flex;gap:12px;margin-top:10px;flex-wrap:wrap}}
    nav button{{padding:6px 10px;border-radius:999px;border:1px solid var(--line);background:#0b0f18;color:#e5e7eb;cursor:pointer}}
    nav button.active{{background:var(--accent);color:#0b111a;border-color:transparent}}
    aside{{padding:16px 14px;border-right:1px solid var(--line);background:#0b0f18}}
    .inspector{{border-left:1px solid var(--line);background:#0f1522}}
    main{{padding:16px 18px}}
    h2{{margin:0 0 10px;font-size:15px;color:#f8fafc}}
    .section{{margin-bottom:18px}}
    .hint{{opacity:.7;font-size:12px;color:var(--muted)}}
    .folder-list{{max-height:360px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:10px;background:#0b0f18}}
    .folder-item{{display:flex;gap:8px;align-items:center;margin:6px 0;font-size:13px}}
    .folder-item input{{width:auto}}
    .toolbar{{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:12px}}
    .pill{{display:inline-block;padding:2px 8px;border-radius:999px;background:#101826;color:#9ef7c6;font-size:12px;border:1px solid #1e3b2b}}
    .search{{flex:1;min-width:200px}}
    input,select,textarea{{width:100%;padding:8px;border-radius:10px;border:1px solid var(--line);background:#0c111b;color:#e5e7eb}}
    textarea{{min-height:60px}}
    .video-grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}}
    .video-card{{background:#0c111b;border:1px solid var(--line);border-radius:12px;overflow:hidden;position:relative;transition:border-color .2s,box-shadow .2s}}
    .video-card.selected{{border-color:var(--accent);box-shadow:0 0 0 1px rgba(34,197,94,.4)}}
    .thumb{{background:#070a12;aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;position:relative}}
    .thumb img{{width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity .2s}}
    .thumb-spinner{{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(7,10,18,.65);transition:opacity .2s}}
    .thumb-spinner::after{{content:"";width:28px;height:28px;border-radius:50%;border:2px solid #2b3648;border-top-color:var(--accent-2);animation:spin 1s linear infinite}}
    .video-card.thumb-loaded .thumb-img{{opacity:1}}
    .video-card.thumb-loaded .thumb-spinner{{opacity:0;pointer-events:none}}
    .meta-video{{display:none}}
    .play-btn{{position:absolute;left:8px;bottom:6px;padding:4px 8px;border-radius:6px;border:0;background:rgba(0,0,0,.6);color:#e5e7eb;font-size:11px;cursor:pointer;z-index:2}}
    .duration{{position:absolute;bottom:6px;right:6px;background:rgba(0,0,0,.6);padding:2px 6px;border-radius:6px;font-size:11px}}
    .select-flag{{position:absolute;top:8px;left:8px;background:rgba(12,17,27,.8);padding:3px 6px;border-radius:8px;font-size:11px;display:flex;gap:6px;align-items:center;z-index:2}}
    .select-flag input{{width:auto}}
    .meta{{padding:8px}}
    .meta .title{{font-size:12px;color:#f8fafc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
    .meta .sub{{font-size:11px;color:var(--muted)}}
    .btn{{padding:10px 12px;border:0;border-radius:10px;background:var(--accent);color:#0b111a;font-weight:700;cursor:pointer}}
    .btn.secondary{{background:#1f2937;color:#e5e7eb}}
    .row{{display:flex;gap:10px}}
    .row>div{{flex:1}}
    .callout{{padding:10px;border:1px solid #2b3b22;border-radius:10px;background:#101a13;color:#b7f7d0;font-size:12px}}
    .output-list{{display:flex;flex-direction:column;gap:12px}}
    .output-group{{border:1px solid var(--line);border-radius:12px;background:#0b0f18;padding:8px}}
    .output-group summary{{display:flex;justify-content:space-between;align-items:center;cursor:pointer;list-style:none;padding:6px 8px}}
    .group-title{{font-size:13px;color:#f8fafc}}
    .group-sub{{font-size:12px;color:var(--muted)}}
    .output-row{{display:grid;grid-template-columns:120px 1fr auto;gap:12px;align-items:center;padding:10px;border-top:1px solid var(--line)}}
    .output-thumb{{width:120px;aspect-ratio:16/9;border-radius:8px;overflow:hidden;background:#070a12;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:11px}}
    .output-thumb video{{width:100%;height:100%;object-fit:cover}}
    .output-thumb img{{width:100%;height:100%;object-fit:cover;display:block}}
    .output-thumb.empty{{background:#0c111b}}
    .output-title{{font-size:13px;color:#f8fafc}}
    .output-sub{{font-size:12px;color:var(--muted)}}
    .output-actions{{display:flex;gap:8px;align-items:center}}
    .output-actions button{{padding:6px 8px;border-radius:8px;border:1px solid var(--line);background:#0c111b;color:#e5e7eb;cursor:pointer}}
    .output-actions a{{color:var(--accent-2);text-decoration:none;font-size:12px}}
    .view{{display:none}}
    .view.active{{display:block}}
    @keyframes spin{{to{{transform:rotate(360deg)}}}}
    .action-grid{{display:grid;grid-template-columns:1fr 1fr;gap:10px}}
    .action-card{{border:1px solid var(--line);background:#0c111b;color:#e5e7eb;border-radius:12px;padding:10px;cursor:pointer;text-align:left}}
    .action-card.active{{border-color:var(--accent);box-shadow:0 0 0 1px rgba(34,197,94,.4)}}
    .action-card.disabled{{opacity:.5;pointer-events:none}}
    .action-card h3{{margin:0 0 4px;font-size:13px}}
    .action-card p{{margin:0;font-size:12px;color:var(--muted)}}
    .action-panel{{display:none}}
    .action-panel.active{{display:block}}
    .modal{{position:fixed;inset:0;background:rgba(3,6,11,.75);display:none;align-items:center;justify-content:center;z-index:50}}
    .modal.active{{display:flex}}
    .modal-card{{width:min(900px,92vw);background:#0b0f18;border:1px solid var(--line);border-radius:14px;overflow:hidden}}
    .modal-header{{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--line)}}
    .modal-header h3{{margin:0;font-size:14px}}
    .modal-header button{{border:0;background:#1f2937;color:#e5e7eb;border-radius:8px;padding:6px 10px;cursor:pointer}}
    .modal-body{{padding:12px}}
    .modal-body video{{width:100%;height:auto;background:#000;border-radius:10px}}
  </style>
</head>
<body>
  <header>
    <h1>tiles studio</h1>
    <p>Every folder in <strong>src/</strong> is a project. Browse, preview, and run tools with plain-English actions.</p>
    <nav>
      <button type="button" class="active" data-view="library">Library</button>
      <button type="button" data-view="actions">Actions</button>
      <button type="button" data-view="outputs">Outputs</button>
      <button type="button" data-view="logs">Logs</button>
    </nav>
  </header>
  <form method="POST" action="/run" class="app">
    <aside>
      <div class="view active" data-view="library">
        <h2>Projects</h2>
        <div class="section">
          <input class="search" id="folder-search" placeholder="Filter projects" />
        </div>
        <div class="folder-list" id="folder-list">{folder_rows}</div>
        <div class="section">
          <button type="button" class="btn secondary" id="select-all">Select all</button>
          <button type="button" class="btn secondary" id="clear-all">Clear</button>
          <div class="hint" style="margin-top:8px;">Selected projects drive previews and actions.</div>
        </div>
        <input type="hidden" name="folders" value="" />
        <input type="hidden" name="videos" value="" />
      </div>
      <div class="view" data-view="outputs">
        <h2>Outputs</h2>
        <div class="hint">Shows project outputs and default outputs/ runs.</div>
      </div>
      <div class="view" data-view="logs">
        <h2>Logs</h2>
        <div class="hint">See outputs/tui-logs for run logs.</div>
      </div>
    </aside>
    <main>
      <div class="view active" data-view="library">
        <div class="toolbar">
          <input id="video-search" class="search" placeholder="Search videos" />
          <span class="pill" id="video-count">0 videos</span>
          <span class="pill" id="video-selected">0 selected</span>
        </div>
        <div class="video-grid" id="video-grid">
          {video_cards}
        </div>
      </div>
      <div class="view" data-view="actions">
        <div class="hint">Pick an action on the right and hit Run.</div>
      </div>
      <div class="view" data-view="outputs">
        <div class="section outputs-hero">
          <h2>Project outputs</h2>
          <div class="hint">Everything in the file system is grouped by project, then action.</div>
          <div class="hint">Project runs live under src/&lt;project&gt;/outputs/&lt;action&gt;/run_&lt;timestamp&gt;/. Global runs live under outputs/&lt;action&gt;/run_&lt;timestamp&gt;/.</div>
          <div class="project-nav">{project_nav}</div>
        </div>
        <div class="output-list" id="output-list">
          {output_rows}
        </div>
      </div>
      <div class="view" data-view="logs">
        <div class="hint">Open output logs from outputs/tui-logs/</div>
      </div>
    </main>
    <aside class="inspector">
      <div class="view active" data-view="actions">
        <div class="section">
          <h2>Actions</h2>
          <div class="hint">Select one clip for a single-video run, or select multiple clips for batch actions.</div>
          <div class="row" style="margin-top:8px;">
            <div><span id="context-mode" class="pill">Projects mode</span></div>
            <div class="hint" id="context-note">Select clips to switch to clip mode.</div>
          </div>
          <div class="action-grid" id="action-grid">
            <button type="button" class="action-card active" data-action="concat"><h3>Combine</h3><p>Make one video per project.</p></button>
            <button type="button" class="action-card" data-action="trim"><h3>Trim</h3><p>Remove time from start/end.</p></button>
            <button type="button" class="action-card" data-action="detect"><h3>Detect scenes</h3><p>Find and split scenes.</p></button>
            <button type="button" class="action-card" data-action="strip-audio"><h3>Strip audio</h3><p>Remove audio track.</p></button>
          </div>
          <input type="hidden" name="cmd" id="cmd" value="concat" />
          <div class="hint" id="concat-warning" style="display:none;">Combine requires project selection.</div>
        </div>

        <div class="section">
          <h2>Save results</h2>
          <div class="hint">Choose where the results land. Overwrite is available for clip actions only.</div>
          <div class="output-choices" id="output-choices">
            <label class="choice">
              <input type="radio" name="output_mode" value="source" checked />
              <div>
                <div class="title">Project outputs</div>
                <div class="desc">Saved inside each project folder.</div>
              </div>
            </label>
            <label class="choice">
              <input type="radio" name="output_mode" value="global" />
              <div>
                <div class="title">Main outputs</div>
                <div class="desc">Saved to the global outputs folder.</div>
              </div>
            </label>
            <label class="choice danger" id="overwrite-choice">
              <input type="radio" name="output_mode" value="overwrite" />
              <div>
                <div class="title">Overwrite originals</div>
                <div class="desc">Replace the selected clips in place.</div>
              </div>
            </label>
          </div>
          <div class="hint" id="overwrite-note" style="display:none;">Overwrite is only available for Trim and Strip audio.</div>
          <input type="hidden" name="source_subdir" value="outputs" />
          <input type="hidden" name="custom_output" value="" />
        </div>

        <div class="section action-panel active" data-action="concat">
          <h2>Combine settings</h2>
          <div class="row">
            <div>
              <label>Transition</label>
              <select name="transition">
                <option value="cut">Cut</option>
                <option value="fade">Fade</option>
                <option value="fadeblack">Fade to black</option>
              </select>
            </div>
            <div>
              <label>Transition duration</label>
              <input name="duration" value="1.0" />
            </div>
          </div>
        </div>

        <div class="section action-panel" data-action="trim">
          <h2>Trim settings</h2>
          <div class="row">
            <div>
              <label>Trim start (seconds)</label>
              <input name="trim_start" value="0" />
            </div>
            <div>
              <label>Trim end (seconds)</label>
              <input name="trim_end" value="0" />
            </div>
          </div>
        </div>

        <div class="section action-panel" data-action="detect">
          <h2>Detect settings</h2>
          <div class="row">
            <div>
              <label>Threshold</label>
              <input name="threshold" value="0.27" />
            </div>
            <div>
              <label>Method</label>
              <select name="method">
                <option value="content">Content</option>
                <option value="adaptive">Adaptive</option>
              </select>
            </div>
          </div>
          <label><input type="checkbox" name="list_only" /> List only (do not split)</label>
        </div>

        <div class="section action-panel" data-action="strip-audio">
          <h2>Strip audio</h2>
          <div class="hint">Removes audio from each selected clip.</div>
        </div>

        <div class="section">
          <div class="callout">Tip: pick projects or clips, then hit Run.</div>
          <button class="btn" type="submit">Run</button>
        </div>
      </div>
    </aside>
  </form>
  <div id="player-modal" class="modal" role="dialog" aria-modal="true">
    <div class="modal-card">
      <div class="modal-header">
        <h3 id="player-title">Preview</h3>
        <button type="button" id="player-close">Close</button>
      </div>
      <div class="modal-body">
        <video id="player-video" controls playsinline></video>
      </div>
    </div>
  </div>
  <script>
    const folderChecks = Array.from(document.querySelectorAll('input[name="folder_pick"]'));
    const foldersField = document.querySelector('input[name="folders"]');
    const videosField = document.querySelector('input[name="videos"]');
    const folderSearch = document.getElementById('folder-search');
    const videoSearch = document.getElementById('video-search');
    const videoGrid = document.getElementById('video-grid');
    const videoCount = document.getElementById('video-count');
    const videoSelected = document.getElementById('video-selected');
    const videoSelects = Array.from(document.querySelectorAll('.video-select'));
    const navButtons = Array.from(document.querySelectorAll('nav button[data-view]'));
    const views = Array.from(document.querySelectorAll('.view'));
    const modal = document.getElementById('player-modal');
    const modalVideo = document.getElementById('player-video');
    const modalTitle = document.getElementById('player-title');
    const modalClose = document.getElementById('player-close');
    const actionCards = Array.from(document.querySelectorAll('.action-card'));
    const actionPanels = Array.from(document.querySelectorAll('.action-panel'));
    const cmdInput = document.getElementById('cmd');
    const outputModeInputs = Array.from(document.querySelectorAll('input[name="output_mode"]'));
    const overwriteChoice = document.getElementById('overwrite-choice');
    const overwriteNote = document.getElementById('overwrite-note');

    function selectedFolders() {{
      return folderChecks.filter(c => c.checked).map(c => c.value);
    }}

    function syncFolders() {{
      const values = selectedFolders();
      foldersField.value = values.join(',');
      filterVideos();
    }}

    function updateActionContext(selectedCount) {{
      const contextMode = document.getElementById('context-mode');
      const contextNote = document.getElementById('context-note');
      const concatWarning = document.getElementById('concat-warning');
      const inClipMode = selectedCount > 0;
      contextMode.textContent = inClipMode ? 'Clip mode' : 'Projects mode';
      contextNote.textContent = inClipMode
        ? 'Actions apply to selected clips only.'
        : 'Select clips to switch to clip mode.';
      const concatCard = actionCards.find(c => c.dataset.action === 'concat');
      if (concatCard) concatCard.classList.toggle('disabled', inClipMode);
      concatWarning.style.display = inClipMode ? 'block' : 'none';
      if (inClipMode && cmdInput.value === 'concat') {{
        setAction('trim');
      }}
    }}

    function syncVideos() {{
      const selected = videoSelects.filter(c => c.checked).map(c => c.dataset.rel || '');
      const cleaned = selected.filter(Boolean);
      videosField.value = cleaned.join(',');
      videoSelected.textContent = `${{cleaned.length}} selected`;
      videoSelects.forEach(c => {{
        const card = c.closest('.video-card');
        if (card) card.classList.toggle('selected', c.checked);
      }});
      updateActionContext(cleaned.length);
    }}

    function filterFolders() {{
      const q = (folderSearch.value || '').toLowerCase();
      folderChecks.forEach(c => {{
        const label = c.parentElement.textContent.toLowerCase();
        c.parentElement.style.display = label.includes(q) ? 'flex' : 'none';
      }});
    }}

    function filterVideos() {{
      const folders = selectedFolders();
      const q = (videoSearch.value || '').toLowerCase();
      let count = 0;
      Array.from(videoGrid.children).forEach(card => {{
        const folder = card.getAttribute('data-folder') || '';
        const text = card.textContent.toLowerCase();
        const folderMatch = folders.length === 0 ? true : folders.includes(folder);
        const textMatch = text.includes(q);
        const show = folderMatch && textMatch;
        card.style.display = show ? 'block' : 'none';
        if (show) count += 1;
      }});
      videoCount.textContent = `${{count}} videos`;
    }}

    function selectView(name) {{
      navButtons.forEach(b => b.classList.toggle('active', b.dataset.view === name));
      views.forEach(v => v.classList.toggle('active', v.dataset.view === name));
    }}

    function updateOutputModes() {{
      const overwriteInput = outputModeInputs.find(i => i.value === 'overwrite');
      const allowOverwrite = cmdInput.value === 'trim' || cmdInput.value === 'strip-audio';
      if (overwriteInput) {{
        overwriteInput.disabled = !allowOverwrite;
        if (overwriteChoice) overwriteChoice.classList.toggle('disabled', !allowOverwrite);
        if (!allowOverwrite && overwriteInput.checked) {{
          const fallback = outputModeInputs.find(i => i.value === 'source');
          if (fallback) fallback.checked = true;
        }}
      }}
      if (overwriteNote) overwriteNote.style.display = allowOverwrite ? 'none' : 'block';
    }}

    function setAction(name) {{
      cmdInput.value = name;
      actionCards.forEach(c => c.classList.toggle('active', c.dataset.action === name));
      actionPanels.forEach(p => p.classList.toggle('active', p.dataset.action === name));
      updateOutputModes();
    }}

    let modalCurrentRel = '';

    function openModal(card) {{
      if (!modal || !modalVideo || !modalTitle) return;
      const title = card.querySelector('.title');
      const src = card.getAttribute('data-src') || '';
      if (!src) return;
      modalCurrentRel = card.getAttribute('data-rel') || '';
      modalVideo.src = src;
      modalTitle.textContent = title ? title.textContent : 'Preview';
      modal.classList.add('active');
      modalVideo.play().catch(() => {{}});
    }}

    function closeModal() {{
      if (!modal || !modalVideo) return;
      modal.classList.remove('active');
      modalVideo.pause();
      modalVideo.removeAttribute('src');
      modalVideo.load();
    }}

    navButtons.forEach(b => b.addEventListener('click', () => selectView(b.dataset.view)));
    actionCards.forEach(card => card.addEventListener('click', () => {{
      if (card.classList.contains('disabled')) return;
      setAction(card.dataset.action);
    }}));

    document.getElementById('select-all').addEventListener('click', () => {{
      folderChecks.forEach(c => c.checked = true);
      syncFolders();
    }});
    document.getElementById('clear-all').addEventListener('click', () => {{
      folderChecks.forEach(c => c.checked = false);
      syncFolders();
    }});
    folderChecks.forEach(c => c.addEventListener('change', syncFolders));
    videoSelects.forEach(c => c.addEventListener('change', syncVideos));
    folderSearch.addEventListener('input', filterFolders);
    videoSearch.addEventListener('input', filterVideos);

    Array.from(document.querySelectorAll('.video-card .meta-video')).forEach(v => {{
      const badge = v.parentElement.querySelector('.duration');
      v.addEventListener('loadedmetadata', () => {{
        const d = v.duration || 0;
        const m = Math.floor(d / 60).toString().padStart(2,'0');
        const s = Math.floor(d % 60).toString().padStart(2,'0');
        if (badge) badge.textContent = `${{m}}:${{s}}`;
      }});
    }});

    Array.from(document.querySelectorAll('.thumb-img')).forEach(img => {{
      const card = img.closest('.video-card');
      const markReady = () => {{ if (card) card.classList.add('thumb-loaded'); }};
      if (img.complete) {{
        markReady();
      }} else {{
        img.addEventListener('load', markReady);
        img.addEventListener('error', markReady);
      }}
    }});

    function getVisibleCards() {{
      return Array.from(videoGrid.querySelectorAll('.video-card')).filter(card => card.style.display !== 'none');
    }}

    function stepModal(delta) {{
      if (!modal || !modal.classList.contains('active')) return;
      const cards = getVisibleCards();
      if (!cards.length) return;
      let idx = cards.findIndex(c => (c.getAttribute('data-rel') || '') === modalCurrentRel);
      if (idx < 0) idx = 0;
      idx = (idx + delta + cards.length) % cards.length;
      openModal(cards[idx]);
    }}

    Array.from(document.querySelectorAll('.video-card .play-btn')).forEach(btn => {{
      btn.addEventListener('click', (e) => {{
        e.stopPropagation();
        const card = btn.closest('.video-card');
        if (card) openModal(card);
      }});
    }});
    Array.from(document.querySelectorAll('.video-card .thumb')).forEach(thumb => {{
      thumb.addEventListener('click', (e) => {{
        if (e.target.closest('.play-btn')) return;
        const card = thumb.closest('.video-card');
        if (card) openModal(card);
      }});
    }});
    if (modalClose) modalClose.addEventListener('click', closeModal);
    if (modal) modal.addEventListener('click', (e) => {{
      if (e.target === modal) closeModal();
    }});
    document.addEventListener('keydown', (e) => {{
      if (e.key === 'Escape') closeModal();
      if (e.key === 'ArrowRight') stepModal(1);
      if (e.key === 'ArrowLeft') stepModal(-1);
    }});

    document.querySelectorAll('[data-copy]').forEach(btn => {{
      btn.addEventListener('click', () => {{
        const text = btn.getAttribute('data-copy') || '';
        navigator.clipboard?.writeText(text);
        btn.textContent = 'Copied';
        setTimeout(() => btn.textContent = 'Copy path', 1200);
      }});
    }});

    setAction('concat');
    syncFolders();
    syncVideos();
  </script>
</body>
</html>"#,
        folder_rows = folder_rows,
        video_cards = video_cards,
        output_rows = output_rows,
        project_nav = project_nav
    );
    body
}

fn web_result_html(
    cmd: &str,
    args: &[OsString],
    status: i32,
    output: &str,
    log_path: &Path,
) -> String {
    let args_str = args
        .iter()
        .map(|a| a.to_string_lossy())
        .collect::<Vec<_>>()
        .join(" ");
    let output_html = html_escape(output);
    format!(
        r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>tiles web run</title>
  <style>
    body{{font-family:ui-monospace,Menlo,Monaco,Consolas,monospace;background:#0f1116;color:#e5e7eb;margin:0;padding:24px}}
    .card{{max-width:920px;margin:0 auto;background:#141823;border:1px solid #2a3142;border-radius:12px;padding:20px}}
    pre{{white-space:pre-wrap;background:#0f1116;padding:12px;border-radius:8px;border:1px solid #2a3142}}
    a{{color:#34d399}}
  </style>
</head>
<body>
  <div class="card">
    <h1>Run complete</h1>
    <p><strong>Command:</strong> tiles {cmd} {}</p>
    <p><strong>Status:</strong> {status}</p>
    <p><strong>Log:</strong> {}</p>
    <pre>{output_html}</pre>
    <p><a href="/">Back</a></p>
  </div>
</body>
</html>"#,
        html_escape(&args_str),
        html_escape(&log_path.display().to_string())
    )
}

fn run_web_subcommand(subcommand: &str, args: &[OsString]) -> (i32, String, PathBuf) {
    let root = find_repo_root()
        .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let log_dir = root.join("outputs").join("tui-logs");
    let _ = fs::create_dir_all(&log_dir);
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let log_path = log_dir.join(format!("tui_web_{subcommand}_run_{ts}.log"));

    let exe = match env::current_exe() {
        Ok(v) => v,
        Err(err) => {
            let msg = format!("warning: could not resolve current executable: {err}");
            let _ = fs::write(&log_path, &msg);
            return (1, msg, log_path);
        }
    };
    let mut cmd = Command::new(exe);
    cmd.arg(subcommand);
    for a in args {
        cmd.arg(a);
    }
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    let output = match cmd.output() {
        Ok(out) => out,
        Err(err) => {
            let msg = format!("error running subcommand: {err}");
            let _ = fs::write(&log_path, &msg);
            return (1, msg, log_path);
        }
    };

    let mut combined = String::new();
    combined.push_str(&format!(
        "$ tiles {subcommand} {}\n\n",
        args_to_string(args)
    ));
    if !output.stdout.is_empty() {
        combined.push_str(&String::from_utf8_lossy(&output.stdout));
    }
    if !output.stderr.is_empty() {
        if !combined.ends_with('\n') {
            combined.push('\n');
        }
        combined.push_str(&String::from_utf8_lossy(&output.stderr));
    }
    let _ = fs::write(&log_path, &combined);
    let status = output.status.code().unwrap_or(1);
    (status, combined, log_path)
}

fn args_to_string(args: &[OsString]) -> String {
    args.iter()
        .map(|a| a.to_string_lossy())
        .collect::<Vec<_>>()
        .join(" ")
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MenuScreen {
    Main,
    Tile,
    Tools,
    Help,
}

#[derive(Clone, Debug)]
struct TuiMenuState {
    screen: MenuScreen,
    main_selected: usize,
    tile_selected: usize,
    tools_selected: usize,
    help_scroll: u16,
}

fn run_native_menu_tui() -> Result<i32, String> {
    let root = find_repo_root();
    let mut terminal = init_terminal()?;
    let result = (|| -> Result<i32, String> {
        let mut state = TuiMenuState {
            screen: MenuScreen::Main,
            main_selected: 0,
            tile_selected: 0,
            tools_selected: 0,
            help_scroll: 0,
        };

        loop {
            draw_native_tui(&mut terminal, &state)?;
            if !event::poll(Duration::from_millis(120)).map_err(|e| e.to_string())? {
                continue;
            }
            let ev = event::read().map_err(|e| e.to_string())?;
            let Event::Key(key) = ev else {
                continue;
            };
            if key.kind != KeyEventKind::Press {
                continue;
            }

            match state.screen {
                MenuScreen::Main => {
                    let len = main_menu_items().len();
                    match key.code {
                        KeyCode::Up | KeyCode::Char('k') => {
                            state.main_selected = (state.main_selected + len - 1) % len
                        }
                        KeyCode::Down | KeyCode::Char('j') => {
                            state.main_selected = (state.main_selected + 1) % len
                        }
                        KeyCode::Enter => match state.main_selected {
                            0 => {
                                if let Some(args) =
                                    tui_build_run_saved_args(&mut terminal, root.as_deref())?
                                {
                                    let _ = run_subcommand_in_tui(&mut terminal, "tile", &args)?;
                                }
                            }
                            1 => state.screen = MenuScreen::Tile,
                            2 => {
                                if let Some(args) =
                                    tui_build_concat_args(&mut terminal, root.as_deref())?
                                {
                                    let _ = run_subcommand_in_tui(&mut terminal, "concat", &args)?;
                                }
                            }
                            3 => {
                                if let Some(args) =
                                    tui_build_trim_args(&mut terminal, root.as_deref())?
                                {
                                    let _ = run_subcommand_in_tui(&mut terminal, "trim", &args)?;
                                }
                            }
                            4 => {
                                if let Some(args) =
                                    tui_build_detect_args(&mut terminal, root.as_deref())?
                                {
                                    let _ = run_subcommand_in_tui(&mut terminal, "detect", &args)?;
                                }
                            }
                            5 => {
                                if let Some(args) =
                                    tui_build_clean_args(&mut terminal, root.as_deref())?
                                {
                                    let _ = run_subcommand_in_tui(&mut terminal, "clean", &args)?;
                                }
                            }
                            6 => state.screen = MenuScreen::Tools,
                            7 => {
                                state.help_scroll = 0;
                                state.screen = MenuScreen::Help;
                            }
                            8 => return Ok(0),
                            _ => {}
                        },
                        KeyCode::Esc | KeyCode::Char('q') => return Ok(0),
                        _ => {}
                    }
                }
                MenuScreen::Tile => {
                    let len = tile_menu_items().len();
                    match key.code {
                        KeyCode::Up | KeyCode::Char('k') => {
                            state.tile_selected = (state.tile_selected + len - 1) % len
                        }
                        KeyCode::Down | KeyCode::Char('j') => {
                            state.tile_selected = (state.tile_selected + 1) % len
                        }
                        KeyCode::Enter => match state.tile_selected {
                            0 => {
                                if let Some(args) =
                                    tui_build_tile_args(&mut terminal, root.as_deref())?
                                {
                                    let _ = run_subcommand_in_tui(&mut terminal, "tile", &args)?;
                                }
                            }
                            1 => {
                                if let Some(args) =
                                    tui_build_run_saved_args(&mut terminal, root.as_deref())?
                                {
                                    let _ = run_subcommand_in_tui(&mut terminal, "tile", &args)?;
                                }
                            }
                            2 => {
                                let settings = {
                                    let picked = tui_select_value(
                                        &mut terminal,
                                        "Tile",
                                        "Settings path",
                                        &["default", "custom..."],
                                        0,
                                    )?;
                                    match picked.as_deref() {
                                        Some("custom...") => {
                                            let s = tui_input_text(
                                                &mut terminal,
                                                "Tile",
                                                "Custom settings path",
                                                &default_settings_path(root.as_deref()),
                                            )?;
                                            s.unwrap_or_else(|| {
                                                default_settings_path(root.as_deref())
                                            })
                                        }
                                        _ => default_settings_path(root.as_deref()),
                                    }
                                };
                                {
                                    let mut args = vec![
                                        OsString::from("--settings"),
                                        OsString::from(settings),
                                    ];
                                    let mode = tui_select_value(
                                        &mut terminal,
                                        "Tile",
                                        "Render mode",
                                        &["full", "preview", "fast-preview"],
                                        0,
                                    )?;
                                    if let Some(mode) = mode {
                                        args.push("--render-mode".into());
                                        args.push(mode.into());
                                        if tui_confirm(
                                            &mut terminal,
                                            "Tile",
                                            "No overwrite?",
                                            false,
                                        )?
                                        .unwrap_or(false)
                                        {
                                            args.push("--no-overwrite".into());
                                        }
                                        if tui_confirm(&mut terminal, "Tile", "Force CFR?", false)?
                                            .unwrap_or(false)
                                        {
                                            args.push("--force-cfr".into());
                                        }
                                        let _ =
                                            run_subcommand_in_tui(&mut terminal, "tile", &args)?;
                                    }
                                }
                            }
                            3 => {
                                let settings_path = {
                                    let picked = tui_select_value(
                                        &mut terminal,
                                        "Settings",
                                        "Settings path",
                                        &["default", "custom..."],
                                        0,
                                    )?;
                                    match picked.as_deref() {
                                        Some("custom...") => {
                                            let s = tui_input_text(
                                                &mut terminal,
                                                "Settings",
                                                "Custom settings path",
                                                &default_settings_path(root.as_deref()),
                                            )?;
                                            s.unwrap_or_else(|| {
                                                default_settings_path(root.as_deref())
                                            })
                                        }
                                        _ => default_settings_path(root.as_deref()),
                                    }
                                };
                                {
                                    let existing = {
                                        let resolved = tui_resolve_settings_path(
                                            root.as_deref(),
                                            &settings_path,
                                        );
                                        if resolved.exists() {
                                            load_settings_json(&resolved)
                                                .ok()
                                                .map(editable_from_loaded)
                                                .map(normalize_editable_settings)
                                        } else {
                                            None
                                        }
                                    };
                                    tui_edit_settings_flow(
                                        &mut terminal,
                                        root.as_deref(),
                                        existing,
                                        settings_path,
                                    )?;
                                }
                            }
                            4 => {
                                let settings_path = {
                                    let picked = tui_select_value(
                                        &mut terminal,
                                        "Settings",
                                        "Settings path",
                                        &["default", "custom..."],
                                        0,
                                    )?;
                                    match picked.as_deref() {
                                        Some("custom...") => {
                                            let s = tui_input_text(
                                                &mut terminal,
                                                "Settings",
                                                "Custom settings path",
                                                &default_settings_path(root.as_deref()),
                                            )?;
                                            s.unwrap_or_else(|| {
                                                default_settings_path(root.as_deref())
                                            })
                                        }
                                        _ => default_settings_path(root.as_deref()),
                                    }
                                };
                                {
                                    let resolved =
                                        tui_resolve_settings_path(root.as_deref(), &settings_path);
                                    if !resolved.exists() {
                                        tui_show_text(
                                            &mut terminal,
                                            "Settings",
                                            &format!(
                                                "settings file not found: {}",
                                                resolved.display()
                                            ),
                                        )?;
                                    } else {
                                        let existing = load_settings_json(&resolved)
                                            .map(editable_from_loaded)
                                            .map(normalize_editable_settings)?;
                                        tui_edit_settings_flow(
                                            &mut terminal,
                                            root.as_deref(),
                                            Some(existing),
                                            settings_path,
                                        )?;
                                    }
                                }
                            }
                            5 => {
                                let _ = run_subcommand_in_tui(&mut terminal, "yolo", &[])?;
                            }
                            6 => {
                                let text = build_saved_settings_summary(root.as_deref())
                                    .unwrap_or_else(|e| format!("error: {e}"));
                                tui_show_text(&mut terminal, "Saved Settings Summary", &text)?;
                            }
                            7 => state.screen = MenuScreen::Main,
                            _ => {}
                        },
                        KeyCode::Esc | KeyCode::Char('b') | KeyCode::Char('q') => {
                            state.screen = MenuScreen::Main
                        }
                        _ => {}
                    }
                }
                MenuScreen::Tools => {
                    let len = tools_menu_items().len();
                    match key.code {
                        KeyCode::Up | KeyCode::Char('k') => {
                            state.tools_selected = (state.tools_selected + len - 1) % len
                        }
                        KeyCode::Down | KeyCode::Char('j') => {
                            state.tools_selected = (state.tools_selected + 1) % len
                        }
                        KeyCode::Enter => match state.tools_selected {
                            0 => {
                                if let Some(folders) = tui_pick_folders(
                                    &mut terminal,
                                    root.as_deref(),
                                    "Doctor Re-encode",
                                )? {
                                    if !folders.is_empty() {
                                        let fps = tui_select_value(
                                            &mut terminal,
                                            "Doctor Re-encode",
                                            "FPS",
                                            &["24", "25", "30", "50", "60", "custom..."],
                                            2,
                                        )?
                                        .unwrap_or_else(|| "30".to_string());
                                        let fps = if fps == "custom..." {
                                            let v = tui_input_text(
                                                &mut terminal,
                                                "Doctor Re-encode",
                                                "Custom FPS",
                                                "30",
                                            )?;
                                            v.unwrap_or_else(|| "30".to_string())
                                        } else {
                                            fps
                                        };
                                        let mut args = folders;
                                        args.push("--fps".into());
                                        args.push(fps.into());
                                        if !tui_confirm(
                                            &mut terminal,
                                            "Doctor Re-encode",
                                            "Keep audio?",
                                            true,
                                        )?
                                        .unwrap_or(true)
                                        {
                                            args.push("--no-audio".into());
                                        }
                                        if tui_confirm(
                                            &mut terminal,
                                            "Doctor Re-encode",
                                            "Overwrite originals?",
                                            false,
                                        )?
                                        .unwrap_or(false)
                                        {
                                            args.push("--overwrite".into());
                                        }
                                        let _ = run_subcommand_in_tui(
                                            &mut terminal,
                                            "doctor-reencode",
                                            &args,
                                        )?;
                                    }
                                }
                            }
                            1 => {
                                if let Some(folders) = tui_pick_folders(
                                    &mut terminal,
                                    root.as_deref(),
                                    "Doctor Trim Start",
                                )? {
                                    if !folders.is_empty() {
                                        let secs = tui_select_value(
                                            &mut terminal,
                                            "Doctor Trim Start",
                                            "Seconds",
                                            &["0.1", "0.25", "0.5", "1.0", "2.0", "custom..."],
                                            3,
                                        )?
                                        .unwrap_or_else(|| "1.0".to_string());
                                        let secs = if secs == "custom..." {
                                            let v = tui_input_text(
                                                &mut terminal,
                                                "Doctor Trim Start",
                                                "Custom seconds",
                                                "1.0",
                                            )?;
                                            v.unwrap_or_else(|| "1.0".to_string())
                                        } else {
                                            secs
                                        };
                                        let mut args = folders;
                                        args.push("--seconds".into());
                                        args.push(secs.into());
                                        if !tui_confirm(
                                            &mut terminal,
                                            "Doctor Trim Start",
                                            "Keep audio?",
                                            true,
                                        )?
                                        .unwrap_or(true)
                                        {
                                            args.push("--no-audio".into());
                                        }
                                        if tui_confirm(
                                            &mut terminal,
                                            "Doctor Trim Start",
                                            "Overwrite originals?",
                                            false,
                                        )?
                                        .unwrap_or(false)
                                        {
                                            args.push("--overwrite".into());
                                        }
                                        let _ = run_subcommand_in_tui(
                                            &mut terminal,
                                            "doctor-trim-start",
                                            &args,
                                        )?;
                                    }
                                }
                            }
                            2 => {
                                if let Some(args) = tui_pick_folders(
                                    &mut terminal,
                                    root.as_deref(),
                                    "Organize Landscape",
                                )? {
                                    if !args.is_empty() {
                                        let _ = run_subcommand_in_tui(
                                            &mut terminal,
                                            "organize-landscape",
                                            &args,
                                        )?;
                                    }
                                }
                            }
                            3 => {
                                if let Some(folders) =
                                    tui_pick_folders(&mut terminal, root.as_deref(), "Slow Motion")?
                                {
                                    if !folders.is_empty() {
                                        let factor = tui_select_value(
                                            &mut terminal,
                                            "Slow Motion",
                                            "Factor",
                                            &["0.25", "0.5", "0.75", "1.0", "custom..."],
                                            1,
                                        )?
                                        .unwrap_or_else(|| "0.5".to_string());
                                        let factor = if factor == "custom..." {
                                            let v = tui_input_text(
                                                &mut terminal,
                                                "Slow Motion",
                                                "Custom factor",
                                                "0.5",
                                            )?;
                                            v.unwrap_or_else(|| "0.5".to_string())
                                        } else {
                                            factor
                                        };
                                        let mut args = folders;
                                        args.push("--factor".into());
                                        args.push(factor.into());
                                        if !tui_confirm(
                                            &mut terminal,
                                            "Slow Motion",
                                            "Keep audio?",
                                            true,
                                        )?
                                        .unwrap_or(true)
                                        {
                                            args.push("--no-audio".into());
                                        }
                                        if tui_confirm(
                                            &mut terminal,
                                            "Slow Motion",
                                            "Overwrite originals?",
                                            false,
                                        )?
                                        .unwrap_or(false)
                                        {
                                            args.push("--overwrite".into());
                                        }
                                        let _ =
                                            run_subcommand_in_tui(&mut terminal, "slowmo", &args)?;
                                    }
                                }
                            }
                            4 => state.screen = MenuScreen::Main,
                            _ => {}
                        },
                        KeyCode::Esc | KeyCode::Char('b') | KeyCode::Char('q') => {
                            state.screen = MenuScreen::Main
                        }
                        _ => {}
                    }
                }
                MenuScreen::Help => match key.code {
                    KeyCode::Up | KeyCode::Char('k') => {
                        state.help_scroll = state.help_scroll.saturating_sub(1)
                    }
                    KeyCode::Down | KeyCode::Char('j') => {
                        state.help_scroll = state.help_scroll.saturating_add(1)
                    }
                    KeyCode::PageUp => state.help_scroll = state.help_scroll.saturating_sub(10),
                    KeyCode::PageDown => state.help_scroll = state.help_scroll.saturating_add(10),
                    KeyCode::Home => state.help_scroll = 0,
                    KeyCode::Esc | KeyCode::Char('b') | KeyCode::Char('q') | KeyCode::Enter => {
                        state.screen = MenuScreen::Main
                    }
                    _ => {}
                },
            }
        }
    })();

    let cleanup = restore_terminal(&mut terminal);
    match (result, cleanup) {
        (Ok(code), Ok(_)) => Ok(code),
        (Ok(_), Err(err)) => Err(err),
        (Err(err), Ok(_)) => Err(err),
        (Err(run_err), Err(clean_err)) => Err(format!("{run_err}; cleanup failed: {clean_err}")),
    }
}

fn init_terminal() -> Result<Terminal<CrosstermBackend<Stdout>>, String> {
    enable_raw_mode().map_err(|e| e.to_string())?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen).map_err(|e| e.to_string())?;
    let backend = CrosstermBackend::new(stdout);
    Terminal::new(backend).map_err(|e| e.to_string())
}

fn restore_terminal(terminal: &mut Terminal<CrosstermBackend<Stdout>>) -> Result<(), String> {
    disable_raw_mode().map_err(|e| e.to_string())?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen).map_err(|e| e.to_string())?;
    terminal.show_cursor().map_err(|e| e.to_string())
}

fn main_menu_items() -> &'static [&'static str] {
    &[
        "Run saved settings",
        "Tile workflows",
        "Concat videos",
        "Trim videos",
        "Detect scenes",
        "Clean folders",
        "Tools and Doctor",
        "Help",
        "Exit",
    ]
}

fn tile_menu_items() -> &'static [&'static str] {
    &[
        "Quick tile run",
        "Run default saved settings",
        "Run from settings file",
        "Create/update settings file",
        "Edit existing settings file",
        "YOLO random run",
        "Show saved settings summary",
        "Back",
    ]
}

fn tools_menu_items() -> &'static [&'static str] {
    &[
        "Doctor: Re-encode CFR (fix freezes)",
        "Doctor: Trim start",
        "Organize: Split landscape videos",
        "Make slow motion",
        "Back",
    ]
}

fn draw_native_tui(
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    state: &TuiMenuState,
) -> Result<(), String> {
    terminal
        .draw(|f| {
            let size = f.area();
            let chunks = Layout::default()
                .direction(Direction::Vertical)
                .constraints([
                    Constraint::Length(3),
                    Constraint::Min(5),
                    Constraint::Length(2),
                ])
                .split(size);

            let header = Paragraph::new(Line::from(vec![
                Span::styled(
                    "tiles",
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::raw("  Rust TUI"),
            ]))
            .alignment(Alignment::Center)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .title("Main")
                    .padding(Padding::horizontal(1)),
            );
            f.render_widget(header, chunks[0]);

            match state.screen {
                MenuScreen::Main => {
                    let body = Layout::default()
                        .direction(Direction::Horizontal)
                        .constraints([Constraint::Percentage(52), Constraint::Percentage(48)])
                        .split(chunks[1]);
                    render_menu_list(
                        body[0],
                        f,
                        "Main Menu",
                        main_menu_items(),
                        state.main_selected,
                    );
                    let preview = Paragraph::new(main_menu_preview_lines(state.main_selected))
                        .wrap(Wrap { trim: false })
                        .block(
                            Block::default()
                                .borders(Borders::ALL)
                                .title("What This Does")
                                .padding(Padding::horizontal(1)),
                        );
                    f.render_widget(preview, body[1]);
                    render_footer(
                        f,
                        chunks[2],
                        "Up/Down to move, Enter to select, q/Esc to quit",
                    );
                }
                MenuScreen::Tile => {
                    let body = Layout::default()
                        .direction(Direction::Horizontal)
                        .constraints([Constraint::Percentage(52), Constraint::Percentage(48)])
                        .split(chunks[1]);
                    render_menu_list(
                        body[0],
                        f,
                        "Tile Workflows",
                        tile_menu_items(),
                        state.tile_selected,
                    );
                    let preview = Paragraph::new(tile_menu_preview_lines(state.tile_selected))
                        .wrap(Wrap { trim: false })
                        .block(
                            Block::default()
                                .borders(Borders::ALL)
                                .title("Workflow Preview")
                                .padding(Padding::horizontal(1)),
                        );
                    f.render_widget(preview, body[1]);
                    render_footer(f, chunks[2], "Up/Down, Enter, b/q/Esc to go back");
                }
                MenuScreen::Tools => {
                    let body = Layout::default()
                        .direction(Direction::Horizontal)
                        .constraints([Constraint::Percentage(52), Constraint::Percentage(48)])
                        .split(chunks[1]);
                    render_menu_list(
                        body[0],
                        f,
                        "Tools and Doctor",
                        tools_menu_items(),
                        state.tools_selected,
                    );
                    let preview = Paragraph::new(tools_menu_preview_lines(state.tools_selected))
                        .wrap(Wrap { trim: false })
                        .block(
                            Block::default()
                                .borders(Borders::ALL)
                                .title("Tool Preview")
                                .padding(Padding::horizontal(1)),
                        );
                    f.render_widget(preview, body[1]);
                    render_footer(f, chunks[2], "Up/Down, Enter, b/q/Esc to go back");
                }
                MenuScreen::Help => {
                    let lines: Vec<Line<'static>> = DETAILED_HELP_TEXT
                        .lines()
                        .map(|l| Line::from(l.to_string()))
                        .collect();
                    let p = Paragraph::new(lines)
                        .wrap(Wrap { trim: false })
                        .scroll((state.help_scroll, 0))
                        .block(
                            Block::default()
                                .borders(Borders::ALL)
                                .title("Help")
                                .padding(Padding::horizontal(1)),
                        );
                    f.render_widget(p, chunks[1]);
                    render_footer(
                        f,
                        chunks[2],
                        "Scroll: Up/Down PgUp/PgDn Home | Enter/b/q/Esc to go back",
                    );
                }
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn render_menu_list(
    area: ratatui::layout::Rect,
    f: &mut ratatui::Frame<'_>,
    title: &str,
    items: &[&str],
    selected: usize,
) {
    let rows: Vec<ListItem<'_>> = items
        .iter()
        .map(|s| ListItem::new(Line::from((*s).to_string())))
        .collect();
    let list = List::new(rows)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .title(title)
                .padding(Padding::horizontal(1)),
        )
        .highlight_style(
            Style::default()
                .fg(Color::Black)
                .bg(Color::White)
                .add_modifier(Modifier::BOLD),
        )
        .highlight_symbol(">> ");
    let mut stateful = ListState::default();
    stateful.select(Some(selected.min(items.len().saturating_sub(1))));
    f.render_stateful_widget(list, area, &mut stateful);
}

fn main_menu_preview_lines(selected: usize) -> Vec<Line<'static>> {
    let text = match selected {
        0 => "Run the saved tile settings quickly.\nGood default when your config is ready.",
        1 => "Tile-specific workflows:\nquick run, settings editor,\nYOLO run, summary.",
        2 => "Concatenate clips in each folder.\nSupports cut/fade/fadeblack.",
        3 => "Trim clips by start/end seconds\nfor all videos in selected folders.",
        4 => "Detect scenes and optionally split\nvideos into scene clips.",
        5 => "Remove duplicates and/or rename\nfiles by date with numbering option.",
        6 => "Recovery/prep utilities:\nCFR re-encode, trim-start,\norganize landscape, slowmo.",
        7 => "Navigation and workflow help,\nwith keybindings and behavior notes.",
        _ => "Exit tiles.",
    };
    text.lines().map(|l| Line::from(l.to_string())).collect()
}

fn tile_menu_preview_lines(selected: usize) -> Vec<Line<'static>> {
    let text = match selected {
        0 => "Build a tile command from choices.\nBest for one-off renders.",
        1 => "Run default settings path directly:\nconfigs/tile_videos_settings.json",
        2 => "Run using settings file with\nrender/no-overwrite/CFR controls.",
        3 => "Create or update settings using\nfield-by-field editor and preview.",
        4 => "Load existing settings and edit\nonly the fields you need.",
        5 => "Randomized settings run for fast\nexperimentation.",
        6 => "Read-only summary of saved settings\nand per-tile configuration.",
        _ => "Return to main menu.",
    };
    text.lines().map(|l| Line::from(l.to_string())).collect()
}

fn tools_menu_preview_lines(selected: usize) -> Vec<Line<'static>> {
    let text = match selected {
        0 => "Re-encode to CFR to fix freeze/\ntimestamp issues in source clips.",
        1 => "Trim fixed seconds from clip starts.\nUseful for dirty camera starts.",
        2 => "Move landscape videos into\nlandscape/ subfolder.",
        3 => "Generate slow-motion versions with\noptional audio tempo adjust.",
        _ => "Return to main menu.",
    };
    text.lines().map(|l| Line::from(l.to_string())).collect()
}

fn render_footer(f: &mut ratatui::Frame<'_>, area: ratatui::layout::Rect, text: &str) {
    let footer = if area.height >= 3 {
        Paragraph::new(Line::from(text.to_string()))
            .alignment(Alignment::Center)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .padding(Padding::horizontal(1)),
            )
    } else {
        Paragraph::new(Line::from(text.to_string())).alignment(Alignment::Center)
    };
    f.render_widget(footer, area);
}

fn tile_color(tile_idx: usize) -> Color {
    match tile_idx % 9 {
        0 => Color::Cyan,
        1 => Color::Green,
        2 => Color::Yellow,
        3 => Color::Magenta,
        4 => Color::Blue,
        5 => Color::Red,
        6 => Color::White,
        7 => Color::LightCyan,
        _ => Color::LightGreen,
    }
}

fn tile_style(tile_idx: usize) -> Style {
    Style::default()
        .fg(tile_color(tile_idx))
        .add_modifier(Modifier::BOLD)
}

fn layout_ascii_rows(layout: &str) -> &'static [&'static str] {
    match layout {
        "2x1" => &["+-----+-----+", "|  1  |  2  |", "+-----+-----+"],
        "1x2" => &[
            "+---------+",
            "|    1    |",
            "+---------+",
            "|    2    |",
            "+---------+",
        ],
        "2x2" => &[
            "+-----+-----+",
            "|  1  |  2  |",
            "+-----+-----+",
            "|  3  |  4  |",
            "+-----+-----+",
        ],
        "2x3" => &[
            "+-----+-----+",
            "|  1  |  2  |",
            "+-----+-----+",
            "|  3  |  4  |",
            "+-----+-----+",
            "|  5  |  6  |",
            "+-----+-----+",
        ],
        "3x2" => &[
            "+---+---+---+",
            "| 1 | 2 | 3 |",
            "+---+---+---+",
            "| 4 | 5 | 6 |",
            "+---+---+---+",
        ],
        "3x1" => &["+---+---+---+", "| 1 | 2 | 3 |", "+---+---+---+"],
        "1x3" => &[
            "+-----+", "|  1  |", "+-----+", "|  2  |", "+-----+", "|  3  |", "+-----+",
        ],
        "4x1" => &["+--+--+--+--+", "|1 |2 |3 |4 |", "+--+--+--+--+"],
        "1x4" => &[
            "+-----+", "|  1  |", "+-----+", "|  2  |", "+-----+", "|  3  |", "+-----+", "|  4  |",
            "+-----+",
        ],
        "3x3" => &[
            "+---+---+---+",
            "| 1 | 2 | 3 |",
            "+---+---+---+",
            "| 4 | 5 | 6 |",
            "+---+---+---+",
            "| 7 | 8 | 9 |",
            "+---+---+---+",
        ],
        "2x2-focus" => &[
            "+-----------+",
            "|     1     |",
            "+-----+-----+",
            "|  2  |  3  |",
            "+-----+-----+",
        ],
        "3x3-focus" => &[
            "+-----------+---+",
            "|     1     | 2 |",
            "|           +---+",
            "|           | 3 |",
            "+---+---+---+---+",
            "| 4 | 5 | 6 | 6 |",
            "+---+---+---+---+",
        ],
        "pip" => &[
            "+-----------+",
            "|     1     |",
            "|   +---+   |",
            "|   | 2 |   |",
            "|   +---+   |",
            "+-----------+",
        ],
        "1+2" => &[
            "+-----------+",
            "|     1     |",
            "+-----+-----+",
            "|  2  |  3  |",
            "+-----+-----+",
        ],
        "2+1" => &[
            "+-----+-----+",
            "|  1  |  2  |",
            "+-----------+",
            "|     3     |",
            "+-----------+",
        ],
        "1+3" => &[
            "+---------------+",
            "|       1       |",
            "+---+---+---+---+",
            "| 2 | 3 | 4 | 4 |",
            "+---+---+---+---+",
        ],
        "left-big-right-stack" => &[
            "+-----------+",
            "|     1     |",
            "+-----+-----+",
            "|  2  |  3  |",
            "+-----+-----+",
        ],
        "top-big-bottom-stack" => &[
            "+-----------+",
            "|     1     |",
            "+-----+-----+",
            "|  2  |  3  |",
            "+-----+-----+",
        ],
        _ => &["(no preview available)"],
    }
}

fn layout_preview_texts() -> [&'static str; 18] {
    [
        "+-----+-----+\n|  1  |  2  |\n+-----+-----+",
        "+---------+\n|    1    |\n+---------+\n|    2    |\n+---------+",
        "+-----+-----+\n|  1  |  2  |\n+-----+-----+\n|  3  |  4  |\n+-----+-----+",
        "+-----+-----+\n|  1  |  2  |\n+-----+-----+\n|  3  |  4  |\n+-----+-----+\n|  5  |  6  |\n+-----+-----+",
        "+---+---+---+\n| 1 | 2 | 3 |\n+---+---+---+\n| 4 | 5 | 6 |\n+---+---+---+",
        "+---+---+---+\n| 1 | 2 | 3 |\n+---+---+---+",
        "+-----+\n|  1  |\n+-----+\n|  2  |\n+-----+\n|  3  |\n+-----+",
        "+--+--+--+--+\n|1 |2 |3 |4 |\n+--+--+--+--+",
        "+-----+\n|  1  |\n+-----+\n|  2  |\n+-----+\n|  3  |\n+-----+\n|  4  |\n+-----+",
        "+---+---+---+\n| 1 | 2 | 3 |\n+---+---+---+\n| 4 | 5 | 6 |\n+---+---+---+\n| 7 | 8 | 9 |\n+---+---+---+",
        "2x2 focus: big top + two bottom tiles.",
        "3x3 focus: big top-left + right stack + bottom row.",
        "Picture-in-picture.\nLarge background tile with\nsmall overlay tile.",
        "Top wide tile +\ntwo bottom tiles.",
        "Two top tiles +\none bottom wide tile.",
        "Top wide tile +\nthree bottom segments.",
        "Left big + right stack.",
        "Top big + bottom stack.",
    ]
}

fn colored_layout_line_with_marks(
    row: &str,
    focus_tile: Option<usize>,
    audio_tile: Option<usize>,
) -> Line<'static> {
    let mut spans = Vec::<Span<'static>>::new();
    for ch in row.chars() {
        if ch.is_ascii_digit() && ch != '0' {
            let idx = (ch as u8 - b'1') as usize;
            let mut style = tile_style(idx);
            if Some(idx) == focus_tile {
                style = style.bg(Color::DarkGray);
            }
            if Some(idx) == audio_tile {
                style = style.bg(Color::Blue);
            }
            spans.push(Span::styled(ch.to_string(), style));
        } else {
            spans.push(Span::raw(ch.to_string()));
        }
    }
    Line::from(spans)
}

fn settings_preview_lines(s: &EditableSettings) -> Vec<Line<'static>> {
    settings_preview_lines_marked(s, None, s.audio_tiles.first().copied())
}

fn settings_preview_lines_marked(
    s: &EditableSettings,
    focus_tile: Option<usize>,
    audio_tile: Option<usize>,
) -> Vec<Line<'static>> {
    let mut out = Vec::<Line<'static>>::new();
    out.push(Line::from(vec![
        Span::styled("Layout: ", Style::default().add_modifier(Modifier::BOLD)),
        Span::raw(s.layout_code.clone()),
    ]));
    out.push(Line::from(vec![
        Span::styled("Legend: ", Style::default().add_modifier(Modifier::BOLD)),
        Span::raw("dark gray = focused tile, dark blue = audio tile"),
    ]));
    out.push(Line::from(""));
    for row in layout_ascii_rows(&s.layout_code) {
        out.push(colored_layout_line_with_marks(row, focus_tile, audio_tile));
    }
    out.push(Line::from(""));
    out.push(Line::from(Span::styled(
        "Tile folders",
        Style::default().add_modifier(Modifier::BOLD),
    )));
    let tile_count = s
        .tile_folders
        .len()
        .max(layout_tile_count(&s.layout_code).unwrap_or(0));
    for i in 0..tile_count {
        let folder = s
            .tile_folders
            .get(i)
            .cloned()
            .unwrap_or_else(|| "(empty)".to_string());
        let mut style = tile_style(i);
        if Some(i) == focus_tile {
            style = style.bg(Color::DarkGray);
        }
        if Some(i) == audio_tile {
            style = style.bg(Color::Blue);
        }
        out.push(Line::from(vec![
            Span::raw(format!("Tile {:>2}: ", i + 1)),
            Span::styled(folder, style),
        ]));
    }
    out
}

fn tui_settings_editor_pick(
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    s: &EditableSettings,
    options: &[String],
    mut selected: usize,
) -> Result<Option<usize>, String> {
    if options.is_empty() {
        return Ok(None);
    }
    loop {
        terminal
            .draw(|f| {
                let size = f.area();
                let v = Layout::default()
                    .direction(Direction::Vertical)
                    .constraints([
                        Constraint::Length(3),
                        Constraint::Min(5),
                        Constraint::Length(2),
                    ])
                    .split(size);
                let h = Layout::default()
                    .direction(Direction::Horizontal)
                    .constraints([Constraint::Percentage(52), Constraint::Percentage(48)])
                    .split(v[1]);

                let header = Paragraph::new(Line::from(vec![
                    Span::styled(
                        "Settings Editor",
                        Style::default()
                            .fg(Color::Cyan)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::raw("  Edit one thing at a time"),
                ]))
                .alignment(Alignment::Center)
                .block(
                    Block::default()
                        .borders(Borders::ALL)
                        .padding(Padding::horizontal(1)),
                );
                f.render_widget(header, v[0]);

                let rows: Vec<ListItem<'_>> = options
                    .iter()
                    .map(|s| ListItem::new(Line::from(s.clone())))
                    .collect();
                let list = List::new(rows)
                    .block(
                        Block::default()
                            .borders(Borders::ALL)
                            .title("Fields")
                            .padding(Padding::horizontal(1)),
                    )
                    .highlight_style(
                        Style::default()
                            .fg(Color::Black)
                            .bg(Color::White)
                            .add_modifier(Modifier::BOLD),
                    )
                    .highlight_symbol(">> ");
                let mut st = ListState::default();
                st.select(Some(selected.min(options.len().saturating_sub(1))));
                f.render_stateful_widget(list, h[0], &mut st);

                let preview = Paragraph::new(settings_preview_lines(s))
                    .wrap(Wrap { trim: false })
                    .block(
                        Block::default()
                            .borders(Borders::ALL)
                            .title("Preview")
                            .padding(Padding::horizontal(1)),
                    );
                f.render_widget(preview, h[1]);

                render_footer(
                    f,
                    v[2],
                    "Up/Down move, Enter edit, Esc back. Colors map tiles to folder names.",
                );
            })
            .map_err(|e| e.to_string())?;

        if !event::poll(Duration::from_millis(120)).map_err(|e| e.to_string())? {
            continue;
        }
        let ev = event::read().map_err(|e| e.to_string())?;
        let Event::Key(key) = ev else {
            continue;
        };
        if key.kind != KeyEventKind::Press {
            continue;
        }
        match key.code {
            KeyCode::Up | KeyCode::Char('k') => {
                selected = (selected + options.len() - 1) % options.len();
            }
            KeyCode::Down | KeyCode::Char('j') => {
                selected = (selected + 1) % options.len();
            }
            KeyCode::Enter => return Ok(Some(selected)),
            KeyCode::Esc | KeyCode::Char('q') | KeyCode::Char('b') => return Ok(None),
            _ => {}
        }
    }
}

fn tui_select_index(
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    title: &str,
    subtitle: &str,
    options: &[String],
    mut selected: usize,
) -> Result<Option<usize>, String> {
    if options.is_empty() {
        return Ok(None);
    }
    loop {
        terminal
            .draw(|f| {
                let size = f.area();
                let chunks = Layout::default()
                    .direction(Direction::Vertical)
                    .constraints([
                        Constraint::Length(3),
                        Constraint::Min(5),
                        Constraint::Length(2),
                    ])
                    .split(size);
                let header = Paragraph::new(Line::from(vec![
                    Span::styled(
                        title.to_string(),
                        Style::default()
                            .fg(Color::Cyan)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::raw(format!("  {subtitle}")),
                ]))
                .alignment(Alignment::Center)
                .block(
                    Block::default()
                        .borders(Borders::ALL)
                        .padding(Padding::horizontal(1)),
                );
                f.render_widget(header, chunks[0]);
                render_menu_list(
                    chunks[1],
                    f,
                    title,
                    &options.iter().map(String::as_str).collect::<Vec<_>>(),
                    selected,
                );
                render_footer(
                    f,
                    chunks[2],
                    "Up/Down to move, Enter to select, Esc to cancel",
                );
            })
            .map_err(|e| e.to_string())?;
        if !event::poll(Duration::from_millis(120)).map_err(|e| e.to_string())? {
            continue;
        }
        let ev = event::read().map_err(|e| e.to_string())?;
        let Event::Key(key) = ev else {
            continue;
        };
        if key.kind != KeyEventKind::Press {
            continue;
        }
        match key.code {
            KeyCode::Up | KeyCode::Char('k') => {
                selected = (selected + options.len() - 1) % options.len();
            }
            KeyCode::Down | KeyCode::Char('j') => {
                selected = (selected + 1) % options.len();
            }
            KeyCode::Enter => return Ok(Some(selected)),
            KeyCode::Esc | KeyCode::Char('q') | KeyCode::Char('b') => return Ok(None),
            _ => {}
        }
    }
}

fn tui_select_index_with_preview(
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    title: &str,
    subtitle: &str,
    options: &[String],
    previews: &[String],
    mut selected: usize,
) -> Result<Option<usize>, String> {
    if options.is_empty() {
        return Ok(None);
    }
    loop {
        terminal
            .draw(|f| {
                let size = f.area();
                let chunks = Layout::default()
                    .direction(Direction::Vertical)
                    .constraints([
                        Constraint::Length(3),
                        Constraint::Min(5),
                        Constraint::Length(2),
                    ])
                    .split(size);
                let body = Layout::default()
                    .direction(Direction::Horizontal)
                    .constraints([Constraint::Percentage(52), Constraint::Percentage(48)])
                    .split(chunks[1]);
                let header = Paragraph::new(Line::from(vec![
                    Span::styled(
                        title.to_string(),
                        Style::default()
                            .fg(Color::Cyan)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::raw(format!("  {subtitle}")),
                ]))
                .alignment(Alignment::Center)
                .block(
                    Block::default()
                        .borders(Borders::ALL)
                        .padding(Padding::horizontal(1)),
                );
                f.render_widget(header, chunks[0]);

                render_menu_list(
                    body[0],
                    f,
                    title,
                    &options.iter().map(String::as_str).collect::<Vec<_>>(),
                    selected,
                );
                let preview_text = previews
                    .get(selected)
                    .cloned()
                    .unwrap_or_else(|| "".to_string());
                let preview = Paragraph::new(preview_text)
                    .wrap(Wrap { trim: false })
                    .block(
                        Block::default()
                            .borders(Borders::ALL)
                            .title("Preview")
                            .padding(Padding::horizontal(1)),
                    );
                f.render_widget(preview, body[1]);
                render_footer(
                    f,
                    chunks[2],
                    "Up/Down to move, Enter to select, Esc to cancel",
                );
            })
            .map_err(|e| e.to_string())?;
        if !event::poll(Duration::from_millis(120)).map_err(|e| e.to_string())? {
            continue;
        }
        let ev = event::read().map_err(|e| e.to_string())?;
        let Event::Key(key) = ev else {
            continue;
        };
        if key.kind != KeyEventKind::Press {
            continue;
        }
        match key.code {
            KeyCode::Up | KeyCode::Char('k') => {
                selected = (selected + options.len() - 1) % options.len()
            }
            KeyCode::Down | KeyCode::Char('j') => selected = (selected + 1) % options.len(),
            KeyCode::Enter => return Ok(Some(selected)),
            KeyCode::Esc | KeyCode::Char('q') | KeyCode::Char('b') => return Ok(None),
            _ => {}
        }
    }
}

fn tui_select_value(
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    title: &str,
    subtitle: &str,
    options: &[&str],
    selected: usize,
) -> Result<Option<String>, String> {
    let opts = options.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    let picked = tui_select_index(terminal, title, subtitle, &opts, selected)?;
    Ok(picked.and_then(|i| opts.get(i).cloned()))
}

fn tui_select_value_with_preview(
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    title: &str,
    subtitle: &str,
    options: &[&str],
    previews: &[&str],
    selected: usize,
) -> Result<Option<String>, String> {
    let opts = options.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    let p = previews.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    let picked = tui_select_index_with_preview(terminal, title, subtitle, &opts, &p, selected)?;
    Ok(picked.and_then(|i| opts.get(i).cloned()))
}

fn tui_select_value_with_preview_owned(
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    title: &str,
    subtitle: &str,
    options: &[String],
    previews: &[String],
    selected: usize,
) -> Result<Option<String>, String> {
    let picked =
        tui_select_index_with_preview(terminal, title, subtitle, options, previews, selected)?;
    Ok(picked.and_then(|i| options.get(i).cloned()))
}

fn tui_select_index_with_settings_preview(
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    title: &str,
    subtitle: &str,
    options: &[String],
    s: &EditableSettings,
    mut selected: usize,
    audio_tile: Option<usize>,
) -> Result<Option<usize>, String> {
    if options.is_empty() {
        return Ok(None);
    }
    loop {
        terminal
            .draw(|f| {
                let size = f.area();
                let chunks = Layout::default()
                    .direction(Direction::Vertical)
                    .constraints([
                        Constraint::Length(3),
                        Constraint::Min(5),
                        Constraint::Length(2),
                    ])
                    .split(size);
                let body = Layout::default()
                    .direction(Direction::Horizontal)
                    .constraints([Constraint::Percentage(52), Constraint::Percentage(48)])
                    .split(chunks[1]);
                let header = Paragraph::new(Line::from(vec![
                    Span::styled(
                        title.to_string(),
                        Style::default()
                            .fg(Color::Cyan)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::raw(format!("  {subtitle}")),
                ]))
                .alignment(Alignment::Center)
                .block(
                    Block::default()
                        .borders(Borders::ALL)
                        .padding(Padding::horizontal(1)),
                );
                f.render_widget(header, chunks[0]);

                render_menu_list(
                    body[0],
                    f,
                    title,
                    &options.iter().map(String::as_str).collect::<Vec<_>>(),
                    selected,
                );
                let preview = Paragraph::new(settings_preview_lines_marked(
                    s,
                    Some(selected.min(s.tile_folders.len().saturating_sub(1))),
                    audio_tile,
                ))
                .wrap(Wrap { trim: false })
                .block(
                    Block::default()
                        .borders(Borders::ALL)
                        .title("Preview")
                        .padding(Padding::horizontal(1)),
                );
                f.render_widget(preview, body[1]);
                render_footer(f, chunks[2], "Up/Down move, Enter select, Esc cancel");
            })
            .map_err(|e| e.to_string())?;
        if !event::poll(Duration::from_millis(120)).map_err(|e| e.to_string())? {
            continue;
        }
        let ev = event::read().map_err(|e| e.to_string())?;
        let Event::Key(key) = ev else {
            continue;
        };
        if key.kind != KeyEventKind::Press {
            continue;
        }
        match key.code {
            KeyCode::Up | KeyCode::Char('k') => {
                selected = (selected + options.len() - 1) % options.len()
            }
            KeyCode::Down | KeyCode::Char('j') => selected = (selected + 1) % options.len(),
            KeyCode::Enter => return Ok(Some(selected)),
            KeyCode::Esc | KeyCode::Char('q') | KeyCode::Char('b') => return Ok(None),
            _ => {}
        }
    }
}

fn tui_multi_select_indexes(
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    title: &str,
    subtitle: &str,
    options: &[String],
) -> Result<Option<Vec<usize>>, String> {
    tui_multi_select_indexes_with_initial(terminal, title, subtitle, options, &[])
}

fn tui_multi_select_indexes_with_initial(
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    title: &str,
    subtitle: &str,
    options: &[String],
    initial_selected: &[usize],
) -> Result<Option<Vec<usize>>, String> {
    if options.is_empty() {
        return Ok(None);
    }
    let mut cursor = 0usize;
    let mut selected = vec![false; options.len()];
    for idx in initial_selected {
        if *idx < selected.len() {
            selected[*idx] = true;
            cursor = *idx;
        }
    }
    loop {
        terminal
            .draw(|f| {
                let size = f.area();
                let chunks = Layout::default()
                    .direction(Direction::Vertical)
                    .constraints([
                        Constraint::Length(3),
                        Constraint::Min(5),
                        Constraint::Length(2),
                    ])
                    .split(size);
                let header = Paragraph::new(Line::from(vec![
                    Span::styled(
                        title.to_string(),
                        Style::default()
                            .fg(Color::Cyan)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::raw(format!("  {subtitle}")),
                ]))
                .alignment(Alignment::Center)
                .block(
                    Block::default()
                        .borders(Borders::ALL)
                        .padding(Padding::horizontal(1)),
                );
                f.render_widget(header, chunks[0]);

                let rows: Vec<ListItem<'_>> = options
                    .iter()
                    .enumerate()
                    .map(|(i, s)| {
                        let mark = if selected[i] { "[x]" } else { "[ ]" };
                        ListItem::new(Line::from(format!("{mark} {s}")))
                    })
                    .collect();
                let list = List::new(rows)
                    .block(
                        Block::default()
                            .borders(Borders::ALL)
                            .title(title)
                            .padding(Padding::horizontal(1)),
                    )
                    .highlight_style(
                        Style::default()
                            .fg(Color::Black)
                            .bg(Color::White)
                            .add_modifier(Modifier::BOLD),
                    )
                    .highlight_symbol(">> ");
                let mut st = ListState::default();
                st.select(Some(cursor.min(options.len().saturating_sub(1))));
                f.render_stateful_widget(list, chunks[1], &mut st);
                render_footer(
                    f,
                    chunks[2],
                    "Up/Down move, Space toggle, Enter confirm, Esc cancel",
                );
            })
            .map_err(|e| e.to_string())?;
        if !event::poll(Duration::from_millis(120)).map_err(|e| e.to_string())? {
            continue;
        }
        let ev = event::read().map_err(|e| e.to_string())?;
        let Event::Key(key) = ev else {
            continue;
        };
        if key.kind != KeyEventKind::Press {
            continue;
        }
        match key.code {
            KeyCode::Up | KeyCode::Char('k') => {
                cursor = (cursor + options.len() - 1) % options.len()
            }
            KeyCode::Down | KeyCode::Char('j') => cursor = (cursor + 1) % options.len(),
            KeyCode::Char(' ') => selected[cursor] = !selected[cursor],
            KeyCode::Enter => {
                let mut picked = selected
                    .iter()
                    .enumerate()
                    .filter_map(|(i, on)| if *on { Some(i) } else { None })
                    .collect::<Vec<_>>();
                if picked.is_empty() {
                    picked.push(cursor);
                }
                return Ok(Some(picked));
            }
            KeyCode::Esc | KeyCode::Char('q') | KeyCode::Char('b') => return Ok(None),
            _ => {}
        }
    }
}

fn tui_input_text(
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    title: &str,
    prompt: &str,
    initial: &str,
) -> Result<Option<String>, String> {
    let mut value = initial.to_string();
    loop {
        terminal
            .draw(|f| {
                let size = f.area();
                let chunks = Layout::default()
                    .direction(Direction::Vertical)
                    .constraints([
                        Constraint::Length(3),
                        Constraint::Length(5),
                        Constraint::Min(3),
                        Constraint::Length(2),
                    ])
                    .split(size);
                let header = Paragraph::new(Line::from(vec![Span::styled(
                    title.to_string(),
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                )]))
                .alignment(Alignment::Center)
                .block(
                    Block::default()
                        .borders(Borders::ALL)
                        .padding(Padding::horizontal(1)),
                );
                f.render_widget(header, chunks[0]);

                let input = Paragraph::new(vec![
                    Line::from(prompt.to_string()),
                    Line::from(""),
                    Line::from(value.clone()),
                ])
                .wrap(Wrap { trim: false })
                .block(
                    Block::default()
                        .borders(Borders::ALL)
                        .title("Custom Input")
                        .padding(Padding::horizontal(1)),
                );
                f.render_widget(input, chunks[1]);
                render_footer(
                    f,
                    chunks[3],
                    "Type for custom value, Enter confirm, Esc cancel",
                );
            })
            .map_err(|e| e.to_string())?;

        if !event::poll(Duration::from_millis(120)).map_err(|e| e.to_string())? {
            continue;
        }
        let ev = event::read().map_err(|e| e.to_string())?;
        let Event::Key(key) = ev else {
            continue;
        };
        if key.kind != KeyEventKind::Press {
            continue;
        }
        match key.code {
            KeyCode::Enter => return Ok(Some(value.trim().to_string())),
            KeyCode::Esc => return Ok(None),
            KeyCode::Backspace => {
                value.pop();
            }
            KeyCode::Char(c) => value.push(c),
            _ => {}
        }
    }
}

fn tui_confirm(
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    title: &str,
    prompt: &str,
    default_yes: bool,
) -> Result<Option<bool>, String> {
    let options = vec!["Yes".to_string(), "No".to_string()];
    let selected = if default_yes { 0 } else { 1 };
    let picked = tui_select_index(terminal, title, prompt, &options, selected)?;
    Ok(picked.map(|idx| idx == 0))
}

fn tui_show_text(
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    title: &str,
    text: &str,
) -> Result<(), String> {
    let lines: Vec<Line<'static>> = text.lines().map(|l| Line::from(l.to_string())).collect();
    let mut scroll: u16 = 0;
    let mut body_height: u16 = 0;
    loop {
        terminal
            .draw(|f| {
                let size = f.area();
                let chunks = Layout::default()
                    .direction(Direction::Vertical)
                    .constraints([
                        Constraint::Length(3),
                        Constraint::Min(5),
                        Constraint::Length(2),
                    ])
                    .split(size);
                body_height = chunks[1].height;
                let header = Paragraph::new(Line::from(vec![Span::styled(
                    title.to_string(),
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                )]))
                .alignment(Alignment::Center)
                .block(
                    Block::default()
                        .borders(Borders::ALL)
                        .padding(Padding::horizontal(1)),
                );
                f.render_widget(header, chunks[0]);
                let body = Paragraph::new(lines.clone())
                    .wrap(Wrap { trim: false })
                    .scroll((scroll, 0))
                    .block(
                        Block::default()
                            .borders(Borders::ALL)
                            .title("Output")
                            .padding(Padding::new(1, 1, 1, 1)),
                    );
                f.render_widget(body, chunks[1]);
                render_footer(
                    f,
                    chunks[2],
                    "Up/Down PgUp/PgDn Home/End scroll, Enter/Esc to return",
                );
            })
            .map_err(|e| e.to_string())?;
        if !event::poll(Duration::from_millis(120)).map_err(|e| e.to_string())? {
            continue;
        }
        let ev = event::read().map_err(|e| e.to_string())?;
        let Event::Key(key) = ev else {
            continue;
        };
        if key.kind != KeyEventKind::Press {
            continue;
        }
        match key.code {
            KeyCode::Up | KeyCode::Char('k') => scroll = scroll.saturating_sub(1),
            KeyCode::Down | KeyCode::Char('j') => scroll = scroll.saturating_add(1),
            KeyCode::PageUp => scroll = scroll.saturating_sub(10),
            KeyCode::PageDown => scroll = scroll.saturating_add(10),
            KeyCode::Home => scroll = 0,
            KeyCode::End => scroll = paragraph_max_scroll(lines.len(), body_height),
            KeyCode::Enter | KeyCode::Esc | KeyCode::Char('q') | KeyCode::Char('b') => {
                return Ok(())
            }
            _ => {}
        }
        scroll = scroll.min(paragraph_max_scroll(lines.len(), body_height));
    }
}

fn run_subcommand_in_tui(
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    subcommand: &str,
    args: &[OsString],
) -> Result<i32, String> {
    let exe = env::current_exe().map_err(|e| e.to_string())?;
    let mut child = Command::new(exe)
        .arg(subcommand)
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to capture stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "failed to capture stderr".to_string())?;

    let (tx, rx) = mpsc::channel::<String>();
    let tx_out = tx.clone();
    let tx_err = tx.clone();
    let mut out_handle = Some(thread::spawn(move || {
        let mut reader = stdout;
        let mut buf = [0_u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                    if tx_out.send(chunk).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    }));
    let mut err_handle = Some(thread::spawn(move || {
        let mut reader = stderr;
        let mut buf = [0_u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                    if tx_err.send(chunk).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    }));

    let mut text = String::new();
    text.push_str(&format!("$ tiles {subcommand}"));
    for a in args {
        text.push(' ');
        text.push_str(&a.to_string_lossy());
    }
    text.push_str("\n\n");

    let mut scroll: u16 = 0;
    let mut follow = true;
    let mut running = true;
    let mut code = 1_i32;
    let spinner = ["|", "/", "-", "\\"];
    let mut spin_idx = 0_usize;
    let mut wrote_log = false;
    let mut body_height: u16 = 0;

    loop {
        while let Ok(chunk) = rx.try_recv() {
            text.push_str(&chunk);
        }

        if running {
            if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                running = false;
                code = status.code().unwrap_or(1);
                if let Some(h) = out_handle.take() {
                    let _ = h.join();
                }
                if let Some(h) = err_handle.take() {
                    let _ = h.join();
                }
                while let Ok(chunk) = rx.try_recv() {
                    text.push_str(&chunk);
                }
            }
        }

        if !running && !wrote_log {
            let root = find_repo_root()
                .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
            let log_dir = root.join("outputs").join("tui-logs");
            let log_status: Option<String> = if fs::create_dir_all(&log_dir).is_ok() {
                let ts = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let log_path = log_dir.join(format!("tui_{subcommand}_run_{ts}.log"));
                match fs::write(&log_path, text.clone()) {
                    Ok(_) => Some(format!("Log written: {}", log_path.display())),
                    Err(err) => Some(format!(
                        "warning: failed writing log {}: {err}",
                        log_path.display()
                    )),
                }
            } else {
                Some(format!(
                    "warning: failed creating log dir {}",
                    log_dir.display()
                ))
            };
            if let Some(status) = log_status {
                text.push('\n');
                text.push_str(&status);
                text.push('\n');
            }
            text.push_str(&format!("\n[exit code: {code}]\n"));
            wrote_log = true;
        }

        let status_title = if running {
            format!(
                "Running {} {}",
                subcommand,
                spinner[spin_idx % spinner.len()]
            )
        } else {
            format!("Run: {subcommand} (done, exit code {code})")
        };
        spin_idx = spin_idx.wrapping_add(1);
        let display_text = text.replace('\r', "\n");
        let lines: Vec<Line<'static>> = display_text
            .lines()
            .map(|l| Line::from(l.to_string()))
            .collect();

        terminal
            .draw(|f| {
                let size = f.area();
                let chunks = Layout::default()
                    .direction(Direction::Vertical)
                    .constraints([
                        Constraint::Length(3),
                        Constraint::Min(5),
                        Constraint::Length(2),
                    ])
                    .split(size);
                body_height = chunks[1].height;
                let header = Paragraph::new(Line::from(vec![Span::styled(
                    status_title.clone(),
                    Style::default()
                        .fg(if running { Color::Yellow } else { Color::Cyan })
                        .add_modifier(Modifier::BOLD),
                )]))
                .alignment(Alignment::Center)
                .block(
                    Block::default()
                        .borders(Borders::ALL)
                        .padding(Padding::horizontal(1)),
                );
                f.render_widget(header, chunks[0]);
                let body = Paragraph::new(lines.clone())
                    .wrap(Wrap { trim: false })
                    .scroll((scroll, 0))
                    .block(
                        Block::default()
                            .borders(Borders::ALL)
                            .title("Output")
                            .padding(Padding::new(1, 1, 1, 1)),
                    );
                f.render_widget(body, chunks[1]);
                let footer = if running {
                    "Live output. Up/Down PgUp/PgDn Home/End scroll, End follow, q stop"
                } else {
                    "Up/Down PgUp/PgDn Home/End scroll, Enter/Esc to return"
                };
                render_footer(f, chunks[2], footer);
            })
            .map_err(|e| e.to_string())?;

        let max_scroll = paragraph_max_scroll(lines.len(), body_height);
        if follow {
            scroll = max_scroll;
        } else {
            scroll = scroll.min(max_scroll);
        }

        if !event::poll(Duration::from_millis(120)).map_err(|e| e.to_string())? {
            continue;
        }
        let ev = event::read().map_err(|e| e.to_string())?;
        let Event::Key(key) = ev else {
            continue;
        };
        if key.kind != KeyEventKind::Press {
            continue;
        }
        match key.code {
            KeyCode::Up | KeyCode::Char('k') => {
                follow = false;
                scroll = scroll.saturating_sub(1);
            }
            KeyCode::Down | KeyCode::Char('j') => {
                follow = false;
                scroll = scroll.saturating_add(1);
            }
            KeyCode::PageUp => {
                follow = false;
                scroll = scroll.saturating_sub(10);
            }
            KeyCode::PageDown => {
                follow = false;
                scroll = scroll.saturating_add(10);
            }
            KeyCode::Home => {
                follow = false;
                scroll = 0;
            }
            KeyCode::End => {
                follow = true;
                scroll = max_scroll;
            }
            KeyCode::Char('q') => {
                if running {
                    let _ = child.kill();
                    if let Ok(status) = child.wait() {
                        running = false;
                        code = status.code().unwrap_or(1);
                        if let Some(h) = out_handle.take() {
                            let _ = h.join();
                        }
                        if let Some(h) = err_handle.take() {
                            let _ = h.join();
                        }
                        while let Ok(chunk) = rx.try_recv() {
                            text.push_str(&chunk);
                        }
                    }
                } else {
                    return Ok(code);
                }
            }
            KeyCode::Enter | KeyCode::Esc | KeyCode::Char('b') => {
                if !running {
                    return Ok(code);
                }
            }
            _ => {}
        }
        if !follow {
            scroll = scroll.min(max_scroll);
        }
    }
}

fn paragraph_max_scroll(line_count: usize, paragraph_height: u16) -> u16 {
    let visible_rows = paragraph_height.saturating_sub(2).max(1) as usize;
    let max_scroll = line_count.saturating_sub(visible_rows);
    max_scroll.min(u16::MAX as usize) as u16
}

fn tui_pick_folders(
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    root: Option<&Path>,
    title: &str,
) -> Result<Option<Vec<OsString>>, String> {
    let mode_options = vec![
        "Select from src/".to_string(),
        "Select from src/ (include subdirs)".to_string(),
        "Enter folder path(s)".to_string(),
        "Back".to_string(),
    ];
    let mode = tui_select_index(terminal, title, "Folder source", &mode_options, 0)?;
    let Some(mode) = mode else {
        return Ok(None);
    };
    match mode {
        0 | 1 => {
            let Some(r) = root else {
                let raw = tui_input_text(
                    terminal,
                    title,
                    "Project root not found. Enter folder paths (comma-separated)",
                    "",
                )?;
                let Some(raw) = raw else {
                    return Ok(None);
                };
                let parsed = parse_csv_paths(&raw);
                return Ok(Some(parsed));
            };
            let recursive = mode == 1;
            let folders = collect_src_folder_entries(r, recursive);
            if folders.is_empty() {
                let raw = tui_input_text(
                    terminal,
                    title,
                    "No folders found in src/. Enter folder paths (comma-separated)",
                    "",
                )?;
                let Some(raw) = raw else {
                    return Ok(None);
                };
                let parsed = parse_csv_paths(&raw);
                return Ok(Some(parsed));
            }
            let labels = folders
                .iter()
                .map(|(label, _)| label.clone())
                .collect::<Vec<_>>();
            let picked =
                tui_multi_select_indexes(terminal, title, "Select one or more folders", &labels)?;
            let Some(picked) = picked else {
                return Ok(None);
            };
            let selected = picked
                .into_iter()
                .filter_map(|i| folders.get(i))
                .map(|(_, value)| OsString::from(value))
                .collect::<Vec<_>>();
            Ok(Some(selected))
        }
        2 => {
            let raw = tui_input_text(terminal, title, "Enter folder paths (comma-separated)", "")?;
            let Some(raw) = raw else {
                return Ok(None);
            };
            Ok(Some(parse_csv_paths(&raw)))
        }
        _ => Ok(None),
    }
}

fn tui_source_output_dir(root: Option<&Path>, folders: &[OsString]) -> Option<PathBuf> {
    let first = folders.first()?;
    let first_str = first.to_string_lossy();
    let base = if let Some(r) = root {
        resolve_folder_path(r, &first_str)
    } else {
        PathBuf::from(first_str.as_ref())
    };
    Some(base.join("outputs"))
}

fn tui_display_path(root: Option<&Path>, path: &Path) -> String {
    if let Some(r) = root {
        if let Ok(rel) = path.strip_prefix(r) {
            return rel.to_string_lossy().replace('\\', "/");
        }
    }
    path.to_string_lossy().replace('\\', "/")
}

fn build_source_output_token(subdir: &str) -> String {
    let trimmed = subdir.trim();
    if trimmed.is_empty() || trimmed == "outputs" {
        SOURCE_OUTPUT_TOKEN.to_string()
    } else {
        format!("{SOURCE_OUTPUT_TOKEN}:{trimmed}")
    }
}

fn parse_source_output_token(output: &str) -> Option<String> {
    if output == SOURCE_OUTPUT_TOKEN {
        return Some("outputs".to_string());
    }
    if let Some(rest) = output.strip_prefix(&format!("{SOURCE_OUTPUT_TOKEN}:")) {
        let trimmed = rest.trim();
        if trimmed.is_empty() {
            return Some("outputs".to_string());
        }
        return Some(trimmed.to_string());
    }
    None
}

fn parse_alongside_token(output: &str) -> bool {
    output == ALONGSIDE_TOKEN
}

fn normalize_source_output_choice(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(rest) = trimmed.strip_prefix("source/") {
        let rest = rest.trim();
        let rest = rest.split(" (").next().unwrap_or("").trim();
        let subdir = if rest.is_empty() { "outputs" } else { rest };
        return Some(build_source_output_token(subdir));
    }
    Some(trimmed.to_string())
}

fn tui_pick_custom_output_dir(
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    title: &str,
    default: &str,
) -> Result<Option<String>, String> {
    let use_default = tui_confirm(terminal, title, "Use default output directory?", true)?;
    let Some(use_default) = use_default else {
        return Ok(None);
    };
    if use_default {
        return Ok(Some(default.to_string()));
    }
    tui_input_text(terminal, title, "Custom output directory", default)
}

fn tui_build_run_saved_args(
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    root: Option<&Path>,
) -> Result<Option<Vec<OsString>>, String> {
    let mut args = Vec::<OsString>::new();
    let settings = default_settings_path(root);
    args.push("--settings".into());
    args.push(settings.into());
    let modes = vec![
        "full".to_string(),
        "preview".to_string(),
        "fast-preview".to_string(),
    ];
    let mode = tui_select_index(terminal, "Run Saved Settings", "Render mode", &modes, 0)?;
    let Some(mode) = mode else { return Ok(None) };
    args.push("--render-mode".into());
    args.push(modes[mode].clone().into());
    let overwrite = tui_confirm(
        terminal,
        "Run Saved Settings",
        "Overwrite existing output if it exists?",
        true,
    )?;
    let Some(overwrite) = overwrite else {
        return Ok(None);
    };
    if !overwrite {
        args.push("--no-overwrite".into());
    }
    let force_cfr = tui_confirm(terminal, "Run Saved Settings", "Force CFR?", false)?;
    let Some(force_cfr) = force_cfr else {
        return Ok(None);
    };
    if force_cfr {
        args.push("--force-cfr".into());
    }
    Ok(Some(args))
}

fn tui_build_concat_args(
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    root: Option<&Path>,
) -> Result<Option<Vec<OsString>>, String> {
    let folders = tui_pick_folders(terminal, root, "Concat Videos")?;
    let Some(mut args) = folders else {
        return Ok(None);
    };
    if args.is_empty() {
        return Ok(None);
    }
    let transitions = vec![
        "cut".to_string(),
        "fade".to_string(),
        "fadeblack".to_string(),
        "dissolve".to_string(),
    ];
    let transition = tui_select_index(
        terminal,
        "Concat Videos",
        "Transition type",
        &transitions,
        0,
    )?;
    let Some(transition) = transition else {
        return Ok(None);
    };
    args.push("--transition".into());
    args.push(transitions[transition].clone().into());
    let duration = tui_select_value(
        terminal,
        "Concat Videos",
        "Transition duration",
        &["0.25", "0.5", "1.0", "1.5", "2.0", "custom..."],
        2,
    )?;
    let Some(mut duration) = duration else {
        return Ok(None);
    };
    if duration == "custom..." {
        let d = tui_input_text(
            terminal,
            "Concat Videos",
            "Custom transition duration",
            "1.0",
        )?;
        let Some(d) = d else { return Ok(None) };
        duration = d;
    }
    if !duration.trim().is_empty() {
        args.push("--duration".into());
        args.push(duration.into());
    }
    let mut output_labels = Vec::new();
    let mut output_values = Vec::new();
    if let Some(source_dir) = tui_source_output_dir(root, &args) {
        let display = tui_display_path(root, &source_dir);
        output_labels.push(format!("source/outputs ({display})"));
        output_values.push(SOURCE_OUTPUT_TOKEN.to_string());
    }
    output_labels.extend(
        [
            "outputs/concatenated",
            "outputs/tui-concat",
            "src",
            "custom...",
        ]
        .iter()
        .map(|s| (*s).to_string()),
    );
    output_values.extend(
        [
            "outputs/concatenated",
            "outputs/tui-concat",
            "src",
            "custom...",
        ]
        .iter()
        .map(|s| (*s).to_string()),
    );
    let output = tui_select_index(
        terminal,
        "Concat Videos",
        "Output directory",
        &output_labels,
        0,
    )?;
    let Some(output_idx) = output else {
        return Ok(None);
    };
    let mut output = output_values[output_idx].to_string();
    if output == SOURCE_OUTPUT_TOKEN {
        let subdir = tui_input_text(terminal, "Concat Videos", "Source output subdir", "outputs")?
            .unwrap_or_else(|| "outputs".to_string());
        output = build_source_output_token(&subdir);
    }
    if output == "custom..." {
        let o = tui_pick_custom_output_dir(terminal, "Concat Videos", "outputs/concatenated")?;
        let Some(o) = o else { return Ok(None) };
        output = o;
    }
    if !output.trim().is_empty() {
        args.push("--output".into());
        args.push(output.into());
    }
    Ok(Some(args))
}

fn tui_build_trim_args(
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    root: Option<&Path>,
) -> Result<Option<Vec<OsString>>, String> {
    let folders = tui_pick_folders(terminal, root, "Trim Videos")?;
    let Some(mut args) = folders else {
        return Ok(None);
    };
    if args.is_empty() {
        return Ok(None);
    }
    let start = tui_select_value(
        terminal,
        "Trim Videos",
        "Trim start seconds",
        &["0", "0.1", "0.25", "0.5", "1.0", "2.0", "custom..."],
        0,
    )?;
    let Some(mut start) = start else {
        return Ok(None);
    };
    if start == "custom..." {
        let s = tui_input_text(terminal, "Trim Videos", "Custom trim start", "0")?;
        let Some(s) = s else { return Ok(None) };
        start = s;
    }
    args.push("--start".into());
    args.push(start.into());
    let end = tui_select_value(
        terminal,
        "Trim Videos",
        "Trim end seconds",
        &["0", "0.1", "0.25", "0.5", "1.0", "2.0", "custom..."],
        0,
    )?;
    let Some(mut end) = end else { return Ok(None) };
    if end == "custom..." {
        let e = tui_input_text(terminal, "Trim Videos", "Custom trim end", "0")?;
        let Some(e) = e else { return Ok(None) };
        end = e;
    }
    args.push("--end".into());
    args.push(end.into());
    let mut output_labels = Vec::new();
    let mut output_values = Vec::new();
    if let Some(source_dir) = tui_source_output_dir(root, &args) {
        let display = tui_display_path(root, &source_dir);
        output_labels.push(format!("source/outputs ({display})"));
        output_values.push(SOURCE_OUTPUT_TOKEN.to_string());
    }
    output_labels.extend(
        ["outputs/trimmed", "outputs/tui-trim", "src", "custom..."]
            .iter()
            .map(|s| (*s).to_string()),
    );
    output_values.extend(
        ["outputs/trimmed", "outputs/tui-trim", "src", "custom..."]
            .iter()
            .map(|s| (*s).to_string()),
    );
    let output = tui_select_index(
        terminal,
        "Trim Videos",
        "Output directory",
        &output_labels,
        0,
    )?;
    let Some(output_idx) = output else {
        return Ok(None);
    };
    let mut output = output_values[output_idx].to_string();
    if output == SOURCE_OUTPUT_TOKEN {
        let subdir = tui_input_text(terminal, "Trim Videos", "Source output subdir", "outputs")?
            .unwrap_or_else(|| "outputs".to_string());
        output = build_source_output_token(&subdir);
    }
    if output == "custom..." {
        let o = tui_pick_custom_output_dir(terminal, "Trim Videos", "outputs/trimmed")?;
        let Some(o) = o else { return Ok(None) };
        output = o;
    }
    if !output.trim().is_empty() {
        args.push("--output".into());
        args.push(output.into());
    }
    Ok(Some(args))
}

fn tui_build_detect_args(
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    root: Option<&Path>,
) -> Result<Option<Vec<OsString>>, String> {
    let folders = tui_pick_folders(terminal, root, "Detect Scenes")?;
    let Some(mut args) = folders else {
        return Ok(None);
    };
    if args.is_empty() {
        return Ok(None);
    }
    let threshold = tui_select_value(
        terminal,
        "Detect Scenes",
        "Threshold",
        &["0.15", "0.2", "0.27", "0.35", "0.5", "custom..."],
        2,
    )?;
    let Some(mut threshold) = threshold else {
        return Ok(None);
    };
    if threshold == "custom..." {
        let t = tui_input_text(terminal, "Detect Scenes", "Custom threshold", "0.27")?;
        let Some(t) = t else { return Ok(None) };
        threshold = t;
    }
    args.push("--threshold".into());
    args.push(threshold.into());
    let methods = vec!["content".to_string(), "adaptive".to_string()];
    let method = tui_select_index(terminal, "Detect Scenes", "Method", &methods, 0)?;
    let Some(method) = method else {
        return Ok(None);
    };
    args.push("--method".into());
    args.push(methods[method].clone().into());
    let list_only = tui_confirm(
        terminal,
        "Detect Scenes",
        "List only (do not split)?",
        false,
    )?;
    let Some(list_only) = list_only else {
        return Ok(None);
    };
    if list_only {
        args.push("--list-only".into());
    }
    let mut output_labels = Vec::new();
    let mut output_values = Vec::new();
    if let Some(source_dir) = tui_source_output_dir(root, &args) {
        let display = tui_display_path(root, &source_dir);
        output_labels.push(format!("source/outputs ({display})"));
        output_values.push(SOURCE_OUTPUT_TOKEN.to_string());
    }
    output_labels.extend(
        ["outputs/scenes", "outputs/tui-scenes", "custom..."]
            .iter()
            .map(|s| (*s).to_string()),
    );
    output_values.extend(
        ["outputs/scenes", "outputs/tui-scenes", "custom..."]
            .iter()
            .map(|s| (*s).to_string()),
    );
    let output = tui_select_index(
        terminal,
        "Detect Scenes",
        "Output directory",
        &output_labels,
        0,
    )?;
    let Some(output_idx) = output else {
        return Ok(None);
    };
    let mut output = output_values[output_idx].to_string();
    if output == SOURCE_OUTPUT_TOKEN {
        let subdir = tui_input_text(terminal, "Detect Scenes", "Source output subdir", "outputs")?
            .unwrap_or_else(|| "outputs".to_string());
        output = build_source_output_token(&subdir);
    }
    if output == "custom..." {
        let o = tui_pick_custom_output_dir(terminal, "Detect Scenes", "outputs/scenes")?;
        let Some(o) = o else { return Ok(None) };
        output = o;
    }
    if !output.trim().is_empty() {
        args.push("--output".into());
        args.push(output.into());
    }
    Ok(Some(args))
}

fn tui_build_clean_args(
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    root: Option<&Path>,
) -> Result<Option<Vec<OsString>>, String> {
    let folders = tui_pick_folders(terminal, root, "Clean Folders")?;
    let Some(mut args) = folders else {
        return Ok(None);
    };
    if args.is_empty() {
        return Ok(None);
    }
    let modes = vec!["1".to_string(), "2".to_string(), "3".to_string()];
    let mode = tui_select_index(
        terminal,
        "Clean Folders",
        "Mode: 1 duplicates, 2 rename, 3 both",
        &modes,
        2,
    )?;
    let Some(mode) = mode else { return Ok(None) };
    args.push("--mode".into());
    args.push(modes[mode].clone().into());
    let add_num = tui_confirm(
        terminal,
        "Clean Folders",
        "Add numbering when renaming?",
        false,
    )?;
    let Some(add_num) = add_num else {
        return Ok(None);
    };
    if add_num {
        args.push("--number".into());
    }
    Ok(Some(args))
}

fn tui_build_tile_args(
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    root: Option<&Path>,
) -> Result<Option<Vec<OsString>>, String> {
    let mut args = Vec::<OsString>::new();
    let use_settings = tui_confirm(terminal, "Tile", "Use settings file?", false)?;
    let Some(use_settings) = use_settings else {
        return Ok(None);
    };
    if use_settings {
        let settings = default_settings_path(root);
        args.push("--settings".into());
        args.push(settings.into());
    } else {
        let layout_previews = layout_preview_texts();
        let layout = tui_select_value_with_preview(
            terminal,
            "Tile",
            "Layout",
            &[
                "2x1",
                "1x2",
                "2x2",
                "2x3",
                "3x2",
                "3x1",
                "1x3",
                "4x1",
                "1x4",
                "3x3",
                "2x2-focus",
                "3x3-focus",
                "pip",
                "1+2",
                "2+1",
                "1+3",
                "left-big-right-stack",
                "top-big-bottom-stack",
            ],
            &layout_previews,
            0,
        )?;
        let Some(layout) = layout else {
            return Ok(None);
        };
        args.push("--layout".into());
        args.push(layout.clone().into());

        let folders = tui_pick_folders(terminal, root, "Tile folders")?;
        let Some(folders) = folders else {
            return Ok(None);
        };
        if folders.is_empty() {
            tui_show_text(
                terminal,
                "Tile",
                "No folders selected. Pick at least one folder.",
            )?;
            return Ok(None);
        }
        args.extend(folders);
    }

    let render_mode = tui_select_value(
        terminal,
        "Tile",
        "Render mode",
        &["full", "preview", "fast-preview"],
        0,
    )?;
    let Some(render_mode) = render_mode else {
        return Ok(None);
    };
    args.push("--render-mode".into());
    args.push(render_mode.into());

    let crop_mode = tui_select_value_with_preview(
        terminal,
        "Tile",
        "Crop mode",
        &["crop", "pad", "stretch"],
        &[
            "Fills tile fully.\nCuts edges if aspect differs.",
            "Keeps full frame.\nAdds black bars if needed.",
            "Fills tile by distortion.\nNo bars, no crop.",
        ],
        0,
    )?;
    let Some(crop_mode) = crop_mode else {
        return Ok(None);
    };
    args.push("--crop-mode".into());
    args.push(crop_mode.into());

    let transition = tui_select_value_with_preview(
        terminal,
        "Tile",
        "Transition",
        &["cut", "fade", "fadeblack"],
        &[
            "Hard cut between clips.\nFastest and simplest.",
            "Cross-dissolve between clips.\nSmoother visual blend.",
            "Fade through black between clips.\nMore dramatic pacing.",
        ],
        0,
    )?;
    let Some(transition) = transition else {
        return Ok(None);
    };
    args.push("--transition".into());
    args.push(transition.into());

    let transition_duration = tui_select_value(
        terminal,
        "Tile",
        "Transition duration",
        &["0.25", "0.5", "1.0", "1.5", "2.0"],
        2,
    )?;
    let Some(transition_duration) = transition_duration else {
        return Ok(None);
    };
    args.push("--transition-duration".into());
    args.push(transition_duration.into());

    let speed = tui_select_value(
        terminal,
        "Tile",
        "Speed",
        &["0.5", "0.75", "1.0", "1.25", "1.5", "2.0"],
        2,
    )?;
    let Some(speed) = speed else { return Ok(None) };
    args.push("--speed".into());
    args.push(speed.into());

    let dist = tui_select_value_with_preview(
        terminal,
        "Tile",
        "Distribution mode",
        &[
            "none",
            "round-robin",
            "sequential",
            "random",
            "shuffle-round-robin",
        ],
        &[
            "No redistribution.\nEach tile uses its own folder clips.",
            "Alternates clips across tiles in order.",
            "Contiguous clip blocks per tile.",
            "Random assignment of clips to tiles.",
            "Shuffle first, then round-robin distribute.",
        ],
        0,
    )?;
    let Some(dist) = dist else { return Ok(None) };
    args.push("--distribution-mode".into());
    args.push(dist.into());

    let max_dur = tui_select_value(
        terminal,
        "Tile",
        "Max clip duration",
        &["none", "5", "10", "15", "30", "60"],
        0,
    )?;
    let Some(max_dur) = max_dur else {
        return Ok(None);
    };
    if max_dur != "none" {
        args.push("--max-duration".into());
        args.push(max_dur.into());
    }

    let max_total = tui_select_value(
        terminal,
        "Tile",
        "Max total duration",
        &["none", "30", "60", "90", "120", "180", "300"],
        0,
    )?;
    let Some(max_total) = max_total else {
        return Ok(None);
    };
    if max_total != "none" {
        args.push("--max-total-duration".into());
        args.push(max_total.into());
    }

    let audio = tui_confirm(terminal, "Tile", "Enable audio?", true)?;
    let Some(audio) = audio else { return Ok(None) };
    if !audio {
        args.push("--no-audio".into());
    } else {
        let tiles = tui_select_value(
            terminal,
            "Tile",
            "Audio source tile (zero-based index)",
            &["0", "1", "2", "3", "4", "5", "6", "7", "8"],
            0,
        )?;
        let Some(tiles) = tiles else { return Ok(None) };
        args.push("--audio-tiles".into());
        args.push(tiles.into());
    }

    let no_overwrite = tui_confirm(terminal, "Tile", "No overwrite?", false)?;
    let Some(no_overwrite) = no_overwrite else {
        return Ok(None);
    };
    if no_overwrite {
        args.push("--no-overwrite".into());
    }
    let force_cfr = tui_confirm(terminal, "Tile", "Force CFR?", false)?;
    let Some(force_cfr) = force_cfr else {
        return Ok(None);
    };
    if force_cfr {
        args.push("--force-cfr".into());
    }
    // keep auto output to avoid manual typing
    Ok(Some(args))
}

fn default_editable_settings_for_layout(layout: &str) -> EditableSettings {
    let n = layout_tile_count(layout).unwrap_or(2).max(1);
    EditableSettings {
        layout_code: layout.to_string(),
        crop_mode: "crop".to_string(),
        tile_folders: vec!["".to_string(); n],
        audio_enabled: true,
        audio_tiles: vec![0],
        distribution_mode: None,
        max_total_duration: None,
        max_duration: None,
        tile_settings: (0..n)
            .map(|_| EditableTileSetting {
                trans_type: "cut".to_string(),
                trans_duration: 0.0,
                crop_position: "center".to_string(),
                speed: 1.0,
                mode: "video".to_string(),
                image_duration: 3.0,
                use_landscape: false,
                max_duration: None,
            })
            .collect(),
        sizing_mode: None,
    }
}

fn tui_resolve_settings_path(root: Option<&Path>, raw: &str) -> PathBuf {
    let p = PathBuf::from(raw);
    if p.is_absolute() {
        p
    } else if let Some(r) = root {
        r.join(p)
    } else {
        p
    }
}

fn fmt_opt_secs(v: Option<f64>) -> String {
    v.map(|x| format!("{x:.2}s"))
        .unwrap_or_else(|| "none".to_string())
}

fn settings_menu_labels(s: &EditableSettings) -> Vec<String> {
    let audio_tiles = if s.audio_tiles.is_empty() {
        "none".to_string()
    } else {
        s.audio_tiles
            .iter()
            .map(|v| v.to_string())
            .collect::<Vec<_>>()
            .join(",")
    };
    vec![
        format!("Layout: {}", s.layout_code),
        format!("Crop mode: {}", s.crop_mode),
        format!(
            "Distribution: {}",
            s.distribution_mode
                .clone()
                .unwrap_or_else(|| "none".to_string())
        ),
        format!(
            "Audio enabled: {}",
            if s.audio_enabled { "yes" } else { "no" }
        ),
        format!("Audio tiles: {audio_tiles}"),
        format!("Max total duration: {}", fmt_opt_secs(s.max_total_duration)),
        format!("Default max duration: {}", fmt_opt_secs(s.max_duration)),
        "Edit tile folders".to_string(),
        "Edit per-tile settings".to_string(),
        "Save".to_string(),
        "Save + Run".to_string(),
        "Back".to_string(),
    ]
}

fn tile_settings_menu_labels(ts: &EditableTileSetting, tile_idx: usize) -> Vec<String> {
    vec![
        format!("Tile {} transition: {}", tile_idx + 1, ts.trans_type),
        format!(
            "Tile {} transition duration: {:.2}s",
            tile_idx + 1,
            ts.trans_duration
        ),
        format!("Tile {} crop position: {}", tile_idx + 1, ts.crop_position),
        format!("Tile {} speed: {:.2}", tile_idx + 1, ts.speed),
        format!("Tile {} mode: {}", tile_idx + 1, ts.mode),
        format!(
            "Tile {} image duration: {:.2}s",
            tile_idx + 1,
            ts.image_duration
        ),
        format!(
            "Tile {} use landscape: {}",
            tile_idx + 1,
            if ts.use_landscape { "yes" } else { "no" }
        ),
        format!(
            "Tile {} max duration: {}",
            tile_idx + 1,
            fmt_opt_secs(ts.max_duration)
        ),
        "Back".to_string(),
    ]
}

fn tui_pick_duration_like(
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    title: &str,
    subtitle: &str,
    presets: &[&str],
    default_index: usize,
) -> Result<Option<Option<f64>>, String> {
    let mut opts = presets.iter().map(|x| (*x).to_string()).collect::<Vec<_>>();
    if !opts.iter().any(|x| x == "none") {
        opts.insert(0, "none".to_string());
    }
    if !opts.iter().any(|x| x == "custom...") {
        opts.push("custom...".to_string());
    }
    let picked = tui_select_index(
        terminal,
        title,
        subtitle,
        &opts,
        default_index.min(opts.len().saturating_sub(1)),
    )?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let v = opts[picked].as_str();
    if v == "none" {
        return Ok(Some(None));
    }
    if v == "custom..." {
        let raw = tui_input_text(terminal, title, "Custom value (seconds)", "1.0")?;
        let Some(raw) = raw else { return Ok(None) };
        return Ok(Some(raw.trim().parse::<f64>().ok()));
    }
    Ok(Some(v.parse::<f64>().ok()))
}

fn tui_edit_tile_settings(
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    s: &mut EditableSettings,
) -> Result<(), String> {
    loop {
        let tile_options = (0..s.tile_settings.len())
            .map(|i| format!("Tile {}", i + 1))
            .chain(std::iter::once("Back".to_string()))
            .collect::<Vec<_>>();
        let picked = tui_select_index_with_settings_preview(
            terminal,
            "Settings",
            "Select tile",
            &tile_options,
            s,
            0,
            s.audio_tiles.first().copied(),
        )?;
        let Some(picked) = picked else { return Ok(()) };
        if picked >= s.tile_settings.len() {
            return Ok(());
        }
        let idx = picked;
        loop {
            let labels = tile_settings_menu_labels(&s.tile_settings[idx], idx);
            let action = tui_select_index(terminal, "Tile Settings", "Edit field", &labels, 0)?;
            let Some(action) = action else { break };
            let ts = &mut s.tile_settings[idx];
            match action {
                0 => {
                    let options = vec![
                        "cut".to_string(),
                        "fade".to_string(),
                        "fadeblack".to_string(),
                        "dissolve".to_string(),
                    ];
                    let folder = s
                        .tile_folders
                        .get(idx)
                        .cloned()
                        .unwrap_or_else(|| "(empty)".to_string());
                    let previews = vec![
                        format!(
                            "Tile {} ({folder})\nHard cut between clips.\nFastest behavior.",
                            idx + 1
                        ),
                        format!(
                            "Tile {} ({folder})\nFade via black between clips.\nSmooth joins.",
                            idx + 1
                        ),
                        format!(
                            "Tile {} ({folder})\nFade via black between clips.\nMore cinematic.",
                            idx + 1
                        ),
                        format!(
                            "Tile {} ({folder})\nTrue cross-dissolve blend.\nBoth clips overlap visually.",
                            idx + 1
                        ),
                    ];
                    if let Some(v) = tui_select_value_with_preview_owned(
                        terminal,
                        "Tile Settings",
                        "Transition",
                        &options,
                        &previews,
                        0,
                    )? {
                        ts.trans_type = v;
                    }
                }
                1 => {
                    if let Some(v) = tui_pick_duration_like(
                        terminal,
                        "Tile Settings",
                        "Transition duration",
                        &["0.0", "0.25", "0.5", "1.0", "1.5", "2.0"],
                        3,
                    )? {
                        ts.trans_duration = v.unwrap_or(0.0).max(0.0);
                    }
                }
                2 => {
                    let options = vec![
                        "center".to_string(),
                        "top".to_string(),
                        "bottom".to_string(),
                        "left".to_string(),
                        "right".to_string(),
                        "top-left".to_string(),
                        "top-right".to_string(),
                        "bottom-left".to_string(),
                        "bottom-right".to_string(),
                    ];
                    let previews = vec![
                        "Balanced crop around center.".to_string(),
                        "Keep top of frame; crop bottom first.".to_string(),
                        "Keep bottom of frame; crop top first.".to_string(),
                        "Keep left side; crop right first.".to_string(),
                        "Keep right side; crop left first.".to_string(),
                        "Bias to top-left corner.".to_string(),
                        "Bias to top-right corner.".to_string(),
                        "Bias to bottom-left corner.".to_string(),
                        "Bias to bottom-right corner.".to_string(),
                    ];
                    if let Some(v) = tui_select_value_with_preview_owned(
                        terminal,
                        "Tile Settings",
                        "Crop position",
                        &options,
                        &previews,
                        0,
                    )? {
                        ts.crop_position = v;
                    }
                }
                3 => {
                    if let Some(v) = tui_select_value(
                        terminal,
                        "Tile Settings",
                        "Speed",
                        &["0.5", "0.75", "1.0", "1.25", "1.5", "2.0", "custom..."],
                        2,
                    )? {
                        let raw = if v == "custom..." {
                            tui_input_text(terminal, "Tile Settings", "Custom speed", "1.0")?
                                .unwrap_or_else(|| "1.0".to_string())
                        } else {
                            v
                        };
                        if let Ok(n) = raw.parse::<f64>() {
                            ts.speed = n.max(0.1);
                        }
                    }
                }
                4 => {
                    if let Some(v) =
                        tui_select_value(terminal, "Tile Settings", "Mode", &["video", "image"], 0)?
                    {
                        ts.mode = v;
                    }
                }
                5 => {
                    if let Some(v) = tui_select_value(
                        terminal,
                        "Tile Settings",
                        "Image duration",
                        &["1.0", "2.0", "3.0", "4.0", "5.0", "custom..."],
                        2,
                    )? {
                        let raw = if v == "custom..." {
                            tui_input_text(
                                terminal,
                                "Tile Settings",
                                "Custom image duration",
                                "3.0",
                            )?
                            .unwrap_or_else(|| "3.0".to_string())
                        } else {
                            v
                        };
                        if let Ok(n) = raw.parse::<f64>() {
                            ts.image_duration = n.max(0.1);
                        }
                    }
                }
                6 => {
                    if let Some(v) = tui_confirm(
                        terminal,
                        "Tile Settings",
                        "Use landscape subfolder?",
                        ts.use_landscape,
                    )? {
                        ts.use_landscape = v;
                    }
                }
                7 => {
                    if let Some(v) = tui_pick_duration_like(
                        terminal,
                        "Tile Settings",
                        "Max duration",
                        &["5", "10", "15", "30", "60"],
                        0,
                    )? {
                        ts.max_duration = v;
                    }
                }
                _ => break,
            }
        }
    }
}

fn tui_edit_settings_flow(
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    root: Option<&Path>,
    existing: Option<EditableSettings>,
    settings_path_raw: String,
) -> Result<(), String> {
    let settings_path = tui_resolve_settings_path(root, &settings_path_raw);
    let mut s = existing.unwrap_or_else(|| default_editable_settings_for_layout("2x1"));
    let mut selected = 0usize;
    loop {
        s = normalize_editable_settings(s);
        let labels = settings_menu_labels(&s);
        let picked = tui_settings_editor_pick(terminal, &s, &labels, selected)?;
        let Some(picked) = picked else { return Ok(()) };
        selected = picked;
        match picked {
            0 => {
                let layout_previews = layout_preview_texts();
                if let Some(v) = tui_select_value_with_preview(
                    terminal,
                    "Settings",
                    "Layout",
                    &[
                        "2x1",
                        "1x2",
                        "2x2",
                        "2x3",
                        "3x2",
                        "3x1",
                        "1x3",
                        "4x1",
                        "1x4",
                        "3x3",
                        "2x2-focus",
                        "3x3-focus",
                        "pip",
                        "1+2",
                        "2+1",
                        "1+3",
                        "left-big-right-stack",
                        "top-big-bottom-stack",
                    ],
                    &layout_previews,
                    0,
                )? {
                    s.layout_code = v;
                    s = normalize_editable_settings(s);
                }
            }
            1 => {
                if let Some(v) = tui_select_value(
                    terminal,
                    "Settings",
                    "Crop mode",
                    &["crop", "pad", "stretch"],
                    0,
                )? {
                    s.crop_mode = v;
                }
            }
            2 => {
                if let Some(v) = tui_select_value(
                    terminal,
                    "Settings",
                    "Distribution mode",
                    &[
                        "none",
                        "round-robin",
                        "sequential",
                        "random",
                        "shuffle-round-robin",
                    ],
                    0,
                )? {
                    s.distribution_mode = if v == "none" { None } else { Some(v) };
                }
            }
            3 => {
                if let Some(v) =
                    tui_confirm(terminal, "Settings", "Enable audio?", s.audio_enabled)?
                {
                    s.audio_enabled = v;
                }
            }
            4 => {
                let tile_opts = (0..s.tile_folders.len())
                    .map(|i| format!("Tile {}", i + 1))
                    .collect::<Vec<_>>();
                if let Some(picked) = tui_multi_select_indexes_with_initial(
                    terminal,
                    "Settings",
                    "Audio source tiles",
                    &tile_opts,
                    &s.audio_tiles,
                )? {
                    s.audio_tiles = picked;
                }
            }
            5 => {
                if let Some(v) = tui_pick_duration_like(
                    terminal,
                    "Settings",
                    "Max total duration",
                    &["30", "60", "90", "120", "180", "300"],
                    0,
                )? {
                    s.max_total_duration = v;
                }
            }
            6 => {
                if let Some(v) = tui_pick_duration_like(
                    terminal,
                    "Settings",
                    "Default max duration",
                    &["5", "10", "15", "30", "60"],
                    0,
                )? {
                    s.max_duration = v;
                }
            }
            7 => {
                let mut tile_cursor = 0usize;
                loop {
                    let src_entries = root
                        .map(|r| collect_src_folder_entries(r, true))
                        .unwrap_or_default();
                    let tile_labels = (0..s.tile_folders.len())
                        .map(|i| {
                            let folder = s
                                .tile_folders
                                .get(i)
                                .cloned()
                                .unwrap_or_else(|| "(empty)".to_string());
                            format!("Tile {}: {}", i + 1, folder)
                        })
                        .chain(std::iter::once("Back".to_string()))
                        .collect::<Vec<_>>();
                    let picked_tile = tui_select_index_with_settings_preview(
                        terminal,
                        "Settings",
                        "Edit tile folders",
                        &tile_labels,
                        &s,
                        tile_cursor,
                        s.audio_tiles.first().copied(),
                    )?;
                    let Some(picked_tile) = picked_tile else {
                        break;
                    };
                    if picked_tile >= s.tile_folders.len() {
                        break;
                    }
                    tile_cursor = picked_tile;
                    let i = picked_tile;
                    let current = s.tile_folders.get(i).cloned().unwrap_or_default();

                    let mut opts_labels = Vec::<String>::new();
                    let mut opts_values = Vec::<String>::new();
                    for (label, value) in src_entries {
                        opts_labels.push(label);
                        opts_values.push(value);
                    }
                    if !current.trim().is_empty() && !opts_values.iter().any(|v| v == &current) {
                        opts_labels.insert(0, current.clone());
                        opts_values.insert(0, current.clone());
                    }
                    opts_labels.push("(empty)".to_string());
                    opts_values.push("(empty)".to_string());
                    if !opts_values.iter().any(|v| v == "custom...") {
                        opts_labels.push("custom...".to_string());
                        opts_values.push("custom...".to_string());
                    }
                    let selected_idx = opts_values.iter().position(|x| x == &current).unwrap_or(0);
                    let picked = tui_select_index(
                        terminal,
                        "Settings",
                        &format!("Tile {} folder", i + 1),
                        &opts_labels,
                        selected_idx,
                    )?;
                    let Some(picked) = picked else { continue };
                    let v = opts_values[picked].clone();
                    if v == "(empty)" {
                        s.tile_folders[i] = String::new();
                    } else if v == "custom..." {
                        let custom = tui_input_text(
                            terminal,
                            "Settings",
                            &format!("Custom folder for tile {}", i + 1),
                            &s.tile_folders[i],
                        )?;
                        if let Some(custom) = custom {
                            s.tile_folders[i] = custom;
                        }
                    } else {
                        s.tile_folders[i] = v;
                    }
                }
            }
            8 => tui_edit_tile_settings(terminal, &mut s)?,
            9 => {
                persist_editable_settings(&settings_path, &s)?;
                tui_show_text(
                    terminal,
                    "Settings",
                    &format!("Saved settings: {}", settings_path.display()),
                )?;
            }
            10 => {
                persist_editable_settings(&settings_path, &s)?;
                let mode = tui_select_value(
                    terminal,
                    "Settings",
                    "Render mode",
                    &["full", "preview", "fast-preview"],
                    0,
                )?
                .unwrap_or_else(|| "full".to_string());
                let args = vec![
                    OsString::from("--settings"),
                    OsString::from(settings_path.to_string_lossy().to_string()),
                    OsString::from("--render-mode"),
                    OsString::from(mode),
                ];
                let _ = run_subcommand_in_tui(terminal, "tile", &args)?;
            }
            _ => return Ok(()),
        }
    }
}

fn prompt_line(label: &str, default: Option<&str>) -> String {
    match default {
        Some(d) => print!("{label} [{d}]: "),
        None => print!("{label}: "),
    }
    let _ = io::stdout().flush();
    let mut line = String::new();
    if io::stdin().read_line(&mut line).is_err() {
        return default.unwrap_or("").to_string();
    }
    let raw = line.trim();
    if raw.is_empty() {
        default.unwrap_or("").to_string()
    } else {
        raw.to_string()
    }
}

fn prompt_yes_no(label: &str, default_yes: bool) -> bool {
    let d = if default_yes { "Y/n" } else { "y/N" };
    print!("{label} ({d}): ");
    let _ = io::stdout().flush();
    let mut line = String::new();
    if io::stdin().read_line(&mut line).is_err() {
        return default_yes;
    }
    match line.trim().to_lowercase().as_str() {
        "" => default_yes,
        "y" | "yes" => true,
        "n" | "no" => false,
        _ => default_yes,
    }
}

fn env_truthy(name: &str) -> bool {
    match env::var(name) {
        Ok(v) => {
            let s = v.trim().to_lowercase();
            !(s.is_empty() || s == "0" || s == "false" || s == "no" || s == "off")
        }
        Err(_) => false,
    }
}

#[derive(Debug, Clone)]
struct EditableTileSetting {
    trans_type: String,
    trans_duration: f64,
    crop_position: String,
    speed: f64,
    mode: String,
    image_duration: f64,
    use_landscape: bool,
    max_duration: Option<f64>,
}

#[derive(Debug, Clone)]
struct EditableSettings {
    layout_code: String,
    crop_mode: String,
    tile_folders: Vec<String>,
    audio_enabled: bool,
    audio_tiles: Vec<usize>,
    distribution_mode: Option<String>,
    max_total_duration: Option<f64>,
    max_duration: Option<f64>,
    tile_settings: Vec<EditableTileSetting>,
    sizing_mode: Option<String>,
}

#[derive(Debug, Clone)]
struct SrcFolderInfo {
    rel_name: String,
    images_count: usize,
    landscape_videos_count: usize,
}

fn prompt_optional_f64(label: &str, default: Option<f64>) -> Option<f64> {
    let default_text = default.map(|v| v.to_string()).unwrap_or_default();
    loop {
        let raw = prompt_line(label, Some(&default_text));
        if raw.trim().is_empty() {
            return default;
        }
        match raw.trim().parse::<f64>() {
            Ok(v) if v > 0.0 => return Some(v),
            _ => println!("Please enter a positive number or leave blank."),
        }
    }
}

fn count_files_in_subdir(root: &Path, sub: &str, exts: &[&str]) -> usize {
    let base = root.join(sub);
    let entries = match fs::read_dir(base) {
        Ok(v) => v,
        Err(_) => return 0,
    };
    let mut count = 0usize;
    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        let ext = match p.extension() {
            Some(e) => format!(".{}", e.to_string_lossy().to_lowercase()),
            None => continue,
        };
        if exts.iter().any(|x| *x == ext) {
            count += 1;
        }
    }
    count
}

fn get_src_folders_info(root: &Path) -> Vec<SrcFolderInfo> {
    let mut out = Vec::<SrcFolderInfo>::new();
    let src = root.join("src");
    let entries = match fs::read_dir(&src) {
        Ok(v) => v,
        Err(_) => return out,
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        let rel_name = p
            .strip_prefix(&src)
            .ok()
            .map(|v| v.to_string_lossy().to_string())
            .unwrap_or_else(|| p.to_string_lossy().to_string());
        out.push(SrcFolderInfo {
            rel_name,
            images_count: count_files_in_subdir(&p, "images", IMAGE_EXTENSIONS),
            landscape_videos_count: count_files_in_subdir(&p, "landscape", VIDEO_EXTENSIONS),
        });
    }
    out.sort_by(|a, b| a.rel_name.cmp(&b.rel_name));
    out
}

fn random_u64() -> u64 {
    let mut seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0x9e37_79b9_7f4a_7c15);
    seed ^= seed << 13;
    seed ^= seed >> 7;
    seed ^= seed << 17;
    seed
}

fn random_index(max: usize) -> usize {
    if max <= 1 {
        return 0;
    }
    (random_u64() as usize) % max
}

fn default_settings_path(root: Option<&Path>) -> String {
    if let Ok(path) = env::var("VIDEO_TILING_SETTINGS_PATH") {
        if !path.trim().is_empty() {
            return path;
        }
    }
    match root {
        Some(r) => r
            .join("configs")
            .join("tile_videos_settings.json")
            .to_string_lossy()
            .to_string(),
        None => "configs/tile_videos_settings.json".to_string(),
    }
}

fn editable_from_loaded(mut loaded: LoadedSettings) -> EditableSettings {
    let layout_code = loaded
        .layout_code
        .take()
        .unwrap_or_else(|| "2x1".to_string());
    let tile_count = layout_tile_count(&layout_code).unwrap_or(1);
    let crop_mode = loaded
        .crop_mode
        .take()
        .unwrap_or_else(|| "crop".to_string());

    let mut tile_folders = loaded.tile_folders;
    if tile_folders.is_empty() {
        tile_folders.push("".to_string());
    }
    if tile_folders.len() == 1 && tile_count > 1 {
        tile_folders = vec![tile_folders[0].clone(); tile_count];
    } else {
        tile_folders.truncate(tile_count);
        while tile_folders.len() < tile_count {
            let fill = tile_folders.first().cloned().unwrap_or_default();
            tile_folders.push(fill);
        }
    }

    let mut audio_tiles = if !loaded.audio_tiles.is_empty() {
        loaded.audio_tiles
    } else if let Some(a) = loaded.audio_tile {
        vec![a]
    } else {
        vec![0]
    };
    audio_tiles.retain(|i| *i < tile_count);
    if audio_tiles.is_empty() {
        audio_tiles.push(0);
    }

    let mut tile_settings = Vec::<EditableTileSetting>::new();
    for i in 0..tile_count {
        tile_settings.push(EditableTileSetting {
            trans_type: loaded
                .tile_transitions
                .get(i)
                .cloned()
                .unwrap_or_else(|| "cut".to_string()),
            trans_duration: loaded
                .tile_transition_durations
                .get(i)
                .copied()
                .unwrap_or(0.0),
            crop_position: loaded
                .tile_crop_positions
                .get(i)
                .cloned()
                .unwrap_or_else(|| "center".to_string()),
            speed: loaded.tile_speeds.get(i).copied().unwrap_or(1.0),
            mode: loaded
                .tile_modes
                .get(i)
                .cloned()
                .unwrap_or_else(|| "video".to_string()),
            image_duration: loaded.tile_image_durations.get(i).copied().unwrap_or(3.0),
            use_landscape: loaded.tile_use_landscape.get(i).copied().unwrap_or(false),
            max_duration: loaded.max_durations.get(i).copied().flatten(),
        });
    }

    EditableSettings {
        layout_code,
        crop_mode,
        tile_folders,
        audio_enabled: loaded.audio_enabled.unwrap_or(true),
        audio_tiles,
        distribution_mode: loaded.distribution_mode,
        max_total_duration: loaded.max_total_duration,
        max_duration: loaded.max_duration,
        tile_settings,
        sizing_mode: loaded.sizing_mode,
    }
}

fn run_yolo_tile(root: Option<&Path>) -> Result<i32, String> {
    let root = root.ok_or_else(|| "repo root not found".to_string())?;
    let folders = get_src_folders_info(root);
    if folders.is_empty() {
        return Err("no folders found in src/".to_string());
    }
    let layouts = [
        "2x1", "1x2", "2x2", "3x1", "1x3", "3x3", "pip", "1+2", "2+1", "1+3",
    ];
    let crop_modes = ["crop", "pad", "stretch"];
    let dist_modes = [
        "none",
        "round-robin",
        "sequential",
        "random",
        "shuffle-round-robin",
    ];
    let transitions = ["cut", "fade", "fadeblack"];
    let crop_positions = [
        "center",
        "top",
        "bottom",
        "left",
        "right",
        "top-left",
        "top-right",
        "bottom-left",
        "bottom-right",
    ];
    let speeds = [0.5, 1.0, 1.5];
    let img_durs = [2.0, 3.0, 4.0, 5.0];

    let layout = layouts[random_index(layouts.len())].to_string();
    let n = layout_tile_count(&layout).unwrap_or(1);
    let mut tile_folders = Vec::<String>::new();
    for _ in 0..n {
        tile_folders.push(folders[random_index(folders.len())].rel_name.clone());
    }
    let mut tile_settings = Vec::<EditableTileSetting>::new();
    for i in 0..n {
        let f = folders
            .iter()
            .find(|x| x.rel_name == tile_folders[i])
            .cloned()
            .unwrap_or(SrcFolderInfo {
                rel_name: tile_folders[i].clone(),
                images_count: 0,
                landscape_videos_count: 0,
            });
        let mut mode = "video".to_string();
        if f.images_count > 0 && random_index(4) == 0 {
            mode = "image".to_string();
        }
        let trans_type = if mode == "image" {
            "cut".to_string()
        } else {
            transitions[random_index(transitions.len())].to_string()
        };
        let trans_duration = if trans_type == "cut" {
            0.0
        } else {
            [0.5, 1.0, 1.5, 2.0][random_index(4)]
        };
        let use_landscape = mode == "video" && f.landscape_videos_count > 0 && random_index(2) == 1;
        tile_settings.push(EditableTileSetting {
            trans_type,
            trans_duration,
            crop_position: crop_positions[random_index(crop_positions.len())].to_string(),
            speed: speeds[random_index(speeds.len())],
            mode: mode.clone(),
            image_duration: img_durs[random_index(img_durs.len())],
            use_landscape,
            max_duration: None,
        });
    }

    let picked_dist = dist_modes[random_index(dist_modes.len())].to_string();
    let settings = EditableSettings {
        layout_code: layout,
        crop_mode: crop_modes[random_index(crop_modes.len())].to_string(),
        tile_folders,
        audio_enabled: true,
        audio_tiles: vec![random_index(n)],
        distribution_mode: if picked_dist == "none" {
            None
        } else {
            Some(picked_dist)
        },
        max_total_duration: None,
        max_duration: None,
        tile_settings,
        sizing_mode: None,
    };

    let tmp_dir = root.join("outputs").join("tui-logs");
    fs::create_dir_all(&tmp_dir)
        .map_err(|e| format!("failed creating {}: {e}", tmp_dir.display()))?;
    let temp_settings = tmp_dir.join(format!(
        "tiles_yolo_{}_{}.json",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    ));
    persist_editable_settings(&temp_settings, &settings)?;

    let args = vec![
        OsString::from("--settings"),
        OsString::from(temp_settings.to_string_lossy().to_string()),
        OsString::from("--render-mode"),
        OsString::from("full"),
    ];
    let code = run_tile_logged(&args);
    let _ = fs::remove_file(&temp_settings);
    Ok(code)
}

fn run_tile_logged(args: &[OsString]) -> i32 {
    run_logged_subcommand("tile", args)
}

fn run_logged_subcommand(subcommand: &str, args: &[OsString]) -> i32 {
    let root = find_repo_root()
        .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let log_dir = root.join("outputs").join("tui-logs");
    if let Err(err) = fs::create_dir_all(&log_dir) {
        eprintln!(
            "warning: failed to create log dir {}: {err}",
            log_dir.display()
        );
        return match subcommand {
            "concat" => run_concat(args),
            "trim" => run_trim(args),
            "detect" | "scenes" => run_detect(args),
            "clean" => run_clean(args),
            "strip-audio" => run_strip_audio(args),
            _ => run_tile(args),
        };
    }

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let log_path = log_dir.join(format!("tui_{subcommand}_run_{ts}.log"));

    let exe = match env::current_exe() {
        Ok(v) => v,
        Err(err) => {
            eprintln!("warning: could not resolve current executable: {err}");
            return match subcommand {
                "concat" => run_concat(args),
                "trim" => run_trim(args),
                "detect" | "scenes" => run_detect(args),
                "clean" => run_clean(args),
                "strip-audio" => run_strip_audio(args),
                "chop" => run_chop(args),
                _ => run_tile(args),
            };
        }
    };

    let mut cmd = Command::new(exe);
    cmd.arg(subcommand);
    for a in args {
        cmd.arg(a);
    }
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(v) => v,
        Err(err) => {
            eprintln!("warning: failed running subprocess: {err}");
            return match subcommand {
                "concat" => run_concat(args),
                "trim" => run_trim(args),
                "detect" | "scenes" => run_detect(args),
                "clean" => run_clean(args),
                "strip-audio" => run_strip_audio(args),
                "chop" => run_chop(args),
                _ => run_tile(args),
            };
        }
    };
    let stdout = match child.stdout.take() {
        Some(v) => v,
        None => {
            eprintln!("warning: failed capturing subprocess stdout");
            return match subcommand {
                "concat" => run_concat(args),
                "trim" => run_trim(args),
                "detect" | "scenes" => run_detect(args),
                "clean" => run_clean(args),
                "strip-audio" => run_strip_audio(args),
                "chop" => run_chop(args),
                _ => run_tile(args),
            };
        }
    };
    let stderr = match child.stderr.take() {
        Some(v) => v,
        None => {
            eprintln!("warning: failed capturing subprocess stderr");
            return match subcommand {
                "concat" => run_concat(args),
                "trim" => run_trim(args),
                "detect" | "scenes" => run_detect(args),
                "clean" => run_clean(args),
                "chop" => run_chop(args),
                _ => run_tile(args),
            };
        }
    };

    enum StreamChunk {
        Stdout(String),
        Stderr(String),
    }
    let (tx, rx) = mpsc::channel::<StreamChunk>();
    let tx_out = tx.clone();
    let tx_err = tx.clone();
    let out_handle = thread::spawn(move || {
        let mut reader = stdout;
        let mut buf = [0_u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                    if tx_out.send(StreamChunk::Stdout(chunk)).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
    let err_handle = thread::spawn(move || {
        let mut reader = stderr;
        let mut buf = [0_u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                    if tx_err.send(StreamChunk::Stderr(chunk)).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    let mut all = String::new();
    let status = loop {
        while let Ok(chunk) = rx.try_recv() {
            match chunk {
                StreamChunk::Stdout(s) => {
                    print!("{s}");
                    let _ = io::stdout().flush();
                    all.push_str(&s);
                }
                StreamChunk::Stderr(s) => {
                    eprint!("{s}");
                    let _ = io::stderr().flush();
                    all.push_str(&s);
                }
            }
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                thread::sleep(Duration::from_millis(50));
            }
            Err(err) => {
                eprintln!("warning: failed waiting for subprocess: {err}");
                return 1;
            }
        }
    };
    let _ = out_handle.join();
    let _ = err_handle.join();
    while let Ok(chunk) = rx.try_recv() {
        match chunk {
            StreamChunk::Stdout(s) => {
                print!("{s}");
                let _ = io::stdout().flush();
                all.push_str(&s);
            }
            StreamChunk::Stderr(s) => {
                eprint!("{s}");
                let _ = io::stderr().flush();
                all.push_str(&s);
            }
        }
    }
    if let Err(err) = fs::write(&log_path, all) {
        eprintln!("warning: failed writing log {}: {err}", log_path.display());
    } else {
        println!("Log written: {}", log_path.display());
    }

    status.code().unwrap_or(1)
}

fn normalize_editable_settings(mut s: EditableSettings) -> EditableSettings {
    let tile_count = layout_tile_count(&s.layout_code).unwrap_or(1);
    if s.tile_folders.is_empty() {
        s.tile_folders.push("".to_string());
    }
    if s.tile_folders.len() == 1 && tile_count > 1 {
        s.tile_folders = vec![s.tile_folders[0].clone(); tile_count];
    } else {
        s.tile_folders.truncate(tile_count);
        while s.tile_folders.len() < tile_count {
            let fill = s.tile_folders.first().cloned().unwrap_or_default();
            s.tile_folders.push(fill);
        }
    }

    if s.tile_settings.is_empty() {
        s.tile_settings.push(EditableTileSetting {
            trans_type: "cut".to_string(),
            trans_duration: 0.0,
            crop_position: "center".to_string(),
            speed: 1.0,
            mode: "video".to_string(),
            image_duration: 3.0,
            use_landscape: false,
            max_duration: None,
        });
    }
    s.tile_settings.truncate(tile_count);
    while s.tile_settings.len() < tile_count {
        s.tile_settings.push(EditableTileSetting {
            trans_type: "cut".to_string(),
            trans_duration: 0.0,
            crop_position: "center".to_string(),
            speed: 1.0,
            mode: "video".to_string(),
            image_duration: 3.0,
            use_landscape: false,
            max_duration: None,
        });
    }
    for ts in &mut s.tile_settings {
        ts.mode = match ts.mode.as_str() {
            "video" | "image" => ts.mode.clone(),
            _ => "video".to_string(),
        };
        ts.trans_type = match ts.trans_type.as_str() {
            "cut" | "fade" | "fadeblack" | "dissolve" => ts.trans_type.clone(),
            _ => "cut".to_string(),
        };
        if ts.trans_type == "cut" {
            ts.trans_duration = 0.0;
        } else if ts.trans_duration < 0.0 {
            ts.trans_duration = 0.0;
        }
        if ts.speed <= 0.0 {
            ts.speed = 1.0;
        }
        if ts.image_duration <= 0.0 {
            ts.image_duration = 3.0;
        }
        if !matches!(
            ts.crop_position.as_str(),
            "center"
                | "top"
                | "bottom"
                | "left"
                | "right"
                | "top-left"
                | "top-right"
                | "bottom-left"
                | "bottom-right"
        ) {
            ts.crop_position = "center".to_string();
        }
    }

    if !s.audio_enabled {
        s.audio_tiles.clear();
    } else {
        s.audio_tiles.retain(|i| *i < tile_count);
        if s.audio_tiles.is_empty() {
            s.audio_tiles.push(0);
        }
    }
    s
}

fn edit_existing_tile_settings(root: Option<&Path>) -> Result<(), String> {
    let settings_path_raw = prompt_line("Settings path", Some(&default_settings_path(root)));
    let settings_path = {
        let p = PathBuf::from(&settings_path_raw);
        if p.is_absolute() {
            p
        } else if let Some(r) = root {
            r.join(p)
        } else {
            p
        }
    };
    let loaded = load_settings_json(&settings_path)?;
    let editable = normalize_editable_settings(editable_from_loaded(loaded));
    let updated = prompt_editable_settings(root, editable)?;
    persist_editable_settings(&settings_path, &updated)?;
    println!("Updated settings: {}", settings_path.display());
    if prompt_yes_no("Run tiled video now with these settings?", true) {
        let args = vec![
            OsString::from("--settings"),
            OsString::from(settings_path.to_string_lossy().to_string()),
            OsString::from("--render-mode"),
            OsString::from(prompt_line(
                "Render mode (full/preview/fast-preview)",
                Some("full"),
            )),
        ];
        let code = run_tile_logged(&args);
        if code != 0 {
            eprintln!("tile failed with exit code {code}");
        }
    }
    Ok(())
}

fn persist_editable_settings(path: &Path, s: &EditableSettings) -> Result<(), String> {
    let s = normalize_editable_settings(s.clone());
    save_tile_settings_json(
        path,
        &s.layout_code,
        &s.crop_mode,
        &s.tile_folders,
        s.audio_enabled,
        &s.audio_tiles,
        s.distribution_mode.as_deref(),
        s.max_total_duration,
        s.max_duration,
        &s.tile_settings,
        s.sizing_mode.as_deref(),
    )
}

fn prompt_editable_settings(
    root: Option<&Path>,
    current: EditableSettings,
) -> Result<EditableSettings, String> {
    let mut s = normalize_editable_settings(current);
    s.layout_code = loop {
        let v = prompt_line(
            "Layout (2x1,1x2,2x2,2x3,3x2,3x1,1x3,4x1,1x4,3x3,2x2-focus,3x3-focus,pip,1+2,2+1,1+3,left-big-right-stack,top-big-bottom-stack)",
            Some(&s.layout_code),
        );
        if layout_tile_count(&v).is_some() {
            break v;
        }
        println!("Unsupported layout.");
    };
    s = normalize_editable_settings(s);
    let tile_count = layout_tile_count(&s.layout_code).unwrap_or(1);

    let use_picker = prompt_yes_no("Pick folders from src/?", false);
    if use_picker {
        let recursive = prompt_yes_no("Include src subdirs recursively?", true);
        loop {
            let picked = pick_folders_from_src(root, "Select tile folders", recursive);
            let mut vals: Vec<String> = picked
                .iter()
                .map(|v| v.to_string_lossy().to_string())
                .collect();
            if vals.is_empty() {
                break;
            }
            if vals.len() == 1 {
                vals = vec![vals[0].clone(); tile_count];
            }
            if vals.len() == tile_count {
                s.tile_folders = vals;
                break;
            }
            println!("Need 1 or {tile_count} folder(s).");
        }
    } else {
        let raw = prompt_line(
            "Tile folders (comma-separated)",
            Some(&s.tile_folders.join(",")),
        );
        let mut vals: Vec<String> = raw
            .split(',')
            .map(|v| v.trim())
            .filter(|v| !v.is_empty())
            .map(|v| v.to_string())
            .collect();
        if vals.len() == 1 {
            vals = vec![vals[0].clone(); tile_count];
        }
        if vals.len() == tile_count {
            s.tile_folders = vals;
        }
    }

    s.crop_mode = loop {
        let mode = prompt_line("Crop mode (crop/pad/stretch)", Some(&s.crop_mode)).to_lowercase();
        if mode == "crop" || mode == "pad" || mode == "stretch" {
            break mode;
        }
        println!("Crop mode must be crop, pad, or stretch.");
    };

    let distribution_default = s
        .distribution_mode
        .clone()
        .unwrap_or_else(|| "none".to_string());
    let distribution_mode = loop {
        let mode = prompt_line(
            "Distribution mode (none/round-robin/sequential/random/shuffle-round-robin)",
            Some(&distribution_default),
        )
        .to_lowercase();
        if mode == "none"
            || mode == "round-robin"
            || mode == "sequential"
            || mode == "random"
            || mode == "shuffle-round-robin"
        {
            break mode;
        }
        println!("Invalid distribution mode.");
    };
    s.distribution_mode = if distribution_mode == "none" {
        None
    } else {
        Some(distribution_mode)
    };

    s.audio_enabled = prompt_yes_no("Enable audio?", s.audio_enabled);
    if s.audio_enabled {
        let default_audio = s
            .audio_tiles
            .iter()
            .map(|i| (i + 1).to_string())
            .collect::<Vec<_>>()
            .join(",");
        let raw = prompt_line(
            &format!("Audio tiles (1-{tile_count}, comma-separated)"),
            Some(if default_audio.is_empty() {
                "1"
            } else {
                &default_audio
            }),
        );
        let parsed = parse_index_selection(&raw, tile_count);
        s.audio_tiles = if parsed.is_empty() { vec![0] } else { parsed };
    } else {
        s.audio_tiles.clear();
    }

    s.max_total_duration =
        prompt_optional_f64("Max total duration (blank for none)", s.max_total_duration);
    s.max_duration = prompt_optional_f64(
        "Global max per-clip duration (blank for none)",
        s.max_duration,
    );

    for i in 0..tile_count {
        println!();
        println!(
            "Tile {} ({})",
            i + 1,
            s.tile_folders.get(i).cloned().unwrap_or_default()
        );
        let tile = &mut s.tile_settings[i];
        tile.mode = loop {
            let m = prompt_line("Mode (video/image)", Some(&tile.mode)).to_lowercase();
            if m == "video" || m == "image" {
                break m;
            }
            println!("Mode must be video or image.");
        };
        tile.trans_type = if tile.mode == "image" {
            "cut".to_string()
        } else {
            loop {
                let t = prompt_line(
                    "Transition (cut/fade/fadeblack/dissolve)",
                    Some(&tile.trans_type),
                )
                .to_lowercase();
                if t == "cut" || t == "fade" || t == "fadeblack" || t == "dissolve" {
                    break t;
                }
                println!("Transition must be cut, fade, fadeblack, or dissolve.");
            }
        };
        tile.trans_duration = if tile.trans_type == "cut" {
            0.0
        } else {
            prompt_optional_f64("Transition duration", Some(tile.trans_duration)).unwrap_or(1.0)
        };
        tile.crop_position = if s.crop_mode == "crop" {
            loop {
                let cp = prompt_line(
                    "Crop position (center/top/bottom/left/right/top-left/top-right/bottom-left/bottom-right)",
                    Some(&tile.crop_position),
                )
                .to_lowercase();
                if matches!(
                    cp.as_str(),
                    "center"
                        | "top"
                        | "bottom"
                        | "left"
                        | "right"
                        | "top-left"
                        | "top-right"
                        | "bottom-left"
                        | "bottom-right"
                ) {
                    break cp;
                }
                println!("Invalid crop position.");
            }
        } else {
            "center".to_string()
        };
        tile.speed = prompt_optional_f64("Speed factor", Some(tile.speed)).unwrap_or(1.0);
        tile.image_duration = if tile.mode == "image" {
            prompt_optional_f64("Image duration", Some(tile.image_duration)).unwrap_or(3.0)
        } else {
            tile.image_duration
        };
        tile.use_landscape = if tile.mode == "video" {
            prompt_yes_no("Use landscape subfolder if present?", tile.use_landscape)
        } else {
            false
        };
        tile.max_duration = prompt_optional_f64(
            "Tile max duration override (blank = global)",
            tile.max_duration,
        );
    }

    Ok(normalize_editable_settings(s))
}

fn run_tile_menu(root: Option<&Path>) -> i32 {
    loop {
        println!();
        println!("Tile Menu");
        println!("  1) Quick tile run");
        println!("  2) Run default saved settings");
        println!("  3) Run from settings file");
        println!("  4) Create/update settings file");
        println!("  5) Edit existing settings file");
        println!("  6) YOLO random run");
        println!("  7) Show saved settings summary");
        println!("  8) Back");
        let choice = prompt_line("Select option", Some("1"));
        match choice.trim() {
            "1" => {
                let args = build_tile_args_wizard(root);
                let code = run_tile_logged(&args);
                if code != 0 {
                    eprintln!("tile failed with exit code {code}");
                }
            }
            "2" => {
                let code = run_tile_default_settings(root);
                if code != 0 {
                    eprintln!("tile failed with exit code {code}");
                }
            }
            "3" => {
                let args = build_tile_from_settings_args(root);
                let code = run_tile_logged(&args);
                if code != 0 {
                    eprintln!("tile failed with exit code {code}");
                }
            }
            "4" => {
                if let Err(err) = create_or_update_tile_settings(root) {
                    eprintln!("settings editor failed: {err}");
                }
            }
            "5" => {
                if let Err(err) = edit_existing_tile_settings(root) {
                    eprintln!("settings editor failed: {err}");
                }
            }
            "6" => match run_yolo_tile(root) {
                Ok(code) if code != 0 => eprintln!("tile failed with exit code {code}"),
                Ok(_) => {}
                Err(err) => eprintln!("yolo failed: {err}"),
            },
            "7" => show_saved_settings_summary(root),
            "8" | "b" | "back" => return 0,
            _ => println!("Invalid option."),
        }
    }
}

fn show_saved_settings_summary(root: Option<&Path>) {
    match build_saved_settings_summary(root) {
        Ok(text) => println!("{text}"),
        Err(err) => eprintln!("{err}"),
    }
}

fn build_saved_settings_summary(root: Option<&Path>) -> Result<String, String> {
    let settings = default_settings_path(root);
    let settings_path = {
        let p = PathBuf::from(&settings);
        if p.is_absolute() {
            p
        } else if let Some(r) = root {
            r.join(p)
        } else {
            p
        }
    };
    if !settings_path.exists() {
        return Err(format!(
            "settings file not found: {}",
            settings_path.display()
        ));
    }
    let loaded = match load_settings_json(&settings_path) {
        Ok(v) => v,
        Err(err) => return Err(format!("failed to load settings: {err}")),
    };
    let settings = normalize_editable_settings(editable_from_loaded(loaded));
    let mut out = String::new();
    out.push('\n');
    out.push_str(&format!("Saved settings: {}\n", settings_path.display()));
    out.push_str(&format!("  layout: {}\n", settings.layout_code));
    out.push_str(&format!("  crop mode: {}\n", settings.crop_mode));
    out.push_str(&format!(
        "  distribution: {}\n",
        settings
            .distribution_mode
            .clone()
            .unwrap_or_else(|| "none".to_string())
    ));
    out.push_str(&format!(
        "  audio enabled: {}\n",
        if settings.audio_enabled { "yes" } else { "no" }
    ));
    if settings.audio_enabled {
        let audio = settings
            .audio_tiles
            .iter()
            .map(|i| (i + 1).to_string())
            .collect::<Vec<_>>()
            .join(",");
        out.push_str(&format!(
            "  audio tiles: {}\n",
            if audio.is_empty() {
                "1".to_string()
            } else {
                audio
            }
        ));
    }
    out.push_str(&format!(
        "  max total duration: {}\n",
        settings
            .max_total_duration
            .map(|v| format!("{v:.3}s"))
            .unwrap_or_else(|| "none".to_string())
    ));
    out.push_str(&format!(
        "  max duration: {}\n",
        settings
            .max_duration
            .map(|v| format!("{v:.3}s"))
            .unwrap_or_else(|| "none".to_string())
    ));
    for (i, ts) in settings.tile_settings.iter().enumerate() {
        let folder = settings
            .tile_folders
            .get(i)
            .cloned()
            .unwrap_or_else(|| "(unset)".to_string());
        out.push_str(&format!("  tile {}: {}\n", i + 1, folder));
        out.push_str(&format!(
            "    mode={} trans={} ({:.3}s) crop={} speed={:.3} image_dur={:.3} landscape={} max_dur={}",
            ts.mode,
            ts.trans_type,
            ts.trans_duration,
            ts.crop_position,
            ts.speed,
            ts.image_duration,
            if ts.use_landscape { "yes" } else { "no" },
            ts.max_duration
                .map(|v| format!("{v:.3}s"))
                .unwrap_or_else(|| "none".to_string())
        ));
        out.push('\n');
    }
    Ok(out)
}

fn run_tile_default_settings(root: Option<&Path>) -> i32 {
    let settings = default_settings_path(root);
    let settings_path = {
        let p = PathBuf::from(&settings);
        if p.is_absolute() {
            p
        } else if let Some(r) = root {
            r.join(p)
        } else {
            p
        }
    };
    if !settings_path.exists() {
        eprintln!(
            "settings file not found: {}",
            settings_path.to_string_lossy()
        );
        return 1;
    }
    let args = vec![
        OsString::from("--settings"),
        OsString::from(settings_path.to_string_lossy().to_string()),
        OsString::from("--render-mode"),
        OsString::from(prompt_line(
            "Render mode (full/preview/fast-preview)",
            Some("full"),
        )),
    ];
    let mut args = args;
    let overwrite_ok = prompt_yes_no("Overwrite existing output if it exists?", true);
    if !overwrite_ok {
        args.push(OsString::from("--no-overwrite"));
    }
    if prompt_yes_no("Force CFR?", false) {
        args.push(OsString::from("--force-cfr"));
    }
    run_tile_logged(&args)
}

fn run_saved_settings_cli(args: &[OsString]) -> i32 {
    if args
        .iter()
        .any(|a| matches!(a.to_string_lossy().as_ref(), "-h" | "--help" | "help"))
    {
        println!("{RUN_HELP}");
        return 0;
    }

    let root = find_repo_root();
    let mut settings: Option<String> = None;
    let mut render_mode = "full".to_string();
    let mut output: Option<String> = None;
    let mut no_overwrite = env_truthy("VIDEO_TILING_NO_OVERWRITE");
    let mut force_cfr = false;

    let mut i = 0usize;
    while i < args.len() {
        let t = args[i].to_string_lossy().to_string();
        match t.as_str() {
            "--settings" => {
                i += 1;
                if i >= args.len() {
                    eprintln!("error: missing value for --settings");
                    return 2;
                }
                settings = Some(args[i].to_string_lossy().to_string());
            }
            "--render-mode" => {
                i += 1;
                if i >= args.len() {
                    eprintln!("error: missing value for --render-mode");
                    return 2;
                }
                render_mode = args[i].to_string_lossy().to_string();
            }
            "--output" => {
                i += 1;
                if i >= args.len() {
                    eprintln!("error: missing value for --output");
                    return 2;
                }
                output = Some(args[i].to_string_lossy().to_string());
            }
            "--no-overwrite" => no_overwrite = true,
            "--force-cfr" => force_cfr = true,
            _ if t.starts_with('-') => {
                eprintln!("error: unknown option: {t}");
                return 2;
            }
            _ => {
                eprintln!("error: unexpected argument: {t}");
                return 2;
            }
        }
        i += 1;
    }

    let settings_path = {
        let raw = settings.unwrap_or_else(|| default_settings_path(root.as_deref()));
        let p = PathBuf::from(&raw);
        if p.is_absolute() {
            p
        } else if let Some(r) = root.as_deref() {
            r.join(p)
        } else {
            p
        }
    };
    if !settings_path.exists() {
        eprintln!("settings file not found: {}", settings_path.display());
        return 1;
    }

    let mut run_args = vec![
        OsString::from("--settings"),
        OsString::from(settings_path.to_string_lossy().to_string()),
        OsString::from("--render-mode"),
        OsString::from(render_mode),
    ];
    if let Some(o) = output {
        run_args.push(OsString::from("--output"));
        run_args.push(OsString::from(o));
    }
    if no_overwrite {
        run_args.push(OsString::from("--no-overwrite"));
    }
    if force_cfr {
        run_args.push(OsString::from("--force-cfr"));
    }
    run_tile_logged(&run_args)
}

fn resolve_selected_folders(root: Option<&Path>, title: &str) -> Vec<PathBuf> {
    let use_picker = prompt_yes_no("Pick folders from src/?", true);
    let mut selected = Vec::<OsString>::new();
    if use_picker {
        let recursive = prompt_yes_no("Include src subdirs recursively?", false);
        selected = pick_folders_from_src(root, title, recursive);
    }
    if selected.is_empty() {
        let raw = prompt_line("Folders (comma-separated)", None);
        selected.extend(parse_csv_paths(&raw));
    }
    let base = root.unwrap_or_else(|| Path::new("."));
    selected
        .iter()
        .map(|s| resolve_folder_path(base, &s.to_string_lossy()))
        .collect()
}

fn run_tools_menu(_root: Option<&Path>) -> i32 {
    loop {
        println!();
        println!("Tools and Doctor");
        println!("  1) Doctor: Re-encode CFR (fix freezes)");
        println!("  2) Doctor: Trim start");
        println!("  3) Organize: Split landscape videos");
        println!("  4) Make slow motion");
        println!("  5) Back");
        let choice = prompt_line("Select option", Some("1"));
        let code = match choice.trim() {
            "1" => run_doctor_reencode(&[]),
            "2" => run_doctor_trim_start(&[]),
            "3" => run_organize_landscape(&[]),
            "4" => run_slowmo(&[]),
            "5" | "b" | "back" => return 0,
            _ => {
                println!("Invalid option.");
                0
            }
        };
        if code != 0 {
            eprintln!("tool failed with exit code {code}");
        }
    }
}

fn build_tile_from_settings_args(root: Option<&Path>) -> Vec<OsString> {
    let mut args = Vec::<OsString>::new();
    let settings_path = prompt_line("Settings path", Some(&default_settings_path(root)));
    args.push("--settings".into());
    args.push(settings_path.into());

    let render_mode = prompt_line("Render mode (full/preview/fast-preview)", Some("full"));
    if !render_mode.trim().is_empty() {
        args.push("--render-mode".into());
        args.push(render_mode.into());
    }
    let output = prompt_line("Output path (blank for auto)", Some(""));
    if !output.trim().is_empty() {
        args.push("--output".into());
        args.push(output.into());
    }
    if prompt_yes_no("No overwrite?", false) {
        args.push("--no-overwrite".into());
    }
    if prompt_yes_no("Force CFR?", false) {
        args.push("--force-cfr".into());
    }
    args
}

fn create_or_update_tile_settings(root: Option<&Path>) -> Result<(), String> {
    let settings_path_raw = prompt_line("Settings path", Some(&default_settings_path(root)));
    let settings_path = {
        let p = PathBuf::from(&settings_path_raw);
        if p.is_absolute() {
            p
        } else if let Some(r) = root {
            r.join(p)
        } else {
            p
        }
    };
    let defaults = EditableSettings {
        layout_code: "2x1".to_string(),
        crop_mode: "crop".to_string(),
        tile_folders: vec!["".to_string(), "".to_string()],
        audio_enabled: true,
        audio_tiles: vec![0],
        distribution_mode: None,
        max_total_duration: None,
        max_duration: None,
        tile_settings: vec![
            EditableTileSetting {
                trans_type: "cut".to_string(),
                trans_duration: 0.0,
                crop_position: "center".to_string(),
                speed: 1.0,
                mode: "video".to_string(),
                image_duration: 3.0,
                use_landscape: false,
                max_duration: None,
            },
            EditableTileSetting {
                trans_type: "cut".to_string(),
                trans_duration: 0.0,
                crop_position: "center".to_string(),
                speed: 1.0,
                mode: "video".to_string(),
                image_duration: 3.0,
                use_landscape: false,
                max_duration: None,
            },
        ],
        sizing_mode: None,
    };
    let updated = prompt_editable_settings(root, defaults)?;
    persist_editable_settings(&settings_path, &updated)?;
    println!("Saved settings: {}", settings_path.display());
    if prompt_yes_no("Run tiled video now with these settings?", true) {
        let args = vec![
            OsString::from("--settings"),
            OsString::from(settings_path.to_string_lossy().to_string()),
            OsString::from("--render-mode"),
            OsString::from(prompt_line(
                "Render mode (full/preview/fast-preview)",
                Some("full"),
            )),
        ];
        let code = run_tile_logged(&args);
        if code != 0 {
            eprintln!("tile failed with exit code {code}");
        }
    }
    Ok(())
}

fn build_tile_args_wizard(root: Option<&Path>) -> Vec<OsString> {
    println!("Tile wizard");
    let mut args: Vec<OsString> = Vec::new();

    let use_settings = prompt_yes_no("Use settings file?", false);
    if use_settings {
        let settings = prompt_line("Settings path", Some("configs/tile_videos_settings.json"));
        if !settings.is_empty() {
            args.push("--settings".into());
            args.push(settings.into());
        }
    } else {
        let mut folders_added = false;
        let layout = prompt_line("Layout", Some("2x1"));
        let layout_label = layout.clone();
        let tile_count = layout_tile_count(&layout).unwrap_or(0);
        if !layout.is_empty() {
            args.push("--layout".into());
            args.push(layout.into());
        }
        let use_picker = prompt_yes_no("Pick folders from src/?", false);
        if use_picker {
            let recursive = prompt_yes_no("Include src subdirs recursively?", true);
            loop {
                let picked = pick_folders_from_src(root, "Select folders for tile", recursive);
                if picked.is_empty() {
                    println!("No folders selected.");
                    break;
                }
                if tile_count == 0 || picked.len() == 1 || picked.len() == tile_count {
                    args.extend(picked);
                    folders_added = true;
                    break;
                }
                println!(
                    "Need either 1 folder or exactly {tile_count} folders for layout '{layout_label}'."
                );
                if !prompt_yes_no("Try picker again?", true) {
                    break;
                }
            }
        }
        if !folders_added {
            let folders = prompt_line("Folder paths (comma-separated)", None);
            for f in folders
                .split(',')
                .map(|v| v.trim())
                .filter(|v| !v.is_empty())
            {
                args.push(f.into());
            }
        }
    }

    let render_mode = prompt_line("Render mode (full/preview/fast-preview)", Some("full"));
    if !render_mode.is_empty() {
        args.push("--render-mode".into());
        args.push(render_mode.into());
    }
    let crop_mode = prompt_line("Crop mode (crop/pad/stretch)", Some("crop"));
    if !crop_mode.is_empty() {
        args.push("--crop-mode".into());
        args.push(crop_mode.into());
    }
    let transition = prompt_line("Transition (cut/fade/fadeblack)", Some("cut"));
    if !transition.is_empty() {
        args.push("--transition".into());
        args.push(transition.into());
    }
    let transition_duration = prompt_line("Transition duration", Some("1.0"));
    if !transition_duration.is_empty() {
        args.push("--transition-duration".into());
        args.push(transition_duration.into());
    }
    let speed = prompt_line("Speed", Some("1.0"));
    if !speed.is_empty() {
        args.push("--speed".into());
        args.push(speed.into());
    }
    let dist = prompt_line(
        "Distribution mode (none/round-robin/sequential/random/shuffle-round-robin)",
        Some("none"),
    );
    if !dist.is_empty() {
        args.push("--distribution-mode".into());
        args.push(dist.into());
    }
    let max_dur = prompt_line("Max clip duration (blank for none)", Some(""));
    if !max_dur.is_empty() {
        args.push("--max-duration".into());
        args.push(max_dur.into());
    }
    let max_total = prompt_line("Max total output duration (blank for none)", Some(""));
    if !max_total.is_empty() {
        args.push("--max-total-duration".into());
        args.push(max_total.into());
    }
    let audio_enabled = prompt_yes_no("Enable audio?", true);
    if !audio_enabled {
        args.push("--no-audio".into());
    } else {
        let audio_tiles = prompt_line("Audio tiles (comma-separated indexes)", Some("0"));
        if !audio_tiles.is_empty() {
            args.push("--audio-tiles".into());
            args.push(audio_tiles.into());
        }
    }
    let no_overwrite = prompt_yes_no("No overwrite?", false);
    if no_overwrite {
        args.push("--no-overwrite".into());
    }
    if prompt_yes_no("Force CFR?", false) {
        args.push("--force-cfr".into());
    }
    let output = prompt_line("Output path (blank for auto)", Some(""));
    if !output.is_empty() {
        args.push("--output".into());
        args.push(output.into());
    }

    args
}

fn parse_csv_paths(raw: &str) -> Vec<OsString> {
    raw.split(',')
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .map(OsString::from)
        .collect()
}

fn parse_index_selection(raw: &str, max: usize) -> Vec<usize> {
    let mut out = Vec::<usize>::new();
    for part in raw.split(',') {
        let t = part.trim();
        if t.is_empty() {
            continue;
        }
        if let Some((a, b)) = t.split_once('-') {
            let start = a.trim().parse::<usize>().ok();
            let end = b.trim().parse::<usize>().ok();
            if let (Some(mut s), Some(mut e)) = (start, end) {
                if s == 0 || e == 0 {
                    continue;
                }
                if s > e {
                    std::mem::swap(&mut s, &mut e);
                }
                for idx in s..=e {
                    if idx <= max {
                        out.push(idx - 1);
                    }
                }
            }
            continue;
        }
        if let Ok(v) = t.parse::<usize>() {
            if v > 0 && v <= max {
                out.push(v - 1);
            }
        }
    }
    out.sort_unstable();
    out.dedup();
    out
}

fn collect_src_folder_entries(root: &Path, recursive: bool) -> Vec<(String, String)> {
    let src = root.join("src");
    if !src.exists() || !src.is_dir() {
        return Vec::new();
    }
    let mut values = Vec::<String>::new();
    if recursive {
        let mut stack = vec![src.clone()];
        while let Some(dir) = stack.pop() {
            let entries = match fs::read_dir(&dir) {
                Ok(v) => v,
                Err(_) => continue,
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                if let Ok(rel) = path.strip_prefix(&src) {
                    let rels = rel.to_string_lossy().replace('\\', "/");
                    if !rels.is_empty() {
                        values.push(rels);
                    }
                }
                stack.push(path);
            }
        }
    } else {
        let entries = match fs::read_dir(&src) {
            Ok(v) => v,
            Err(_) => return Vec::new(),
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            if let Some(name) = path.file_name() {
                values.push(name.to_string_lossy().to_string());
            }
        }
    }
    values.sort();
    values
        .into_iter()
        .map(|value| {
            let depth = value.split('/').count();
            let indent = "  ".repeat(depth.saturating_sub(1));
            let label = format!("{indent}{value}");
            (label, value)
        })
        .collect()
}

fn collect_src_videos(root: &Path) -> Vec<(String, String, String)> {
    let src = root.join("src");
    if !src.exists() || !src.is_dir() {
        return Vec::new();
    }
    let mut out: Vec<(String, String, String)> = Vec::new();
    let mut stack = vec![src.clone()];
    while let Some(dir) = stack.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(v) => v,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            if !path.is_file() || !is_video_file(&path) {
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
            out.push((folder, name, rel_path));
        }
    }
    out.sort_by(|a, b| a.2.cmp(&b.2));
    out
}

#[derive(Clone, Debug)]
struct OutputRun {
    project: String,
    tool: String,
    run_id: String,
    run_rel: String,
    sample_url: Option<String>,
    modified: SystemTime,
}

fn collect_output_runs(root: &Path) -> Vec<OutputRun> {
    let src = root.join("src");
    if !src.exists() || !src.is_dir() {
        return Vec::new();
    }
    let mut out = Vec::<OutputRun>::new();
    out.extend(collect_root_outputs(root));
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
                        collect_output_runs_in(&src, &path, &mut out);
                        continue;
                    }
                }
                stack.push(path);
            }
        }
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    out
}

fn collect_output_runs_in(src_root: &Path, outputs_dir: &Path, out: &mut Vec<OutputRun>) {
    let tool_entries = match fs::read_dir(outputs_dir) {
        Ok(v) => v,
        Err(_) => return,
    };
    for tool_entry in tool_entries.flatten() {
        let tool_path = tool_entry.path();
        if !tool_path.is_dir() {
            continue;
        }
        let tool = tool_path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        if tool.is_empty() {
            continue;
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
            let run_id = run_path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            if run_id.is_empty() {
                continue;
            }
            let modified = run_entry
                .metadata()
                .and_then(|m| m.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH);
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
            let sample_rel = find_first_video_rel(src_root, &run_path);
            let sample_url = sample_rel.map(|r| format!("/files/{}", url_encode(&r)));
            out.push(OutputRun {
                project,
                tool: tool.clone(),
                run_id,
                run_rel,
                sample_url,
                modified,
            });
        }
    }
}

fn collect_root_outputs(root: &Path) -> Vec<OutputRun> {
    let outputs_dir = root.join("outputs");
    if !outputs_dir.exists() || !outputs_dir.is_dir() {
        return Vec::new();
    }
    let mut out = Vec::new();
    let tool_entries = match fs::read_dir(&outputs_dir) {
        Ok(v) => v,
        Err(_) => return out,
    };
    for tool_entry in tool_entries.flatten() {
        let tool_path = tool_entry.path();
        if !tool_path.is_dir() {
            continue;
        }
        let tool = tool_path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        if tool.is_empty() {
            continue;
        }
        let mut has_run_dir = false;
        let run_entries = match fs::read_dir(&tool_path) {
            Ok(v) => v,
            Err(_) => continue,
        };
        for run_entry in run_entries.flatten() {
            let run_path = run_entry.path();
            if run_path.is_dir() {
                has_run_dir = true;
                let run_id = run_path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string();
                if run_id.is_empty() {
                    continue;
                }
                let modified = run_entry
                    .metadata()
                    .and_then(|m| m.modified())
                    .unwrap_or(SystemTime::UNIX_EPOCH);
                let run_rel = match run_path.strip_prefix(root) {
                    Ok(v) => v.to_string_lossy().replace('\\', "/"),
                    Err(_) => continue,
                };
                let sample_url = find_first_video_rel_root(root, &run_path)
                    .map(|r| format!("/outfiles/{}", url_encode(&r)));
                out.push(OutputRun {
                    project: "(global)".to_string(),
                    tool: tool.clone(),
                    run_id,
                    run_rel,
                    sample_url,
                    modified,
                });
            }
        }
        if !has_run_dir {
            let modified = tool_entry
                .metadata()
                .and_then(|m| m.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            let run_rel = match tool_path.strip_prefix(root) {
                Ok(v) => v.to_string_lossy().replace('\\', "/"),
                Err(_) => continue,
            };
            let sample_url = find_first_video_rel_root(root, &tool_path)
                .map(|r| format!("/outfiles/{}", url_encode(&r)));
            out.push(OutputRun {
                project: "(global)".to_string(),
                tool: tool.clone(),
                run_id: "legacy".to_string(),
                run_rel,
                sample_url,
                modified,
            });
        }
    }
    out
}

fn project_from_folder(folder: &str) -> String {
    folder
        .split('/')
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or("(root)")
        .to_string()
}

fn find_first_video_rel(src_root: &Path, run_path: &Path) -> Option<String> {
    let entries = fs::read_dir(run_path).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || !is_video_file(&path) {
            continue;
        }
        if let Ok(rel) = path.strip_prefix(src_root) {
            return Some(rel.to_string_lossy().replace('\\', "/"));
        }
    }
    None
}

fn find_first_video_rel_root(root: &Path, run_path: &Path) -> Option<String> {
    let entries = fs::read_dir(run_path).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || !is_video_file(&path) {
            continue;
        }
        if let Ok(rel) = path.strip_prefix(root) {
            return Some(rel.to_string_lossy().replace('\\', "/"));
        }
    }
    None
}

#[allow(dead_code)]
fn collect_src_folders(root: &Path, recursive: bool) -> Vec<String> {
    collect_src_folder_entries(root, recursive)
        .into_iter()
        .map(|(_, value)| value)
        .collect()
}

fn pick_folders_from_src(root: Option<&Path>, title: &str, recursive: bool) -> Vec<OsString> {
    let Some(r) = root else {
        eprintln!("warning: repo root not found; src picker unavailable");
        return Vec::new();
    };
    let folders = collect_src_folder_entries(r, recursive);
    if folders.is_empty() {
        eprintln!("warning: no folders found in src/");
        return Vec::new();
    }
    println!("{title}");
    for (i, (label, _)) in folders.iter().enumerate() {
        println!("  {:>3}) {}", i + 1, label);
    }
    println!("Enter selection as indexes (e.g. 1,3-5). Leave blank to cancel.");
    let raw = prompt_line("Selection", Some(""));
    if raw.trim().is_empty() {
        return Vec::new();
    }
    let idxs = parse_index_selection(&raw, folders.len());
    idxs.into_iter()
        .filter_map(|i| folders.get(i))
        .map(|(_, value)| OsString::from(value))
        .collect()
}

fn build_concat_args_wizard(root: Option<&Path>) -> Vec<OsString> {
    println!("Concat wizard");
    let mut args = Vec::<OsString>::new();
    let use_picker = prompt_yes_no("Pick folders from src/?", false);
    if use_picker {
        let recursive = prompt_yes_no("Include src subdirs recursively?", true);
        args.extend(pick_folders_from_src(
            root,
            "Select folders for concat",
            recursive,
        ));
    } else {
        let folders = prompt_line("Folders (comma-separated)", None);
        args.extend(parse_csv_paths(&folders));
    }
    let transition = prompt_line("Transition (cut/fade/fadeblack)", Some("cut"));
    if !transition.is_empty() {
        args.push("--transition".into());
        args.push(transition.into());
    }
    let duration = prompt_line("Transition duration", Some("1.0"));
    if !duration.is_empty() {
        args.push("--duration".into());
        args.push(duration.into());
    }
    let output_default = tui_source_output_dir(root, &args)
        .map(|dir| format!("source/outputs ({})", tui_display_path(root, &dir)))
        .unwrap_or_else(|| "outputs/concatenated".to_string());
    let output = prompt_line("Output dir", Some(&output_default));
    if let Some(mut output) = normalize_source_output_choice(&output) {
        if output == SOURCE_OUTPUT_TOKEN {
            let subdir = prompt_line("Source output subdir", Some("outputs"));
            output = build_source_output_token(&subdir);
        }
        args.push("--output".into());
        args.push(output.into());
    }
    args
}

fn build_trim_args_wizard(root: Option<&Path>) -> Vec<OsString> {
    println!("Trim wizard");
    let mut args = Vec::<OsString>::new();
    let use_picker = prompt_yes_no("Pick folders from src/?", false);
    if use_picker {
        let recursive = prompt_yes_no("Include src subdirs recursively?", true);
        args.extend(pick_folders_from_src(
            root,
            "Select folders for trim",
            recursive,
        ));
    } else {
        let folders = prompt_line("Folders (comma-separated)", None);
        args.extend(parse_csv_paths(&folders));
    }
    let start = prompt_line("Trim start seconds", Some("0"));
    if !start.is_empty() {
        args.push("--start".into());
        args.push(start.into());
    }
    let end = prompt_line("Trim end seconds", Some("0"));
    if !end.is_empty() {
        args.push("--end".into());
        args.push(end.into());
    }
    let output_default = tui_source_output_dir(root, &args)
        .map(|dir| format!("source/outputs ({})", tui_display_path(root, &dir)))
        .unwrap_or_else(|| "outputs/trimmed".to_string());
    let output = prompt_line("Output dir", Some(&output_default));
    if let Some(mut output) = normalize_source_output_choice(&output) {
        if output == SOURCE_OUTPUT_TOKEN {
            let subdir = prompt_line("Source output subdir", Some("outputs"));
            output = build_source_output_token(&subdir);
        }
        args.push("--output".into());
        args.push(output.into());
    }
    args
}

fn build_detect_args_wizard(root: Option<&Path>) -> Vec<OsString> {
    println!("Detect wizard");
    let mut args = Vec::<OsString>::new();
    let use_picker = prompt_yes_no("Pick folders from src/?", false);
    if use_picker {
        let recursive = prompt_yes_no("Include src subdirs recursively?", true);
        args.extend(pick_folders_from_src(
            root,
            "Select folders for detect",
            recursive,
        ));
    } else {
        let inputs = prompt_line("Inputs (comma-separated files/folders)", None);
        args.extend(parse_csv_paths(&inputs));
    }
    let threshold = prompt_line("Threshold", Some("0.27"));
    if !threshold.is_empty() {
        args.push("--threshold".into());
        args.push(threshold.into());
    }
    let method = prompt_line("Method (content/adaptive)", Some("content"));
    if !method.is_empty() {
        args.push("--method".into());
        args.push(method.into());
    }
    if prompt_yes_no("List only?", false) {
        args.push("--list-only".into());
    }
    let output_default = tui_source_output_dir(root, &args)
        .map(|dir| format!("source/outputs ({})", tui_display_path(root, &dir)))
        .unwrap_or_else(|| "outputs/scenes".to_string());
    let output = prompt_line("Output dir", Some(&output_default));
    if let Some(mut output) = normalize_source_output_choice(&output) {
        if output == SOURCE_OUTPUT_TOKEN {
            let subdir = prompt_line("Source output subdir", Some("outputs"));
            output = build_source_output_token(&subdir);
        }
        args.push("--output".into());
        args.push(output.into());
    }
    args
}

fn build_clean_args_wizard(root: Option<&Path>) -> Vec<OsString> {
    println!("Clean wizard");
    let mut args = Vec::<OsString>::new();
    let use_picker = prompt_yes_no("Pick folders from src/?", false);
    if use_picker {
        let recursive = prompt_yes_no("Include src subdirs recursively?", true);
        args.extend(pick_folders_from_src(
            root,
            "Select folders for clean",
            recursive,
        ));
    } else {
        let folders = prompt_line("Folders (comma-separated)", None);
        args.extend(parse_csv_paths(&folders));
    }
    let mode = prompt_line("Mode (1=duplicates,2=rename,3=both)", Some("3"));
    if !mode.is_empty() {
        args.push("--mode".into());
        args.push(mode.into());
    }
    if prompt_yes_no("Add numbering when renaming?", false) {
        args.push("--number".into());
    }
    args
}

fn run_concat(args: &[OsString]) -> i32 {
    let root = match find_repo_root() {
        Some(path) => path,
        None => {
            eprintln!("error: could not locate project root");
            return 1;
        }
    };

    let opts = match parse_concat_args(args) {
        Ok(Some(o)) => o,
        Ok(None) => return 0,
        Err(msg) => {
            eprintln!("error: {msg}\n");
            eprintln!("{CONCAT_HELP}");
            return 2;
        }
    };

    if !check_ffmpeg_tools(&root) {
        eprintln!("error: ffmpeg and ffprobe are required");
        return 1;
    }

    let alongside = parse_alongside_token(&opts.output_dir);
    let source_subdir = if alongside {
        None
    } else {
        parse_source_output_token(&opts.output_dir)
    };
    let run_id = source_subdir.as_ref().map(|_| run_timestamp_id());
    let output_dir = if source_subdir.is_some() || alongside {
        PathBuf::new()
    } else {
        resolve_output_dir(&root, &opts.output_dir)
    };
    if source_subdir.is_none() && !alongside {
        if let Err(err) = fs::create_dir_all(&output_dir) {
            eprintln!(
                "error: failed to create output dir {}: {err}",
                output_dir.display()
            );
            return 1;
        }
    }

    println!("Video Concatenation Tool (Rust)");
    if alongside {
        println!("Output directory: alongside originals (per folder)");
    } else if let Some(subdir) = &source_subdir {
        let run_id = run_id.as_deref().unwrap_or("run");
        println!("Output directory: <source>/{subdir}/concat/{run_id} (per folder)");
    } else {
        println!("Output directory: {}", output_dir.display());
    }

    let mut failures = 0;
    for folder_input in &opts.folders {
        let folder = resolve_folder_path(&root, folder_input);
        let files = get_video_files(&folder);
        if files.is_empty() {
            eprintln!("No video files found in {}", folder.display());
            failures += 1;
            continue;
        }

        let folder_name = folder
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "output".to_string());
        let folder_output_dir = if alongside {
            folder.clone()
        } else if let Some(subdir) = &source_subdir {
            let run_id = run_id.as_deref().unwrap_or("run");
            folder.join(subdir).join("concat").join(run_id)
        } else {
            output_dir.clone()
        };
        if let Err(err) = fs::create_dir_all(&folder_output_dir) {
            eprintln!(
                "error: failed to create output dir {}: {err}",
                folder_output_dir.display()
            );
            failures += 1;
            continue;
        }
        let output_path = resolve_output_no_overwrite(
            folder_output_dir.join(format!("{folder_name}_concatenated.mp4")),
        );

        println!(
            "\nProcessing folder: {} ({} files)",
            folder.display(),
            files.len()
        );

        // Pre-normalization pass: Enforce canonical contract on all inputs
        let mut normalized_files = Vec::new();
        let mut norm_success = true;
        for (i, file) in files.iter().enumerate() {
            let tmp = env::temp_dir().join(format!(
                "concat_norm_{}_{}_{}.mp4",
                std::process::id(),
                i,
                SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
            ));
            if normalize_video(file, &tmp, &root) {
                normalized_files.push(tmp);
            } else {
                eprintln!("error: failed to normalize {}", file.display());
                norm_success = false;
                break;
            }
        }

        if !norm_success {
            for p in &normalized_files { let _ = fs::remove_file(p); }
            failures += 1;
            continue;
        }

        let ok = if normalized_files.len() == 1 || opts.transition == "cut" {
            concat_simple_cut(&normalized_files, &output_path, &root)
        } else {
            // IMPORTANT: Metadata must come from the normalized files to ensure perfectly accurate xfade offsets
            concat_with_transitions(&normalized_files, &output_path, &opts.transition, opts.duration, &root)
        };

        for p in &normalized_files { let _ = fs::remove_file(p); }

        if ok {
            println!("✓ Saved: {}", output_path.display());
        } else {
            eprintln!("✗ Failed: {}", output_path.display());
            failures += 1;
        }
    }

    if failures > 0 {
        1
    } else {
        0
    }
}

fn run_loop(args: &[OsString]) -> i32 {
    let root = match find_repo_root() {
        Some(path) => path,
        None => {
            eprintln!("error: could not locate project root");
            return 1;
        }
    };

    let opts = match parse_loop_args(args) {
        Ok(Some(o)) => o,
        Ok(None) => return 0,
        Err(msg) => {
            eprintln!("error: {msg}\n");
            eprintln!("{LOOP_HELP}");
            return 2;
        }
    };

    if !check_ffmpeg_tools(&root) {
        eprintln!("error: ffmpeg and ffprobe are required");
        return 1;
    }

    let alongside = parse_alongside_token(&opts.output_dir);
    let source_subdir = if alongside {
        None
    } else {
        parse_source_output_token(&opts.output_dir)
    };
    let run_id = source_subdir.as_ref().map(|_| run_timestamp_id());
    let output_dir = if source_subdir.is_some() || alongside {
        PathBuf::new()
    } else {
        resolve_output_dir(&root, &opts.output_dir)
    };
    if source_subdir.is_none() && !alongside {
        if let Err(err) = fs::create_dir_all(&output_dir) {
            eprintln!(
                "error: failed to create output dir {}: {err}",
                output_dir.display()
            );
            return 1;
        }
    }

    println!("Video Loop Tool (Rust)");
    println!("Loop count: {}", opts.count);
    println!("Transition: {}", opts.transition);

    // Collect all input video files
    let mut video_files: Vec<PathBuf> = Vec::new();
    for input in &opts.inputs {
        let path = resolve_folder_path(&root, input);
        if path.is_dir() {
            let files = get_video_files(&path);
            video_files.extend(files);
        } else if path.is_file() {
            video_files.push(path);
        } else {
            eprintln!("warning: input not found: {}", path.display());
        }
    }

    if video_files.is_empty() {
        eprintln!("error: no video files found");
        return 1;
    }

    if alongside {
        println!("Output directory: alongside originals (per video)");
    } else if let Some(subdir) = &source_subdir {
        let run_id = run_id.as_deref().unwrap_or("run");
        println!("Output directory: <source>/{subdir}/loop/{run_id} (per video)");
    } else {
        println!("Output directory: {}", output_dir.display());
    }

    let mut failures = 0;
    for video in &video_files {
        let stem = video
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "output".to_string());

        let file_output_dir = if alongside {
            video
                .parent()
                .unwrap_or_else(|| Path::new("."))
                .to_path_buf()
        } else if let Some(subdir) = &source_subdir {
            let parent = video.parent().unwrap_or_else(|| Path::new("."));
            let run_id = run_id.as_deref().unwrap_or("run");
            parent.join(subdir).join("loop").join(run_id)
        } else {
            output_dir.clone()
        };
        if let Err(err) = fs::create_dir_all(&file_output_dir) {
            eprintln!(
                "error: failed to create output dir {}: {err}",
                file_output_dir.display()
            );
            failures += 1;
            continue;
        }

        let output_path = resolve_output_no_overwrite(
            file_output_dir.join(format!("{stem}_loop{}x.mp4", opts.count)),
        );

        // Pre-normalization pass: Enforce canonical contract on input
        let tmp_norm = env::temp_dir().join(format!(
            "loop_norm_{}_{}.mp4",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
        ));
        if !normalize_video(video, &tmp_norm, &root) {
            eprintln!("error: failed to normalize {}", video.display());
            failures += 1;
            continue;
        }

        // Build a file list that repeats the normalized video N times
        let repeated: Vec<PathBuf> = (0..opts.count).map(|_| tmp_norm.clone()).collect();

        println!("\nLooping: {} ({}x)", video.display(), opts.count);

        let ok = if opts.count == 1 || opts.transition == "cut" {
            concat_simple_cut(&repeated, &output_path, &root)
        } else {
            concat_with_transitions(
                &repeated,
                &output_path,
                &opts.transition,
                opts.duration,
                &root,
            )
        };

        let _ = fs::remove_file(&tmp_norm);

        if ok {
            println!("✓ Saved: {}", output_path.display());
        } else {
            eprintln!("✗ Failed: {}", output_path.display());
            failures += 1;
        }
    }

    if failures > 0 {
        1
    } else {
        0
    }
}

fn overwrite_temp_path(input: &Path, tag: &str) -> PathBuf {
    let parent = input.parent().unwrap_or_else(|| Path::new("."));
    let stem = input
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "output".to_string());
    let ext = input
        .extension()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "mp4".to_string());
    parent.join(format!("{stem}.{tag}.{ext}"))
}

fn run_trim(args: &[OsString]) -> i32 {
    let root = match find_repo_root() {
        Some(path) => path,
        None => {
            eprintln!("error: could not locate project root");
            return 1;
        }
    };

    let opts = match parse_trim_args(args) {
        Ok(Some(o)) => o,
        Ok(None) => return 0,
        Err(msg) => {
            eprintln!("error: {msg}\n");
            eprintln!("{TRIM_HELP}");
            return 2;
        }
    };

    if !check_ffmpeg_tools(&root) {
        eprintln!("error: ffmpeg and ffprobe are required");
        return 1;
    }

    let overwrite = opts.overwrite;
    let alongside = parse_alongside_token(&opts.output_dir);
    let source_subdir = if overwrite || alongside {
        None
    } else {
        parse_source_output_token(&opts.output_dir)
    };
    let run_id = source_subdir.as_ref().map(|_| run_timestamp_id());
    let output_dir = if source_subdir.is_some() || alongside {
        PathBuf::new()
    } else {
        resolve_output_dir(&root, &opts.output_dir)
    };
    if !overwrite && !alongside && source_subdir.is_none() {
        if let Err(err) = fs::create_dir_all(&output_dir) {
            eprintln!(
                "error: failed to create output dir {}: {err}",
                output_dir.display()
            );
            return 1;
        }
    }

    println!("Video Trimming Tool (Rust)");
    if overwrite {
        println!("Output: overwrite originals");
    } else if alongside {
        println!("Output: alongside originals");
    } else if let Some(subdir) = &source_subdir {
        let run_id = run_id.as_deref().unwrap_or("run");
        println!("Output directory: <source>/{subdir}/trim/{run_id} (per folder)");
    } else {
        println!("Output directory: {}", output_dir.display());
    }
    println!(
        "Trim settings: start={}s, end={}s",
        opts.trim_start, opts.trim_end
    );

    let mut failures = 0usize;
    for input in &opts.folders {
        let as_path = PathBuf::from(input);
        if as_path.exists() && as_path.is_file() && is_video_file(&as_path) {
            let base_dir = as_path.parent().unwrap_or(&root);
            let base_output = if overwrite {
                base_dir.to_path_buf()
            } else if alongside {
                base_dir.to_path_buf()
            } else if let Some(subdir) = &source_subdir {
                let run_id = run_id.as_deref().unwrap_or("run");
                base_dir.join(subdir).join("trim").join(run_id)
            } else {
                output_dir.clone()
            };
            if !overwrite && !alongside {
                if let Err(err) = fs::create_dir_all(&base_output) {
                    eprintln!(
                        "error: failed to create output dir {}: {err}",
                        base_output.display()
                    );
                    failures += 1;
                    continue;
                }
            }
            let out_path = if overwrite {
                overwrite_temp_path(&as_path, "trim_tmp")
            } else {
                resolve_output_no_overwrite(
                    base_output.join(
                        as_path
                            .file_name()
                            .map(|s| s.to_os_string())
                            .unwrap_or_else(|| OsString::from("output.mp4")),
                    ),
                )
            };
            println!("\nProcessing file: {}", as_path.display());
            if trim_video(&as_path, &out_path, opts.trim_start, opts.trim_end, opts.no_audio, &root) {
                if overwrite {
                    if let Err(err) = fs::rename(&out_path, &as_path) {
                        failures += 1;
                        eprintln!("✗ {} ({err})", as_path.display());
                        let _ = fs::remove_file(&out_path);
                    } else {
                        println!("✓ {}", as_path.display());
                    }
                } else {
                    println!("✓ {}", out_path.display());
                }
            } else {
                failures += 1;
                eprintln!("✗ {}", as_path.display());
                if overwrite {
                    let _ = fs::remove_file(&out_path);
                }
            }
            continue;
        }

        let folder = resolve_folder_path(&root, input);
        let files = get_video_files(&folder);
        if files.is_empty() {
            eprintln!("No video files found in {}", folder.display());
            failures += 1;
            continue;
        }

        let output_folder = if overwrite {
            None
        } else {
            let folder_output_dir = if let Some(subdir) = &source_subdir {
                let run_id = run_id.as_deref().unwrap_or("run");
                folder.join(subdir).join("trim").join(run_id)
            } else {
                output_dir.clone()
            };
            if let Err(err) = fs::create_dir_all(&folder_output_dir) {
                eprintln!(
                    "error: failed to create output dir {}: {err}",
                    folder_output_dir.display()
                );
                failures += files.len();
                continue;
            }
            Some(folder_output_dir)
        };

        println!(
            "\nProcessing folder: {} ({} files)",
            folder.display(),
            files.len()
        );
        let mut ok_count = 0usize;
        for video in &files {
            let out_path = if overwrite {
                overwrite_temp_path(video, "trim_tmp")
            } else {
                resolve_output_no_overwrite(
                    output_folder.as_ref().unwrap_or(&folder).join(
                        video
                            .file_name()
                            .map(|s| s.to_os_string())
                            .unwrap_or_else(|| OsString::from("output.mp4")),
                    ),
                )
            };
            if trim_video(video, &out_path, opts.trim_start, opts.trim_end, opts.no_audio, &root) {
                if overwrite {
                    if let Err(err) = fs::rename(&out_path, video) {
                        failures += 1;
                        eprintln!("✗ {} ({err})", video.display());
                        let _ = fs::remove_file(&out_path);
                    } else {
                        ok_count += 1;
                        println!("✓ {}", video.display());
                    }
                } else {
                    ok_count += 1;
                    println!("✓ {}", out_path.display());
                }
            } else {
                failures += 1;
                eprintln!("✗ {}", video.display());
                if overwrite {
                    let _ = fs::remove_file(&out_path);
                }
            }
        }
        println!("Completed: {ok_count}/{} trimmed", files.len());
    }

    if failures > 0 {
        1
    } else {
        0
    }
}

fn run_clean(args: &[OsString]) -> i32 {
    let root = match find_repo_root() {
        Some(path) => path,
        None => {
            eprintln!("error: could not locate project root");
            return 1;
        }
    };

    let opts = match parse_clean_args(args) {
        Ok(Some(o)) => o,
        Ok(None) => return 0,
        Err(msg) => {
            eprintln!("error: {msg}\n");
            eprintln!("{CLEAN_HELP}");
            return 2;
        }
    };

    println!("Folder Cleaning Tool (Rust)");
    println!("Mode: {}", opts.mode);
    println!();

    let mut failures = 0usize;
    for folder_input in &opts.folders {
        let folder = resolve_folder_path(&root, folder_input);
        if !folder.exists() || !folder.is_dir() {
            eprintln!("error: folder does not exist: {}", folder.display());
            failures += 1;
            continue;
        }
        println!("============================================================");
        println!("Processing: {}", folder.display());
        println!("============================================================");

        if opts.mode == "1" || opts.mode == "3" {
            let removed = remove_duplicates(&folder);
            println!("Removed {removed} duplicate file(s)");
        }
        if opts.mode == "2" || opts.mode == "3" {
            let renamed = rename_by_date(&folder, opts.add_number);
            println!("Renamed {renamed} file(s)");
        }
        println!();
    }

    if failures > 0 {
        1
    } else {
        0
    }
}

fn run_detect(args: &[OsString]) -> i32 {
    let root = match find_repo_root() {
        Some(path) => path,
        None => {
            eprintln!("error: could not locate project root");
            return 1;
        }
    };

    let opts = match parse_detect_args(args) {
        Ok(Some(o)) => o,
        Ok(None) => return 0,
        Err(msg) => {
            eprintln!("error: {msg}\n");
            eprintln!("{DETECT_HELP}");
            return 2;
        }
    };

    if !check_ffmpeg_tools(&root) {
        eprintln!("error: ffmpeg and ffprobe are required");
        return 1;
    }

    if opts.method != "content" && opts.method != "adaptive" {
        eprintln!("error: method must be content or adaptive");
        return 2;
    }
    if opts.method == "adaptive" {
        println!("note: adaptive currently uses ffmpeg scene-score heuristic.");
    }

    let alongside = parse_alongside_token(&opts.output_dir);
    let source_subdir = if alongside {
        None
    } else {
        parse_source_output_token(&opts.output_dir)
    };
    let run_id = source_subdir.as_ref().map(|_| run_timestamp_id());
    let output_dir = if source_subdir.is_some() || alongside {
        PathBuf::new()
    } else {
        resolve_output_dir(&root, &opts.output_dir)
    };
    if source_subdir.is_none() && !alongside {
        if let Err(err) = fs::create_dir_all(&output_dir) {
            eprintln!(
                "error: failed to create output dir {}: {err}",
                output_dir.display()
            );
            return 1;
        }
    }

    let mut videos: Vec<PathBuf> = Vec::new();
    for input in &opts.inputs {
        let as_path = PathBuf::from(input);
        if as_path.exists() && as_path.is_file() && is_video_file(&as_path) {
            videos.push(as_path);
            continue;
        }
        let folder = resolve_folder_path(&root, input);
        if folder.exists() && folder.is_dir() {
            videos.extend(get_video_files(&folder));
            continue;
        }
        eprintln!("warning: '{}' is not a valid video or folder", input);
    }

    if videos.is_empty() {
        eprintln!("error: no videos found to process");
        return 1;
    }

    println!("Scene Detection Tool (Rust)");
    if alongside {
        println!("Output directory: alongside originals (per video)");
    } else if let Some(subdir) = &source_subdir {
        let run_id = run_id.as_deref().unwrap_or("run");
        println!("Output directory: <source>/{subdir}/detect/{run_id} (per video)");
    } else {
        println!("Output directory: {}", output_dir.display());
    }
    println!(
        "Mode: {}",
        if opts.list_only {
            "list only"
        } else {
            "detect and split"
        }
    );
    println!(
        "Method: {} | threshold: {}",
        opts.method,
        normalize_scene_threshold(opts.threshold)
    );

    let mut processed_ok = 0usize;
    for video in &videos {
        println!("\n============================================================");
        println!("Processing: {}", video.display());
        println!("============================================================");
        let scenes = detect_scenes_ffmpeg(video, normalize_scene_threshold(opts.threshold), &root);
        if scenes.is_empty() {
            println!("No scenes detected.");
            continue;
        }
        println!("Detected {} scene(s)", scenes.len());
        for (i, (start, end)) in scenes.iter().enumerate().take(10) {
            println!(
                "  {:03}: {} -> {} ({:.2}s)",
                i + 1,
                format_timecode(*start),
                format_timecode(*end),
                end - start
            );
        }
        if scenes.len() > 10 {
            println!("  ...");
        }

        if opts.list_only {
            processed_ok += 1;
            continue;
        }

        let stem = video
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "video".to_string());
        let base_output = if alongside {
            video.parent().unwrap_or(&root).to_path_buf()
        } else if let Some(subdir) = &source_subdir {
            let run_id = run_id.as_deref().unwrap_or("run");
            video
                .parent()
                .unwrap_or(&root)
                .join(subdir)
                .join("detect")
                .join(run_id)
        } else {
            output_dir.clone()
        };
        if let Err(err) = fs::create_dir_all(&base_output) {
            eprintln!(
                "error: failed to create output dir {}: {err}",
                base_output.display()
            );
            continue;
        }
        if split_video_into_scenes(video, &scenes, &base_output, &stem, &root) {
            println!("✓ Scenes saved to {}", base_output.display());
            processed_ok += 1;
        } else {
            eprintln!("✗ Split failed: {}", video.display());
        }
    }

    println!(
        "\nCompleted: {}/{} video(s) processed successfully",
        processed_ok,
        videos.len()
    );
    0
}

fn run_split_detect(args: &[OsString]) -> i32 {
    let root = match find_repo_root() {
        Some(path) => path,
        None => {
            eprintln!("error: could not locate project root");
            return 1;
        }
    };

    let opts = match parse_split_detect_args(args) {
        Ok(Some(o)) => o,
        Ok(None) => return 0,
        Err(msg) => {
            eprintln!("error: {msg}\n");
            eprintln!("{SPLIT_DETECT_HELP}");
            return 2;
        }
    };

    if !check_ffmpeg_tools(&root) {
        eprintln!("error: ffmpeg and ffprobe are required");
        return 1;
    }

    let alongside = parse_alongside_token(&opts.output_dir);
    let source_subdir = if alongside {
        None
    } else {
        parse_source_output_token(&opts.output_dir)
    };
    let run_id = source_subdir.as_ref().map(|_| run_timestamp_id());
    let output_dir = if source_subdir.is_some() || alongside {
        PathBuf::new()
    } else {
        resolve_output_dir(&root, &opts.output_dir)
    };
    if source_subdir.is_none() && !alongside {
        if let Err(err) = fs::create_dir_all(&output_dir) {
            eprintln!(
                "error: failed to create output dir {}: {err}",
                output_dir.display()
            );
            return 1;
        }
    }

    println!("Split Detect Tool (Rust)");
    if alongside {
        println!("Output directory: alongside originals");
    } else if let Some(subdir) = &source_subdir {
        let run_id = run_id.as_deref().unwrap_or("run");
        println!("Output directory: <source>/{subdir}/split-detect/{run_id}");
    } else {
        println!("Output directory: {}", output_dir.display());
    }

    let mut targets: Vec<(PathBuf, PathBuf)> = Vec::new();
    for input in &opts.inputs {
        let as_path = PathBuf::from(input);
        if as_path.exists() && as_path.is_file() && is_video_file(&as_path) {
            let base = as_path.parent().unwrap_or(&root).to_path_buf();
            targets.push((as_path, base));
            continue;
        }
        let folder = resolve_folder_path(&root, input);
        if folder.exists() && folder.is_dir() {
            for video in get_video_files(&folder) {
                targets.push((video, folder.clone()));
            }
            continue;
        }
        eprintln!("warning: '{}' is not a valid video or folder", input);
    }

    if targets.is_empty() {
        eprintln!("error: no videos found to process");
        return 1;
    }

    let mut failures = 0usize;
    for (video, base_dir) in targets {
        let base_output = if alongside {
            base_dir.clone()
        } else if let Some(subdir) = &source_subdir {
            let run_id = run_id.as_deref().unwrap_or("run");
            base_dir.join(subdir).join("split-detect").join(run_id)
        } else {
            output_dir.clone()
        };

        if let Err(err) = fs::create_dir_all(&base_output) {
            eprintln!(
                "error: failed to create output dir {}: {err}",
                base_output.display()
            );
            failures += 1;
            continue;
        }

        let stem = video
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "video".to_string());

        println!("\nProcessing: {}", video.display());
        let info = match get_video_info(&video, &root) {
            Some(v) => v,
            None => {
                eprintln!("✗ failed to read video info: {}", video.display());
                failures += 1;
                continue;
            }
        };
        let tiles = if opts.force_two_panel {
            build_forced_two_panel_tiles(info.width, info.height)
        } else {
            detect_split_tiles(&video, &root, &info).unwrap_or_else(|| {
                vec![TileRect {
                    x: 0,
                    y: 0,
                    w: info.width,
                    h: info.height,
                }]
            })
        };

        if tiles.is_empty() {
            eprintln!("✗ no tiles detected: {}", video.display());
            failures += 1;
            continue;
        }

        let mut tile_failures = 0usize;
        for (idx, tile) in tiles.iter().enumerate() {
            let tile_dir = base_output.join(&stem).join(format!("tile_{:02}", idx + 1));
            if let Err(err) = fs::create_dir_all(&tile_dir) {
                eprintln!("✗ failed to create tile dir {}: {err}", tile_dir.display());
                tile_failures += 1;
                continue;
            }
            let out_path = tile_dir.join(format!("{stem}_tile_{:02}.mp4", idx + 1));
            if crop_video_to_tile(
                &video,
                &out_path,
                tile,
                &root,
                &opts.quality,
                info.duration,
                opts.clip_seconds,
                opts.fast_preview,
            ) {
                println!("✓ {}", out_path.display());
            } else {
                eprintln!("✗ {}", out_path.display());
                tile_failures += 1;
            }
        }

        if tile_failures > 0 {
            failures += 1;
        }
    }

    if failures > 0 {
        1
    } else {
        0
    }
}

fn run_yt_import(args: &[OsString]) -> i32 {
    let root = match find_repo_root() {
        Some(path) => path,
        None => {
            eprintln!("error: could not locate project root");
            return 1;
        }
    };

    let opts = match parse_yt_import_args(args) {
        Ok(Some(o)) => o,
        Ok(None) => return 0,
        Err(msg) => {
            eprintln!("error: {msg}\n");
            eprintln!("{YT_IMPORT_HELP}");
            return 2;
        }
    };

    if !check_ffmpeg_tools(&root) {
        eprintln!("error: ffmpeg and ffprobe are required");
        return 1;
    }
    if !check_yt_dlp(&root) {
        eprintln!("error: yt-dlp is required");
        return 1;
    }

    let output_dir = resolve_output_dir(&root, &opts.output_dir);
    if let Err(err) = fs::create_dir_all(&output_dir) {
        eprintln!(
            "error: failed to create output dir {}: {err}",
            output_dir.display()
        );
        return 1;
    }

    println!("YouTube Import Tool (Rust)");
    println!("Output directory: {}", output_dir.display());

    let mut failures = 0usize;
    for url in &opts.urls {
        println!("\nFetching: {url}");
        let before_dirs = list_immediate_dirs(&output_dir);
        let output_template = output_dir
            .join("%(id)s")
            .join("video.%(ext)s")
            .to_string_lossy()
            .to_string();
        if !yt_dlp_download(
            &root,
            url,
            &output_template,
            opts.cookies_from_browser.as_deref(),
            opts.cookies_file.as_deref(),
        ) {
            eprintln!("✗ download failed: {url}");
            failures += 1;
            continue;
        }

        let (video_id, base_output) = resolve_import_output_dir(&output_dir, &before_dirs)
            .unwrap_or_else(|| {
                let fallback = format!("import_{}", run_timestamp_id());
                (fallback.clone(), output_dir.join(&fallback))
            });

        let videos = get_video_files_recursive(&base_output);
        let Some(video_path) = videos.first() else {
            eprintln!("✗ no video found for {url}");
            failures += 1;
            continue;
        };
        let info = match get_video_info(video_path, &root) {
            Some(v) => v,
            None => {
                eprintln!("✗ failed to read video info: {}", video_path.display());
                failures += 1;
                continue;
            }
        };

        let tiles = if opts.force_two_panel {
            build_forced_two_panel_tiles(info.width, info.height)
        } else {
            detect_split_tiles(video_path, &root, &info).unwrap_or_else(|| {
                vec![TileRect {
                    x: 0,
                    y: 0,
                    w: info.width,
                    h: info.height,
                }]
            })
        };

        let stem = "video";
        let split_root = if let Some(project) = project_from_output_dir(&root, &output_dir) {
            root.join("src")
                .join(project)
                .join("yt-import")
                .join(&video_id)
        } else {
            base_output.join("splits")
        };
        if let Err(err) = fs::create_dir_all(&split_root) {
            eprintln!(
                "✗ failed to create splits dir {}: {err}",
                split_root.display()
            );
            failures += 1;
            continue;
        }

        let mut tile_failures = 0usize;
        for (idx, tile) in tiles.iter().enumerate() {
            let tile_dir = split_root.join(format!("tile_{:02}", idx + 1));
            if let Err(err) = fs::create_dir_all(&tile_dir) {
                eprintln!("✗ failed to create tile dir {}: {err}", tile_dir.display());
                tile_failures += 1;
                continue;
            }
            let out_path = tile_dir.join(format!("{stem}_tile_{:02}.mp4", idx + 1));
            if crop_video_to_tile(
                video_path,
                &out_path,
                tile,
                &root,
                &opts.quality,
                info.duration,
                opts.clip_seconds,
                opts.fast_preview,
            ) {
                println!("✓ {}", out_path.display());
            } else {
                eprintln!("✗ {}", out_path.display());
                tile_failures += 1;
            }
        }

        if tile_failures > 0 {
            failures += 1;
        }
    }

    if failures > 0 {
        1
    } else {
        0
    }
}

fn run_strip_audio(args: &[OsString]) -> i32 {
    let root = match find_repo_root() {
        Some(path) => path,
        None => {
            eprintln!("error: could not locate project root");
            return 1;
        }
    };

    let opts = match parse_strip_audio_args(args) {
        Ok(Some(o)) => o,
        Ok(None) => return 0,
        Err(msg) => {
            eprintln!("error: {msg}\n");
            eprintln!("{STRIP_AUDIO_HELP}");
            return 2;
        }
    };

    if !check_ffmpeg_tools(&root) {
        eprintln!("error: ffmpeg and ffprobe are required");
        return 1;
    }

    let overwrite = opts.overwrite;
    let alongside = parse_alongside_token(&opts.output_dir);
    let source_subdir = if overwrite || alongside {
        None
    } else {
        parse_source_output_token(&opts.output_dir)
    };
    let run_id = source_subdir.as_ref().map(|_| run_timestamp_id());
    let output_dir = if source_subdir.is_some() || alongside {
        PathBuf::new()
    } else {
        resolve_output_dir(&root, &opts.output_dir)
    };
    if !overwrite && !alongside && source_subdir.is_none() {
        if let Err(err) = fs::create_dir_all(&output_dir) {
            eprintln!(
                "error: failed to create output dir {}: {err}",
                output_dir.display()
            );
            return 1;
        }
    }

    println!("Strip Audio Tool (Rust)");
    if overwrite {
        println!("Output: overwrite originals");
    } else if alongside {
        println!("Output: alongside originals");
    } else if let Some(subdir) = &source_subdir {
        let run_id = run_id.as_deref().unwrap_or("run");
        println!("Output directory: <source>/{subdir}/strip-audio/{run_id}");
    } else {
        println!("Output directory: {}", output_dir.display());
    }

    let mut targets: Vec<(PathBuf, PathBuf)> = Vec::new();
    for input in &opts.inputs {
        let as_path = PathBuf::from(input);
        if as_path.exists() && as_path.is_file() && is_video_file(&as_path) {
            let base = as_path.parent().unwrap_or(&root).to_path_buf();
            targets.push((as_path, base));
            continue;
        }
        let folder = resolve_folder_path(&root, input);
        if folder.exists() && folder.is_dir() {
            for video in get_video_files(&folder) {
                targets.push((video, folder.clone()));
            }
            continue;
        }
        eprintln!("warning: '{}' is not a valid video or folder", input);
    }

    if targets.is_empty() {
        eprintln!("error: no videos found to process");
        return 1;
    }

    let mut failures = 0usize;
    for (video, base_dir) in targets {
        let base_output = if overwrite {
            base_dir.clone()
        } else if alongside {
            base_dir.clone()
        } else if let Some(subdir) = &source_subdir {
            let run_id = run_id.as_deref().unwrap_or("run");
            base_dir.join(subdir).join("strip-audio").join(run_id)
        } else {
            output_dir.clone()
        };
        if !overwrite && !alongside {
            if let Err(err) = fs::create_dir_all(&base_output) {
                eprintln!(
                    "error: failed to create output dir {}: {err}",
                    base_output.display()
                );
                failures += 1;
                continue;
            }
        }
        let out_path = if overwrite {
            overwrite_temp_path(&video, "strip_tmp")
        } else {
            build_no_audio_output_path(&base_output, &video)
        };
        println!("\nProcessing: {}", video.display());
        if strip_audio_video(&video, &out_path, &root) {
            if overwrite {
                if let Err(err) = fs::rename(&out_path, &video) {
                    failures += 1;
                    eprintln!("✗ {} ({err})", video.display());
                    let _ = fs::remove_file(&out_path);
                } else {
                    println!("✓ {}", video.display());
                }
            } else {
                println!("✓ {}", out_path.display());
            }
        } else {
            failures += 1;
            eprintln!("✗ {}", video.display());
            if overwrite {
                let _ = fs::remove_file(&out_path);
            }
        }
    }

    if failures > 0 {
        1
    } else {
        0
    }
}

fn tool_log_path(tool_name: &str) -> PathBuf {
    let root = find_repo_root()
        .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let dir = root.join("outputs").join("tui-logs");
    let _ = fs::create_dir_all(&dir);
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    dir.join(format!("tui_{tool_name}_{ts}.log"))
}

fn write_tool_log(path: &Path, lines: &[String]) {
    let mut body = String::new();
    for l in lines {
        body.push_str(l);
        body.push('\n');
    }
    if fs::write(path, body).is_ok() {
        println!("Log written: {}", path.display());
    }
}

fn run_doctor_reencode(args: &[OsString]) -> i32 {
    if args
        .iter()
        .any(|a| matches!(a.to_string_lossy().as_ref(), "-h" | "--help" | "help"))
    {
        println!("{DOCTOR_REENCODE_HELP}");
        return 0;
    }
    let root = find_repo_root();
    let mut folders = Vec::<String>::new();
    let mut output_override: Option<PathBuf> = None;
    let mut alongside = false;
    let mut fps = 30.0_f64;
    let mut keep_audio = true;
    let mut overwrite = false;
    let mut i = 0usize;
    while i < args.len() {
        let t = args[i].to_string_lossy().to_string();
        match t.as_str() {
            "-o" | "--output" => {
                i += 1;
                if i >= args.len() {
                    eprintln!("error: missing value for --output");
                    return 2;
                }
                let output = args[i].to_string_lossy();
                if parse_alongside_token(output.as_ref()) {
                    alongside = true;
                    output_override = None;
                } else {
                    let base = root.as_deref().unwrap_or_else(|| Path::new("."));
                    output_override = Some(resolve_output_dir(base, &output));
                }
            }
            "--fps" => {
                i += 1;
                if i >= args.len() {
                    eprintln!("error: missing value for --fps");
                    return 2;
                }
                fps = args[i]
                    .to_string_lossy()
                    .parse::<f64>()
                    .unwrap_or(30.0)
                    .max(1.0);
            }
            "--no-audio" => keep_audio = false,
            "--overwrite" => overwrite = true,
            _ if t.starts_with('-') => {
                eprintln!("error: unknown option {t}");
                return 2;
            }
            _ => folders.push(t),
        }
        i += 1;
    }

    if args.is_empty() {
        fps = prompt_optional_f64("Target FPS", Some(30.0)).unwrap_or(30.0);
        keep_audio = prompt_yes_no("Keep audio?", true);
        overwrite = prompt_yes_no("Overwrite originals? (otherwise use doctor_cfr/)", false);
    }

    let base = root.as_deref().unwrap_or_else(|| Path::new("."));
    let mut targets: Vec<(PathBuf, PathBuf)> = Vec::new();
    if folders.is_empty() {
        for f in resolve_selected_folders(root.as_deref(), "Select folders to re-encode") {
            for video in get_video_files(&f) {
                targets.push((video, f.clone()));
            }
        }
    } else {
        for input in &folders {
            let as_path = PathBuf::from(input);
            if as_path.exists() && as_path.is_file() && is_video_file(&as_path) {
                let parent = as_path.parent().unwrap_or(base).to_path_buf();
                targets.push((as_path, parent));
                continue;
            }
            let folder = resolve_folder_path(base, input);
            if folder.exists() && folder.is_dir() {
                for video in get_video_files(&folder) {
                    targets.push((video, folder.clone()));
                }
                continue;
            }
            eprintln!("warning: '{}' is not a valid video or folder", input);
        }
    }
    if targets.is_empty() {
        eprintln!("No video files found.");
        return 1;
    }

    if let Some(dir) = output_override.as_ref() {
        let _ = fs::create_dir_all(dir);
    }

    let mut processed = 0usize;
    let mut lines = Vec::<String>::new();
    let total = targets.len();
    for (file, base_dir) in targets {
        let out_dir = if overwrite {
            base_dir.clone()
        } else if alongside {
            base_dir.clone()
        } else if let Some(dir) = output_override.as_ref() {
            dir.clone()
        } else {
            let d = base_dir.join("doctor_cfr");
            let _ = fs::create_dir_all(&d);
            d
        };
        processed += 1;
        lines.push(format!(
            "Re-encoding ({processed}/{total}) {}",
            file.display()
        ));
        let target = if overwrite {
            let mut tmp = file.clone();
            tmp.set_extension("doctor_tmp.mp4");
            tmp
        } else {
            out_dir.join(file.file_name().unwrap_or_default())
        };

        let mut cmd = Command::new("ffmpeg");
        cmd.arg("-v")
            .arg("error")
            .arg("-fflags")
            .arg("+genpts")
            .arg("-i")
            .arg(&file)
            .arg("-vf")
            .arg(format!("fps={fps}"))
            .arg("-vsync")
            .arg("cfr")
            .arg("-c:v")
            .arg("libx264")
            .arg("-preset")
            .arg("medium")
            .arg("-crf")
            .arg("23");
        if keep_audio {
            cmd.arg("-c:a").arg("aac").arg("-b:a").arg("192k");
        } else {
            cmd.arg("-an");
        }
        let ok = matches!(cmd.arg("-y").arg(&target).output(), Ok(o) if o.status.success());
        if ok && overwrite {
            let _ = fs::rename(&target, &file);
        }
        if !ok {
            lines.push(format!("Failed: {}", file.display()));
            if overwrite {
                let _ = fs::remove_file(&target);
            }
        }
    }
    let log_path = tool_log_path("doctor_reencode");
    write_tool_log(&log_path, &lines);
    0
}

fn run_doctor_trim_start(args: &[OsString]) -> i32 {
    if args
        .iter()
        .any(|a| matches!(a.to_string_lossy().as_ref(), "-h" | "--help" | "help"))
    {
        println!("{DOCTOR_TRIM_HELP}");
        return 0;
    }
    let root = find_repo_root();
    let mut folders = Vec::<String>::new();
    let mut output_override: Option<PathBuf> = None;
    let mut alongside = false;
    let mut seconds = 1.0_f64;
    let mut keep_audio = true;
    let mut overwrite = false;
    let mut i = 0usize;
    while i < args.len() {
        let t = args[i].to_string_lossy().to_string();
        match t.as_str() {
            "-o" | "--output" => {
                i += 1;
                if i >= args.len() {
                    eprintln!("error: missing value for --output");
                    return 2;
                }
                let output = args[i].to_string_lossy();
                if parse_alongside_token(output.as_ref()) {
                    alongside = true;
                    output_override = None;
                } else {
                    let base = root.as_deref().unwrap_or_else(|| Path::new("."));
                    output_override = Some(resolve_output_dir(base, &output));
                }
            }
            "--seconds" => {
                i += 1;
                if i >= args.len() {
                    eprintln!("error: missing value for --seconds");
                    return 2;
                }
                seconds = args[i]
                    .to_string_lossy()
                    .parse::<f64>()
                    .unwrap_or(1.0)
                    .max(0.0);
            }
            "--no-audio" => keep_audio = false,
            "--overwrite" => overwrite = true,
            _ if t.starts_with('-') => {
                eprintln!("error: unknown option {t}");
                return 2;
            }
            _ => folders.push(t),
        }
        i += 1;
    }

    if args.is_empty() {
        seconds = prompt_optional_f64("Trim seconds from start", Some(1.0)).unwrap_or(1.0);
        keep_audio = prompt_yes_no("Keep audio?", true);
        overwrite = prompt_yes_no("Overwrite originals? (otherwise use doctor_trim/)", false);
    }

    let base = root.as_deref().unwrap_or_else(|| Path::new("."));
    let mut targets: Vec<(PathBuf, PathBuf)> = Vec::new();
    if folders.is_empty() {
        for f in resolve_selected_folders(root.as_deref(), "Select folders to trim") {
            for video in get_video_files(&f) {
                targets.push((video, f.clone()));
            }
        }
    } else {
        for input in &folders {
            let as_path = PathBuf::from(input);
            if as_path.exists() && as_path.is_file() && is_video_file(&as_path) {
                let parent = as_path.parent().unwrap_or(base).to_path_buf();
                targets.push((as_path, parent));
                continue;
            }
            let folder = resolve_folder_path(base, input);
            if folder.exists() && folder.is_dir() {
                for video in get_video_files(&folder) {
                    targets.push((video, folder.clone()));
                }
                continue;
            }
            eprintln!("warning: '{}' is not a valid video or folder", input);
        }
    }
    if targets.is_empty() {
        eprintln!("No video files found.");
        return 1;
    }

    if let Some(dir) = output_override.as_ref() {
        let _ = fs::create_dir_all(dir);
    }
    let mut processed = 0usize;
    let mut lines = Vec::<String>::new();
    let total = targets.len();
    for (file, base_dir) in targets {
        let out_dir = if overwrite {
            base_dir.clone()
        } else if alongside {
            base_dir.clone()
        } else if let Some(dir) = output_override.as_ref() {
            dir.clone()
        } else {
            let d = base_dir.join("doctor_trim");
            let _ = fs::create_dir_all(&d);
            d
        };
        processed += 1;
        lines.push(format!("Trim ({processed}/{total}) {}", file.display()));
        let target = if overwrite {
            let mut tmp = file.clone();
            tmp.set_extension("doctor_trim_tmp.mp4");
            tmp
        } else {
            out_dir.join(file.file_name().unwrap_or_default())
        };
        let mut cmd = Command::new("ffmpeg");
        cmd.arg("-v")
            .arg("error")
            .arg("-i")
            .arg(&file)
            .arg("-ss")
            .arg(format!("{seconds:.3}"))
            .arg("-c:v")
            .arg("libx264")
            .arg("-preset")
            .arg("medium")
            .arg("-crf")
            .arg("23");
        if keep_audio {
            cmd.arg("-c:a").arg("aac").arg("-b:a").arg("192k");
        } else {
            cmd.arg("-an");
        }
        let ok = matches!(cmd.arg("-y").arg(&target).output(), Ok(o) if o.status.success());
        if ok && overwrite {
            let _ = fs::rename(&target, &file);
        }
        if !ok {
            lines.push(format!("Failed: {}", file.display()));
            if overwrite {
                let _ = fs::remove_file(&target);
            }
        }
    }
    let log_path = tool_log_path("doctor_trim");
    write_tool_log(&log_path, &lines);
    0
}

fn run_organize_landscape(args: &[OsString]) -> i32 {
    if args
        .iter()
        .any(|a| matches!(a.to_string_lossy().as_ref(), "-h" | "--help" | "help"))
    {
        println!("{ORGANIZE_LANDSCAPE_HELP}");
        return 0;
    }
    let root = find_repo_root();
    let folders: Vec<PathBuf> = if args.is_empty() {
        resolve_selected_folders(root.as_deref(), "Select folders to split landscape")
    } else {
        let base = root.as_deref().unwrap_or_else(|| Path::new("."));
        args.iter()
            .map(|a| resolve_folder_path(base, &a.to_string_lossy()))
            .collect()
    };
    if folders.is_empty() {
        eprintln!("No folders selected.");
        return 1;
    }
    let mut moved = 0usize;
    let mut skipped = 0usize;
    let mut lines = Vec::<String>::new();
    let base = root
        .as_deref()
        .unwrap_or_else(|| Path::new("."))
        .to_path_buf();
    for folder in folders {
        let out = folder.join("landscape");
        let _ = fs::create_dir_all(&out);
        for file in get_video_files(&folder) {
            let info = get_video_info(&file, &base);
            let Some(info) = info else {
                skipped += 1;
                lines.push(format!("Skip (no dims): {}", file.display()));
                continue;
            };
            if info.width > info.height {
                let target = out.join(file.file_name().unwrap_or_default());
                if target.exists() {
                    skipped += 1;
                    lines.push(format!("Skip exists: {}", target.display()));
                } else if fs::rename(&file, &target).is_ok() {
                    moved += 1;
                    lines.push(format!("Moved: {}", target.display()));
                } else {
                    skipped += 1;
                    lines.push(format!("Failed move: {}", file.display()));
                }
            }
        }
    }
    lines.push(format!("Moved: {moved}, skipped: {skipped}"));
    let log_path = tool_log_path("organize_landscape");
    write_tool_log(&log_path, &lines);
    0
}

fn run_slowmo(args: &[OsString]) -> i32 {
    if args
        .iter()
        .any(|a| matches!(a.to_string_lossy().as_ref(), "-h" | "--help" | "help"))
    {
        println!("{SLOWMO_HELP}");
        return 0;
    }
    let root = find_repo_root();
    let mut folders = Vec::<String>::new();
    let mut output_override: Option<PathBuf> = None;
    let mut alongside = false;
    let mut factor = 0.5_f64;
    let mut keep_audio = true;
    let mut overwrite = false;
    let mut i = 0usize;
    while i < args.len() {
        let t = args[i].to_string_lossy().to_string();
        match t.as_str() {
            "-o" | "--output" => {
                i += 1;
                if i >= args.len() {
                    eprintln!("error: missing value for --output");
                    return 2;
                }
                let output = args[i].to_string_lossy();
                if parse_alongside_token(output.as_ref()) {
                    alongside = true;
                    output_override = None;
                } else {
                    let base = root.as_deref().unwrap_or_else(|| Path::new("."));
                    output_override = Some(resolve_output_dir(base, &output));
                }
            }
            "--factor" => {
                i += 1;
                if i >= args.len() {
                    eprintln!("error: missing value for --factor");
                    return 2;
                }
                factor = args[i]
                    .to_string_lossy()
                    .parse::<f64>()
                    .unwrap_or(0.5)
                    .max(0.01);
            }
            "--no-audio" => keep_audio = false,
            "--overwrite" => overwrite = true,
            _ if t.starts_with('-') => {
                eprintln!("error: unknown option {t}");
                return 2;
            }
            _ => folders.push(t),
        }
        i += 1;
    }
    if args.is_empty() {
        factor = prompt_optional_f64("Speed factor (0.5 is 2x slower)", Some(0.5)).unwrap_or(0.5);
        keep_audio = prompt_yes_no("Keep audio?", true);
        overwrite = prompt_yes_no("Overwrite originals? (otherwise use slowmo/)", false);
    }
    let base = root.as_deref().unwrap_or_else(|| Path::new("."));
    let mut targets: Vec<(PathBuf, PathBuf)> = Vec::new();
    if folders.is_empty() {
        for f in resolve_selected_folders(root.as_deref(), "Select folders for slow motion") {
            for video in get_video_files(&f) {
                targets.push((video, f.clone()));
            }
        }
    } else {
        for input in &folders {
            let as_path = PathBuf::from(input);
            if as_path.exists() && as_path.is_file() && is_video_file(&as_path) {
                let parent = as_path.parent().unwrap_or(base).to_path_buf();
                targets.push((as_path, parent));
                continue;
            }
            let folder = resolve_folder_path(base, input);
            if folder.exists() && folder.is_dir() {
                for video in get_video_files(&folder) {
                    targets.push((video, folder.clone()));
                }
                continue;
            }
            eprintln!("warning: '{}' is not a valid video or folder", input);
        }
    }
    if targets.is_empty() {
        eprintln!("No video files found.");
        return 1;
    }

    if let Some(dir) = output_override.as_ref() {
        let _ = fs::create_dir_all(dir);
    }

    let mut lines = Vec::<String>::new();
    let mut processed = 0usize;
    let total = targets.len();
    for (file, base_dir) in targets {
        let out_dir = if overwrite {
            base_dir.clone()
        } else if alongside {
            base_dir.clone()
        } else if let Some(dir) = output_override.as_ref() {
            dir.clone()
        } else {
            let d = base_dir.join("slowmo");
            let _ = fs::create_dir_all(&d);
            d
        };
        processed += 1;
        lines.push(format!("Slowmo ({processed}/{total}) {}", file.display()));
        let target = if overwrite {
            let mut tmp = file.clone();
            tmp.set_extension("slowmo_tmp.mp4");
            tmp
        } else {
            out_dir.join(file.file_name().unwrap_or_default())
        };

        let mut pipeline = FFmpegPipeline::new(base);
        pipeline.cmd.arg("-i").arg(&file);

        let v_filter = format!("setpts={:.6}*PTS", 1.0 / factor);
        pipeline.apply_video_params(Some(v_filter));

        if keep_audio && has_audio_stream(&file, base) {
            let a_filter = build_atempo_filter(factor);
            pipeline.apply_audio_params(Some(a_filter));
        } else {
            pipeline.apply_canonical_audio_params(false);
        }

        let ok = pipeline.run(&target);

        if ok && overwrite {
            let _ = fs::rename(&target, &file);
        }
        if !ok {
            lines.push(format!("Failed: {}", file.display()));
            if overwrite {
                let _ = fs::remove_file(&target);
            }
        }
    }
    let log_path = tool_log_path("slowmo");
    write_tool_log(&log_path, &lines);
    0
}

fn run_crop(args: &[OsString]) -> i32 {
    if args
        .iter()
        .any(|a| matches!(a.to_string_lossy().as_ref(), "-h" | "--help" | "help"))
    {
        println!("{CROP_HELP}");
        return 0;
    }
    let root = find_repo_root();
    let mut folders = Vec::<String>::new();
    let mut output_override: Option<PathBuf> = None;
    let mut alongside = false;
    let mut crop_x: u32 = 0;
    let mut crop_y: u32 = 0;
    let mut crop_w: Option<u32> = None;
    let mut crop_h: Option<u32> = None;
    let mut overwrite = false;
    let mut i = 0usize;
    while i < args.len() {
        let t = args[i].to_string_lossy().to_string();
        match t.as_str() {
            "-o" | "--output" => {
                i += 1;
                if i >= args.len() {
                    eprintln!("error: missing value for --output");
                    return 2;
                }
                let output = args[i].to_string_lossy();
                if parse_alongside_token(output.as_ref()) {
                    alongside = true;
                    output_override = None;
                } else {
                    let base = root.as_deref().unwrap_or_else(|| Path::new("."));
                    output_override = Some(resolve_output_dir(base, &output));
                }
            }
            "--x" => {
                i += 1;
                if i >= args.len() {
                    eprintln!("error: missing value for --x");
                    return 2;
                }
                crop_x = args[i].to_string_lossy().parse::<u32>().unwrap_or(0);
            }
            "--y" => {
                i += 1;
                if i >= args.len() {
                    eprintln!("error: missing value for --y");
                    return 2;
                }
                crop_y = args[i].to_string_lossy().parse::<u32>().unwrap_or(0);
            }
            "--w" => {
                i += 1;
                if i >= args.len() {
                    eprintln!("error: missing value for --w");
                    return 2;
                }
                crop_w = Some(args[i].to_string_lossy().parse::<u32>().unwrap_or(0));
            }
            "--h" => {
                i += 1;
                if i >= args.len() {
                    eprintln!("error: missing value for --h");
                    return 2;
                }
                crop_h = Some(args[i].to_string_lossy().parse::<u32>().unwrap_or(0));
            }
            "--overwrite" => overwrite = true,
            _ if t.starts_with('-') => {
                eprintln!("error: unknown option {t}");
                return 2;
            }
            _ => folders.push(t),
        }
        i += 1;
    }
    let w = match crop_w {
        Some(v) if v > 0 => v,
        _ => {
            eprintln!("error: --w (crop width) is required and must be > 0");
            return 2;
        }
    };
    let h = match crop_h {
        Some(v) if v > 0 => v,
        _ => {
            eprintln!("error: --h (crop height) is required and must be > 0");
            return 2;
        }
    };
    let base = root.as_deref().unwrap_or_else(|| Path::new("."));
    let mut targets: Vec<(PathBuf, PathBuf)> = Vec::new();
    if folders.is_empty() {
        for f in resolve_selected_folders(root.as_deref(), "Select folders for crop") {
            for video in get_video_files(&f) {
                targets.push((video, f.clone()));
            }
        }
    } else {
        for input in &folders {
            let as_path = PathBuf::from(input);
            if as_path.exists() && as_path.is_file() && is_video_file(&as_path) {
                let parent = as_path.parent().unwrap_or(base).to_path_buf();
                targets.push((as_path, parent));
                continue;
            }
            let folder = resolve_folder_path(base, input);
            if folder.exists() && folder.is_dir() {
                for video in get_video_files(&folder) {
                    targets.push((video, folder.clone()));
                }
                continue;
            }
            eprintln!("warning: '{}' is not a valid video or folder", input);
        }
    }
    if targets.is_empty() {
        eprintln!("No video files found.");
        return 1;
    }

    if let Some(dir) = output_override.as_ref() {
        let _ = fs::create_dir_all(dir);
    }

    let mut lines = Vec::<String>::new();
    let mut processed = 0usize;
    let total = targets.len();
    for (file, base_dir) in targets {
        // Validate crop region against video dimensions
        let info = get_video_info(&file, base);
        if let Some(ref info) = info {
            if crop_x + w > info.width || crop_y + h > info.height {
                lines.push(format!(
                    "Skip (crop {}x{}+{}+{} exceeds {}x{}): {}",
                    w, h, crop_x, crop_y, info.width, info.height, file.display()
                ));
                continue;
            }
        }

        let out_dir = if overwrite {
            base_dir.clone()
        } else if alongside {
            base_dir.clone()
        } else if let Some(dir) = output_override.as_ref() {
            dir.clone()
        } else {
            let d = base_dir.join("crop");
            let _ = fs::create_dir_all(&d);
            d
        };
        processed += 1;
        lines.push(format!("Crop ({processed}/{total}) {}", file.display()));
        let target = if overwrite {
            let mut tmp = file.clone();
            tmp.set_extension("crop_tmp.mp4");
            tmp
        } else {
            out_dir.join(file.file_name().unwrap_or_default())
        };

        let mut pipeline = FFmpegPipeline::new(base);
        pipeline.cmd.arg("-i").arg(&file);
        
        let crop_filter = format!("crop={w}:{h}:{crop_x}:{crop_y}");
        pipeline.apply_video_params(Some(crop_filter));
        pipeline.apply_canonical_audio_params(has_audio_stream(&file, base));

        let ok = pipeline.run(&target);

        if ok && overwrite {
            let _ = fs::rename(&target, &file);
        }
        if !ok {
            lines.push(format!("Failed: {}", file.display()));
            if overwrite {
                let _ = fs::remove_file(&target);
            }
        }
    }
    let log_path = tool_log_path("crop");
    write_tool_log(&log_path, &lines);
    0
}

fn run_chop(args: &[OsString]) -> i32 {
    let root = match find_repo_root() {
        Some(path) => path,
        None => {
            eprintln!("error: could not locate project root");
            return 1;
        }
    };

    let opts = match parse_chop_args(args) {
        Ok(Some(o)) => o,
        Ok(None) => return 0,
        Err(msg) => {
            eprintln!("error: {msg}\n");
            eprintln!("{CHOP_HELP}");
            return 2;
        }
    };

    if !check_ffmpeg_tools(&root) {
        eprintln!("error: ffmpeg and ffprobe are required");
        return 1;
    }

    let overwrite = opts.overwrite;
    let alongside = parse_alongside_token(&opts.output_dir);
    let source_subdir = if overwrite || alongside {
        None
    } else {
        parse_source_output_token(&opts.output_dir)
    };
    let run_id = source_subdir.as_ref().map(|_| run_timestamp_id());
    let output_dir = if source_subdir.is_some() || alongside {
        PathBuf::new()
    } else {
        resolve_output_dir(&root, &opts.output_dir)
    };
    if !overwrite && !alongside && source_subdir.is_none() {
        if let Err(err) = fs::create_dir_all(&output_dir) {
            eprintln!(
                "error: failed to create output dir {}: {err}",
                output_dir.display()
            );
            return 1;
        }
    }

    println!("Video Chop Tool (Rust)");
    if overwrite {
        println!("Output: overwrite originals");
    } else if alongside {
        println!("Output: alongside originals");
    } else if let Some(subdir) = &source_subdir {
        let rid = run_id.as_deref().unwrap_or("run");
        println!("Output directory: <source>/{subdir}/chop/{rid} (per folder)");
    } else {
        println!("Output directory: {}", output_dir.display());
    }
    if let Some(count) = opts.count {
        println!("Mode: split into {count} equal parts");
    } else {
        let dur = opts.duration.unwrap_or(30.0);
        println!("Mode: split every {dur}s");
    }

    let mut lines = Vec::<String>::new();
    let mut failures = 0usize;
    for input in &opts.folders {
        let as_path = PathBuf::from(input);
        if as_path.exists() && as_path.is_file() && is_video_file(&as_path) {
            let base_dir = as_path.parent().unwrap_or(&root);
            let base_output = if overwrite {
                base_dir.to_path_buf()
            } else if alongside {
                base_dir.to_path_buf()
            } else if let Some(subdir) = &source_subdir {
                let rid = run_id.as_deref().unwrap_or("run");
                base_dir.join(subdir).join("chop").join(rid)
            } else {
                output_dir.clone()
            };
            if !overwrite && !alongside {
                if let Err(err) = fs::create_dir_all(&base_output) {
                    eprintln!(
                        "error: failed to create output dir {}: {err}",
                        base_output.display()
                    );
                    failures += 1;
                    continue;
                }
            }
            if !chop_video(&as_path, &base_output, &opts, &root, &mut lines) {
                failures += 1;
            }
            continue;
        }
        let folder = resolve_folder_path(&root, input);
        if folder.exists() && folder.is_dir() {
            let base_output = if overwrite {
                folder.clone()
            } else if alongside {
                folder.clone()
            } else if let Some(subdir) = &source_subdir {
                let rid = run_id.as_deref().unwrap_or("run");
                folder.join(subdir).join("chop").join(rid)
            } else {
                output_dir.clone()
            };
            if !overwrite && !alongside {
                let _ = fs::create_dir_all(&base_output);
            }
            for video in get_video_files(&folder) {
                if !chop_video(&video, &base_output, &opts, &root, &mut lines) {
                    failures += 1;
                }
            }
            continue;
        }
        eprintln!("warning: '{}' is not a valid video or folder", input);
    }

    if failures > 0 {
        lines.push(format!("{failures} file(s) failed"));
    }
    let log_path = tool_log_path("chop");
    write_tool_log(&log_path, &lines);
    if failures > 0 {
        1
    } else {
        0
    }
}

fn chop_video(
    input: &Path,
    output_dir: &Path,
    opts: &ChopOptions,
    root: &Path,
    lines: &mut Vec<String>,
) -> bool {
    let total_duration = match get_video_duration(input, root) {
        Some(d) if d > 0.0 => d,
        _ => {
            let msg = format!("Could not get duration for {}", input.display());
            eprintln!("{msg}");
            lines.push(msg);
            return false;
        }
    };

    let segment_duration = if let Some(count) = opts.count {
        if count == 0 {
            eprintln!("count must be > 0");
            return false;
        }
        total_duration / count as f64
    } else {
        opts.duration.unwrap_or(30.0)
    };

    if segment_duration <= 0.0 {
        eprintln!("segment duration must be > 0");
        return false;
    }

    let stem = input
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "output".to_string());
    let ext = input
        .extension()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "mp4".to_string());

    println!(
        "\nChopping {} ({:.1}s) into ~{:.1}s segments",
        input.display(),
        total_duration,
        segment_duration
    );
    lines.push(format!(
        "Chop {} ({:.1}s) -> {:.1}s segments",
        input.display(),
        total_duration,
        segment_duration
    ));

    let mut current_start = 0.0_f64;
    let mut segment_idx = 1;
    let mut success = true;

    while current_start < total_duration {
        let out_path = output_dir.join(format!("{stem}_{segment_idx:03}.{ext}"));
        let mut pipeline = FFmpegPipeline::new(root);
        pipeline.cmd.arg("-ss").arg(format!("{current_start:.3}"));
        pipeline.cmd.arg("-i").arg(input);
        
        let remaining = total_duration - current_start;
        let this_duration = if remaining < segment_duration {
            remaining
        } else {
            segment_duration
        };
        pipeline.set_duration(this_duration);

        pipeline.apply_canonical_video_params();
        pipeline.apply_canonical_audio_params(has_audio_stream(input, root));

        if !pipeline.run(&out_path) {
            let msg = format!("Failed to create segment {} for {}", segment_idx, input.display());
            eprintln!("{msg}");
            lines.push(msg);
            success = false;
            break;
        }

        println!("  ✓ {}", out_path.display());
        lines.push(format!("  OK: {}", out_path.display()));
        
        current_start += this_duration;
        segment_idx += 1;
        
        // Safety break for extremely small durations
        if this_duration < 0.1 { break; }
    }

    success
}

fn parse_chop_args(args: &[OsString]) -> Result<Option<ChopOptions>, String> {
    if args
        .iter()
        .any(|a| matches!(a.to_string_lossy().as_ref(), "-h" | "--help" | "help"))
    {
        println!("{CHOP_HELP}");
        return Ok(None);
    }

    let mut folders: Vec<String> = Vec::new();
    let mut output_dir = "outputs/chop".to_string();
    let mut duration: Option<f64> = None;
    let mut count: Option<u64> = None;
    let mut overwrite = false;

    let mut i = 0usize;
    while i < args.len() {
        let token = args[i].to_string_lossy().to_string();
        match token.as_str() {
            "-o" | "--output" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --output".to_string());
                }
                output_dir = args[i].to_string_lossy().to_string();
            }
            "--duration" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --duration".to_string());
                }
                let v = args[i]
                    .to_string_lossy()
                    .parse::<f64>()
                    .map_err(|_| "duration must be a number".to_string())?;
                if v <= 0.0 {
                    return Err("duration must be > 0".to_string());
                }
                duration = Some(v);
            }
            "--count" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --count".to_string());
                }
                let v = args[i]
                    .to_string_lossy()
                    .parse::<u64>()
                    .map_err(|_| "count must be a positive integer".to_string())?;
                if v == 0 {
                    return Err("count must be > 0".to_string());
                }
                count = Some(v);
            }
            "--overwrite" => overwrite = true,
            _ if token.starts_with('-') => {
                return Err(format!("unknown option: {token}"));
            }
            _ => folders.push(token),
        }
        i += 1;
    }

    if folders.is_empty() {
        return Err("at least one input file or folder is required".to_string());
    }

    Ok(Some(ChopOptions {
        folders,
        output_dir,
        duration,
        count,
        overwrite,
    }))
}

fn run_tile(args: &[OsString]) -> i32 {
    let root = match find_repo_root() {
        Some(path) => path,
        None => {
            eprintln!("error: could not locate repo root containing project files");
            return 1;
        }
    };

    let mut opts = match parse_tile_args(args) {
        Ok(Some(o)) => o,
        Ok(None) => return 0,
        Err(msg) => {
            eprintln!("error: {msg}\n");
            eprintln!("{TILE_HELP}");
            return 2;
        }
    };

    let mut loaded_settings = LoadedSettings::default();
    if let Some(settings_path) = opts.settings_path.clone() {
        let settings_file = {
            let p = PathBuf::from(settings_path);
            if p.is_absolute() {
                p
            } else {
                root.join(p)
            }
        };
        match load_settings_json(&settings_file) {
            Ok(loaded) => {
                loaded_settings = loaded.clone();
                if opts.folders.is_empty() && !loaded.tile_folders.is_empty() {
                    opts.folders = loaded.tile_folders.clone();
                }
                if let Some(layout) = loaded.layout_code {
                    opts.layout = layout;
                }
                if let Some(lm) = loaded.layout_mode {
                    opts.layout_mode = lm;
                }
                if let Some(crop_mode) = loaded.crop_mode {
                    opts.crop_mode = crop_mode;
                }
                if let Some(render_mode) = loaded.render_mode {
                    opts.render_mode = render_mode;
                }
                if let Some(audio_enabled) = loaded.audio_enabled {
                    opts.audio_enabled = audio_enabled;
                }
                if !loaded.audio_tiles.is_empty() {
                    opts.audio_tiles = loaded.audio_tiles.clone();
                } else if let Some(audio_tile) = loaded.audio_tile {
                    opts.audio_tiles = vec![audio_tile];
                }
                if opts.max_total_duration.is_none() {
                    opts.max_total_duration = loaded.max_total_duration;
                }
                if opts.max_duration.is_none() {
                    opts.max_duration = loaded.max_duration;
                }
                if let Some(dm) = loaded.distribution_mode {
                    opts.distribution_mode = dm;
                }
                if let Some(sm) = loaded.sizing_mode {
                    opts.sizing_mode = sm;
                }
                if let Some(cw) = loaded.canvas_width {
                    opts.width = cw;
                }
                if let Some(ch) = loaded.canvas_height {
                    opts.height = ch;
                }
                if let Some(p) = loaded.padding {
                    opts.padding = p;
                }
                if let Some(ref bg) = loaded.bg_color {
                    opts.bg_color = bg.clone();
                }
                if let Some(nr) = loaded.no_repeat {
                    opts.no_repeat = nr;
                }
                if opts.output_length_policy == "auto" {
                    if let Some(ref p) = loaded.output_length_policy {
                        opts.output_length_policy = p.to_lowercase();
                    }
                }
                if let Some(ref p) = loaded.source_repeat_policy {
                    opts.source_repeat_policy = p.to_lowercase();
                }
            }
            Err(err) => {
                eprintln!("error loading settings {}: {err}", settings_file.display());
                return 1;
            }
        }
    }

    if !check_ffmpeg_tools(&root) {
        eprintln!("error: ffmpeg and ffprobe are required");
        return 1;
    }

    let mut custom_rects: Vec<LayoutRect> = Vec::new();
    if opts.layout_mode == "custom" {
        custom_rects = loaded_settings.layout_rects.clone();
        if custom_rects.is_empty() {
            eprintln!("error: custom layout requires layout_rects");
            return 2;
        }
        opts.layout = "custom".to_string();
        opts.sizing_mode = "fixed".to_string();
    }

    let tile_count = if opts.layout == "custom" {
        custom_rects.len()
    } else {
        match layout_tile_count(&opts.layout) {
            Some(v) => v,
            None => {
                eprintln!("error: unsupported layout '{}'", opts.layout);
                return 2;
            }
        }
    };
    if opts.audio_enabled && opts.audio_tiles.is_empty() {
        opts.audio_tiles = vec![0];
    }

    let mut folders: Vec<PathBuf> = opts
        .folders
        .iter()
        .map(|f| resolve_folder_path(&root, f))
        .collect();

    if folders.len() == 1 && tile_count > 1 {
        folders = vec![folders[0].clone(); tile_count];
    }
    if folders.len() != tile_count {
        eprintln!(
            "error: layout '{}' requires {} folder(s), got {}",
            opts.layout,
            tile_count,
            folders.len()
        );
        return 2;
    }

    let mut output_path = match &opts.output {
        Some(o) => {
            let p = PathBuf::from(o);
            if p.is_absolute() {
                p
            } else {
                root.join(p)
            }
        }
        None => default_tiled_output(&root, &opts.layout, &folders),
    };
    if opts.no_overwrite {
        output_path = resolve_output_no_overwrite(output_path);
    }
    if let Some(parent) = output_path.parent() {
        if let Err(err) = fs::create_dir_all(parent) {
            eprintln!(
                "error: failed to create output dir {}: {err}",
                parent.display()
            );
            return 1;
        }
    }

    let temp_dir = env::temp_dir().join(format!(
        "tiles_tile_{}_{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    ));
    if let Err(err) = fs::create_dir_all(&temp_dir) {
        eprintln!(
            "error: failed to create temp dir {}: {err}",
            temp_dir.display()
        );
        return 1;
    }

    println!("Video Tiling Tool (Rust)");
    println!("Layout: {}", opts.layout);
    println!("Output: {}", output_path.display());
    println!("Render mode: {}", opts.render_mode);
    println!("Crop mode: {}", opts.crop_mode);
    println!("Distribution: {}", opts.distribution_mode);

    let mut tile_paths: Vec<PathBuf> = Vec::new();
    let mut tile_durations: Vec<f64> = Vec::new();

    let preview_limit = if opts.render_mode == "preview" {
        3
    } else if opts.render_mode == "fast-preview" {
        2
    } else {
        usize::MAX
    };

    let mut effective_width = opts.width;
    let mut effective_height = opts.height;

    let custom_dims = if opts.layout == "custom" {
        if opts.render_mode == "fast-preview" {
            effective_width = 640;
            effective_height = 360;
        }
        Some(build_custom_dimensions(
            &custom_rects,
            effective_width,
            effective_height,
            opts.padding,
        ))
    } else {
        None
    };

    let adaptive_dims = if opts.sizing_mode == "adaptive" && opts.layout != "custom" {
        match compute_adaptive_dimensions(&opts.layout, &folders, &root) {
            Some(mut ad) => {
                if opts.render_mode == "fast-preview" {
                    let scale = 640.0 / ad.output_width as f64;
                    ad.output_width = make_even((ad.output_width as f64 * scale) as u32);
                    ad.output_height = make_even((ad.output_height as f64 * scale) as u32);
                    for t in &mut ad.tiles {
                        t.w = make_even((t.w as f64 * scale) as u32);
                        t.h = make_even((t.h as f64 * scale) as u32);
                    }
                    reflow_adaptive_layout(&opts.layout, &mut ad, Some(scale));
                } else {
                    reflow_adaptive_layout(&opts.layout, &mut ad, None);
                }
                effective_width = ad.output_width;
                effective_height = ad.output_height;
                println!("Adaptive output: {}x{}", ad.output_width, ad.output_height);
                Some(ad)
            }
            None => {
                eprintln!("warning: adaptive sizing failed, falling back to fixed");
                if opts.render_mode == "fast-preview" {
                    effective_width = 640;
                    effective_height = 360;
                }
                None
            }
        }
    } else {
        if opts.render_mode == "fast-preview" {
            effective_width = 640;
            effective_height = 360;
        }
        None
    };

    let distribution_mode = if opts.distribution_mode.is_empty() {
        "none".to_string()
    } else {
        opts.distribution_mode.clone()
    };
    let source_repeat_policy = if opts.source_repeat_policy.is_empty() {
        "allow".to_string()
    } else {
        opts.source_repeat_policy.clone()
    };
    let output_length_policy = if opts.output_length_policy == "auto" {
        if let Some(ref p) = loaded_settings.output_length_policy {
            p.to_lowercase()
        } else if opts.no_repeat {
            "shortest".to_string()
        } else {
            "longest".to_string()
        }
    } else {
        opts.output_length_policy.clone()
    };
    opts.no_repeat = output_length_policy == "shortest" || source_repeat_policy != "allow";
    println!("Output length policy: {}", output_length_policy);
    println!("Source repeat policy: {}", source_repeat_policy);

    let mut distributed: Option<Vec<Vec<PathBuf>>> = None;
    let mut distributed_trim_duration: Option<f64> = None;
    if distribution_mode != "none" {
        let first = folders.first().cloned();
        let all_same = first
            .as_ref()
            .map(|f0| folders.iter().all(|f| f == f0))
            .unwrap_or(false);
        if all_same {
            let distribution_max = opts
                .max_duration
                .or_else(|| loaded_settings.max_durations.first().and_then(|v| *v))
                .or(loaded_settings.max_duration);
            let (all_files, trim_dur) =
                get_video_files_with_trim(&folders[0], distribution_max, &root);
            distributed_trim_duration = trim_dur;
            distributed = Some(distribute_videos(
                &all_files,
                tile_count,
                &distribution_mode,
            ));
        }
    }

    let mut tile_crop_positions: Vec<String> = Vec::new();
    let mut used_sources_global = HashSet::<PathBuf>::new();
    for (i, folder) in folders.iter().enumerate() {
        let tile_mode = loaded_settings
            .tile_modes
            .get(i)
            .cloned()
            .unwrap_or_else(|| "video".to_string());
        let use_landscape = loaded_settings
            .tile_use_landscape
            .get(i)
            .copied()
            .unwrap_or(false);
        let image_duration = loaded_settings
            .tile_image_durations
            .get(i)
            .copied()
            .unwrap_or(3.0);
        let tile_crop_position = loaded_settings
            .tile_crop_positions
            .get(i)
            .cloned()
            .unwrap_or_else(|| "center".to_string());
        tile_crop_positions.push(tile_crop_position.clone());

        let tile_max_duration = if let Some(v) = opts.max_duration {
            Some(v)
        } else {
            loaded_settings
                .max_durations
                .get(i)
                .and_then(|v| *v)
                .or(loaded_settings.max_duration)
        };

        let tile_transition = loaded_settings
            .tile_transitions
            .get(i)
            .cloned()
            .unwrap_or_else(|| opts.transition.clone());
        let tile_transition_duration = loaded_settings
            .tile_transition_durations
            .get(i)
            .copied()
            .unwrap_or(opts.transition_duration);
        let tile_speed = loaded_settings
            .tile_speeds
            .get(i)
            .copied()
            .unwrap_or(opts.speed);
        let out = temp_dir.join(format!("tile_{i}.mp4"));
        if tile_mode == "image" {
            let images_folder = {
                let c = folder.join("images");
                if c.exists() && c.is_dir() {
                    c
                } else {
                    folder.clone()
                }
            };
            let mut images = get_image_files(&images_folder);
            if distribution_mode != "none" {
                images = order_files(images, &distribution_mode);
            }
            images = apply_source_repeat_policy(
                images,
                &source_repeat_policy,
                &mut used_sources_global,
            );
            images = limit_images_by_duration(&images, opts.max_total_duration, image_duration);
            if preview_limit != usize::MAX && images.len() > preview_limit {
                if distribution_mode == "random" || distribution_mode == "shuffle-round-robin" {
                    images = order_files(images, &distribution_mode);
                }
                images.truncate(preview_limit);
            }
            if images.is_empty() {
                eprintln!("error: no images found in {}", images_folder.display());
                cleanup_temp_files(&tile_paths, &temp_dir);
                return 1;
            }
            println!(
                "[Tile {}/{}] Processing image tile from {} ({} images)",
                i + 1,
                tile_count,
                images_folder.display(),
                images.len()
            );
            if !create_image_tile(&images, &out, &root, image_duration, opts.force_cfr) {
                eprintln!("error: failed creating image tile {}", i + 1);
                cleanup_temp_files(&tile_paths, &temp_dir);
                return 1;
            }
        } else {
            let (mut base_files, trim_duration) = if let Some(groups) = &distributed {
                (
                    groups.get(i).cloned().unwrap_or_default(),
                    distributed_trim_duration,
                )
            } else {
                let source_folder = if use_landscape {
                    let lf = folder.join("landscape");
                    if lf.exists() && lf.is_dir() && !get_video_files(&lf).is_empty() {
                        lf
                    } else {
                        folder.clone()
                    }
                } else {
                    folder.clone()
                };
                get_video_files_with_trim(&source_folder, tile_max_duration, &root)
            };
            if distributed.is_none() && distribution_mode != "none" {
                base_files = order_files(base_files, &distribution_mode);
            }
            base_files = apply_source_repeat_policy(
                base_files,
                &source_repeat_policy,
                &mut used_sources_global,
            );
            base_files = limit_videos_by_duration(
                &base_files,
                opts.max_total_duration,
                &tile_transition,
                tile_transition_duration,
                tile_speed,
                &root,
            );
            if preview_limit != usize::MAX && base_files.len() > preview_limit {
                if distribution_mode == "random" || distribution_mode == "shuffle-round-robin" {
                    base_files = order_files(base_files, &distribution_mode);
                }
                base_files.truncate(preview_limit);
            }
            if base_files.is_empty() {
                eprintln!("error: no videos found in {}", folder.display());
                cleanup_temp_files(&tile_paths, &temp_dir);
                return 1;
            }
            println!(
                "[Tile {}/{}] Processing video tile from {} ({} files)",
                i + 1,
                tile_count,
                folder.display(),
                base_files.len()
            );
            if !create_tile_video_with_options(
                &base_files,
                &out,
                &root,
                &tile_transition,
                tile_transition_duration,
                tile_speed,
                opts.force_cfr,
                trim_duration,
            ) {
                eprintln!("error: failed creating tile {}", i + 1);
                cleanup_temp_files(&tile_paths, &temp_dir);
                return 1;
            }
        }
        let dur = get_video_duration(&out, &root).unwrap_or(0.0);
        tile_paths.push(out);
        tile_durations.push(dur);
    }

    let shortest_duration = tile_durations.iter().copied().fold(f64::INFINITY, f64::min);
    let longest_duration = tile_durations.iter().copied().fold(0.0_f64, f64::max);
    let mut target_duration = match output_length_policy.as_str() {
        "shortest" => shortest_duration,
        "fixed" => opts.max_total_duration.unwrap_or(longest_duration),
        _ => longest_duration,
    };
    if output_length_policy != "fixed" {
        if let Some(max_total) = opts.max_total_duration {
            target_duration = target_duration.min(max_total);
        }
    }
    if target_duration <= 0.0 {
        target_duration = 1.0;
    }

    let mut final_opts = opts.clone();
    final_opts.width = effective_width;
    final_opts.height = effective_height;
    if final_opts.audio_enabled {
        let mut available = Vec::<usize>::new();
        for idx in &final_opts.audio_tiles {
            if let Some(tile_path) = tile_paths.get(*idx) {
                if has_audio_stream(tile_path, &root) {
                    available.push(*idx);
                }
            }
        }
        if available.is_empty() {
            final_opts.audio_enabled = false;
        } else {
            final_opts.audio_tiles = available;
        }
    }
    let final_cmd = build_tiled_command(
        &final_opts,
        &tile_paths,
        &tile_crop_positions,
        &target_duration,
        &output_path,
        custom_dims.as_ref().or(adaptive_dims.as_ref()),
    );
    println!("[Final] Compositing tiled output...");
    let final_ok = run_command_output(final_cmd);
    cleanup_temp_files(&tile_paths, &temp_dir);

    if final_ok {
        println!("✓ Created {}", output_path.display());
        0
    } else {
        eprintln!("✗ Failed creating tiled output");
        1
    }
}

fn parse_tile_args(args: &[OsString]) -> Result<Option<TileOptions>, String> {
    if args
        .iter()
        .any(|a| matches!(a.to_string_lossy().as_ref(), "-h" | "--help" | "help"))
    {
        println!("{TILE_HELP}");
        return Ok(None);
    }

    let mut folders: Vec<String> = Vec::new();
    let mut layout = "2x1".to_string();
    let mut output: Option<String> = None;
    let mut width: u32 = 1920;
    let mut height: u32 = 1080;
    let mut settings_path: Option<String> = None;
    let mut render_mode = "full".to_string();
    let mut crop_mode = "crop".to_string();
    let mut transition = "cut".to_string();
    let mut transition_duration = 1.0_f64;
    let mut speed = 1.0_f64;
    let mut distribution_mode = "none".to_string();
    let mut max_duration: Option<f64> = None;
    let mut audio_tiles: Vec<usize> = vec![0];
    let mut audio_enabled = true;
    let mut max_total_duration: Option<f64> = None;
    let mut no_overwrite = env_truthy("VIDEO_TILING_NO_OVERWRITE");
    let mut force_cfr = false;
    let mut sizing_mode = "fixed".to_string();
    let mut padding: u32 = 0;
    let mut bg_color = "000000".to_string();
    let mut no_repeat = false;
    let mut output_length_policy = "auto".to_string();
    let mut source_repeat_policy = "allow".to_string();

    let mut i = 0usize;
    while i < args.len() {
        let token = args[i].to_string_lossy().to_string();
        match token.as_str() {
            "-l" | "--layout" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --layout".to_string());
                }
                layout = args[i].to_string_lossy().to_string();
            }
            "-o" | "--output" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --output".to_string());
                }
                output = Some(args[i].to_string_lossy().to_string());
            }
            "-w" | "--width" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --width".to_string());
                }
                width = args[i]
                    .to_string_lossy()
                    .parse::<u32>()
                    .map_err(|_| "width must be an integer".to_string())?;
            }
            "--height" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --height".to_string());
                }
                height = args[i]
                    .to_string_lossy()
                    .parse::<u32>()
                    .map_err(|_| "height must be an integer".to_string())?;
            }
            "--settings" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --settings".to_string());
                }
                settings_path = Some(args[i].to_string_lossy().to_string());
            }
            "--render-mode" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --render-mode".to_string());
                }
                render_mode = args[i].to_string_lossy().to_string().to_lowercase();
                if render_mode != "full"
                    && render_mode != "preview"
                    && render_mode != "fast-preview"
                {
                    return Err("render-mode must be full, preview, or fast-preview".to_string());
                }
            }
            "--crop-mode" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --crop-mode".to_string());
                }
                crop_mode = args[i].to_string_lossy().to_string().to_lowercase();
                if crop_mode != "crop" && crop_mode != "pad" && crop_mode != "stretch" {
                    return Err("crop-mode must be crop, pad, or stretch".to_string());
                }
            }
            "--transition" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --transition".to_string());
                }
                transition = args[i].to_string_lossy().to_string().to_lowercase();
                if transition != "cut"
                    && transition != "fade"
                    && transition != "fadeblack"
                    && transition != "dissolve"
                {
                    return Err("transition must be cut, fade, fadeblack, or dissolve".to_string());
                }
            }
            "--transition-duration" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --transition-duration".to_string());
                }
                transition_duration = args[i]
                    .to_string_lossy()
                    .parse::<f64>()
                    .map_err(|_| "transition-duration must be a number".to_string())?;
                if transition_duration <= 0.0 {
                    return Err("transition-duration must be > 0".to_string());
                }
            }
            "--speed" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --speed".to_string());
                }
                speed = args[i]
                    .to_string_lossy()
                    .parse::<f64>()
                    .map_err(|_| "speed must be a number".to_string())?;
                if speed <= 0.0 {
                    return Err("speed must be > 0".to_string());
                }
            }
            "--distribution-mode" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --distribution-mode".to_string());
                }
                distribution_mode = args[i].to_string_lossy().to_string().to_lowercase();
                if distribution_mode != "none"
                    && distribution_mode != "round-robin"
                    && distribution_mode != "sequential"
                    && distribution_mode != "random"
                    && distribution_mode != "shuffle-round-robin"
                {
                    return Err("distribution-mode must be none, round-robin, sequential, random, or shuffle-round-robin".to_string());
                }
            }
            "--max-duration" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --max-duration".to_string());
                }
                let v = args[i]
                    .to_string_lossy()
                    .parse::<f64>()
                    .map_err(|_| "max-duration must be a number".to_string())?;
                if v <= 0.0 {
                    return Err("max-duration must be > 0".to_string());
                }
                max_duration = Some(v);
            }
            "--audio-tiles" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --audio-tiles".to_string());
                }
                let raw = args[i].to_string_lossy().to_string();
                let mut parsed = Vec::<usize>::new();
                for part in raw.split(',') {
                    if part.trim().is_empty() {
                        continue;
                    }
                    parsed.push(
                        part.trim().parse::<usize>().map_err(|_| {
                            "audio-tiles must be comma-separated indexes".to_string()
                        })?,
                    );
                }
                if parsed.is_empty() {
                    return Err("audio-tiles must include at least one index".to_string());
                }
                audio_tiles = parsed;
            }
            "--no-audio" => audio_enabled = false,
            "--no-repeat" => no_repeat = true,
            "--output-length-policy" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --output-length-policy".to_string());
                }
                output_length_policy = args[i].to_string_lossy().to_string().to_lowercase();
                if output_length_policy != "auto"
                    && output_length_policy != "shortest"
                    && output_length_policy != "longest"
                    && output_length_policy != "fixed"
                {
                    return Err(
                        "output-length-policy must be auto, shortest, longest, or fixed"
                            .to_string(),
                    );
                }
            }
            "--source-repeat-policy" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --source-repeat-policy".to_string());
                }
                source_repeat_policy = args[i].to_string_lossy().to_string().to_lowercase();
                if source_repeat_policy != "allow"
                    && source_repeat_policy != "no_reuse_per_tile"
                    && source_repeat_policy != "no_reuse_global"
                {
                    return Err(
                        "source-repeat-policy must be allow, no_reuse_per_tile, or no_reuse_global"
                            .to_string(),
                    );
                }
            }
            "--no-overwrite" => no_overwrite = true,
            "--force-cfr" => force_cfr = true,
            "--max-total-duration" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --max-total-duration".to_string());
                }
                let v = args[i]
                    .to_string_lossy()
                    .parse::<f64>()
                    .map_err(|_| "max-total-duration must be a number".to_string())?;
                if v <= 0.0 {
                    return Err("max-total-duration must be > 0".to_string());
                }
                max_total_duration = Some(v);
            }
            "--sizing-mode" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --sizing-mode".to_string());
                }
                sizing_mode = args[i].to_string_lossy().to_string().to_lowercase();
                if sizing_mode != "fixed" && sizing_mode != "adaptive" {
                    return Err("sizing-mode must be fixed or adaptive".to_string());
                }
            }
            "--padding" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --padding".to_string());
                }
                padding = args[i]
                    .to_string_lossy()
                    .parse::<u32>()
                    .map_err(|_| "padding must be a non-negative integer".to_string())?;
            }
            "--bg-color" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --bg-color".to_string());
                }
                bg_color = args[i].to_string_lossy().to_string();
                bg_color = bg_color.trim_start_matches('#').to_string();
            }
            _ if token.starts_with('-') => return Err(format!("unknown option: {token}")),
            _ => folders.push(token),
        }
        i += 1;
    }

    if folders.is_empty() && settings_path.is_none() {
        return Err("at least one folder is required (or provide --settings)".to_string());
    }

    Ok(Some(TileOptions {
        folders,
        layout,
        output,
        width,
        height,
        settings_path,
        render_mode,
        crop_mode,
        transition,
        transition_duration,
        speed,
        distribution_mode,
        max_duration,
        audio_tiles,
        audio_enabled,
        max_total_duration,
        no_overwrite,
        force_cfr,
        layout_mode: "preset".to_string(),
        sizing_mode,
        padding,
        bg_color,
        no_repeat,
        output_length_policy,
        source_repeat_policy,
    }))
}
fn parse_concat_args(args: &[OsString]) -> Result<Option<ConcatOptions>, String> {
    if args
        .iter()
        .any(|a| matches!(a.to_string_lossy().as_ref(), "-h" | "--help" | "help"))
    {
        println!("{CONCAT_HELP}");
        return Ok(None);
    }

    let mut folders: Vec<String> = Vec::new();
    let mut output_dir = "outputs/concatenated".to_string();
    let mut transition = "cut".to_string();
    let mut duration = 1.0_f64;

    let mut i = 0;
    while i < args.len() {
        let token = args[i].to_string_lossy().to_string();
        match token.as_str() {
            "-o" | "--output" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --output".to_string());
                }
                output_dir = args[i].to_string_lossy().to_string();
            }
            "-t" | "--transition" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --transition".to_string());
                }
                transition = args[i].to_string_lossy().to_string().to_lowercase();
                if transition != "cut"
                    && transition != "fade"
                    && transition != "fadeblack"
                    && transition != "dissolve"
                {
                    return Err(
                        "transition must be one of: cut, fade, fadeblack, dissolve".to_string()
                    );
                }
            }
            "-d" | "--duration" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --duration".to_string());
                }
                duration = args[i]
                    .to_string_lossy()
                    .parse::<f64>()
                    .map_err(|_| "duration must be a number".to_string())?;
                if duration <= 0.0 {
                    return Err("duration must be > 0".to_string());
                }
            }
            _ if token.starts_with('-') => {
                return Err(format!("unknown option: {token}"));
            }
            _ => folders.push(token),
        }
        i += 1;
    }

    if folders.is_empty() {
        return Err("at least one input is required".to_string());
    }

    Ok(Some(ConcatOptions {
        folders,
        output_dir,
        transition,
        duration,
    }))
}

fn parse_loop_args(args: &[OsString]) -> Result<Option<LoopOptions>, String> {
    if args
        .iter()
        .any(|a| matches!(a.to_string_lossy().as_ref(), "-h" | "--help" | "help"))
    {
        println!("{LOOP_HELP}");
        return Ok(None);
    }

    let mut inputs: Vec<String> = Vec::new();
    let mut output_dir = "outputs/loop".to_string();
    let mut count = 2_u32;
    let mut transition = "cut".to_string();
    let mut duration = 1.0_f64;

    let mut i = 0;
    while i < args.len() {
        let token = args[i].to_string_lossy().to_string();
        match token.as_str() {
            "-o" | "--output" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --output".to_string());
                }
                output_dir = args[i].to_string_lossy().to_string();
            }
            "-c" | "--count" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --count".to_string());
                }
                count = args[i]
                    .to_string_lossy()
                    .parse::<u32>()
                    .map_err(|_| "count must be a positive integer".to_string())?;
                if count < 1 {
                    return Err("count must be >= 1".to_string());
                }
            }
            "-t" | "--transition" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --transition".to_string());
                }
                transition = args[i].to_string_lossy().to_string().to_lowercase();
                if transition != "cut"
                    && transition != "fade"
                    && transition != "fadeblack"
                    && transition != "dissolve"
                {
                    return Err(
                        "transition must be one of: cut, fade, fadeblack, dissolve".to_string()
                    );
                }
            }
            "-d" | "--duration" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --duration".to_string());
                }
                duration = args[i]
                    .to_string_lossy()
                    .parse::<f64>()
                    .map_err(|_| "duration must be a number".to_string())?;
                if duration <= 0.0 {
                    return Err("duration must be > 0".to_string());
                }
            }
            "--no-overwrite" => {
                // accepted but ignored (loop never overwrites original)
            }
            "--force-cfr" | "--no-audio" => {
                // accepted for compatibility, ignored
            }
            _ if token.starts_with('-') => {
                return Err(format!("unknown option: {token}"));
            }
            _ => inputs.push(token),
        }
        i += 1;
    }

    if inputs.is_empty() {
        return Err("at least one input is required".to_string());
    }

    Ok(Some(LoopOptions {
        inputs,
        output_dir,
        count,
        transition,
        duration,
    }))
}

fn parse_trim_args(args: &[OsString]) -> Result<Option<TrimOptions>, String> {
    if args
        .iter()
        .any(|a| matches!(a.to_string_lossy().as_ref(), "-h" | "--help" | "help"))
    {
        println!("{TRIM_HELP}");
        return Ok(None);
    }

    let mut folders: Vec<String> = Vec::new();
    let mut output_dir = "outputs/trimmed".to_string();
    let mut trim_start = 0.0_f64;
    let mut trim_end = 0.0_f64;
    let mut overwrite = false;
    let mut no_audio = false;

    let mut i = 0usize;
    while i < args.len() {
        let token = args[i].to_string_lossy().to_string();
        match token.as_str() {
            "-o" | "--output" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --output".to_string());
                }
                output_dir = args[i].to_string_lossy().to_string();
            }
            "-s" | "--start" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --start".to_string());
                }
                trim_start = args[i]
                    .to_string_lossy()
                    .parse::<f64>()
                    .map_err(|_| "start must be a number".to_string())?;
                if trim_start < 0.0 {
                    return Err("start must be >= 0".to_string());
                }
            }
            "-e" | "--end" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --end".to_string());
                }
                trim_end = args[i]
                    .to_string_lossy()
                    .parse::<f64>()
                    .map_err(|_| "end must be a number".to_string())?;
                if trim_end < 0.0 {
                    return Err("end must be >= 0".to_string());
                }
            }
            "--overwrite" => overwrite = true,
            "--no-audio" => no_audio = true,
            _ if token.starts_with('-') => {
                return Err(format!("unknown option: {token}"));
            }
            _ => folders.push(token),
        }
        i += 1;
    }

    if folders.is_empty() {
        return Err("at least one folder is required".to_string());
    }

    Ok(Some(TrimOptions {
        folders,
        output_dir,
        trim_start,
        trim_end,
        overwrite,
        no_audio,
    }))
}

fn parse_clean_args(args: &[OsString]) -> Result<Option<CleanOptions>, String> {
    if args
        .iter()
        .any(|a| matches!(a.to_string_lossy().as_ref(), "-h" | "--help" | "help"))
    {
        println!("{CLEAN_HELP}");
        return Ok(None);
    }

    let mut folders: Vec<String> = Vec::new();
    let mut mode = "3".to_string();
    let mut add_number = false;

    let mut i = 0usize;
    while i < args.len() {
        let token = args[i].to_string_lossy().to_string();
        match token.as_str() {
            "-m" | "--mode" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --mode".to_string());
                }
                mode = args[i].to_string_lossy().to_string();
                if mode != "1" && mode != "2" && mode != "3" {
                    return Err("mode must be 1, 2, or 3".to_string());
                }
            }
            "-n" | "--number" => add_number = true,
            _ if token.starts_with('-') => {
                return Err(format!("unknown option: {token}"));
            }
            _ => folders.push(token),
        }
        i += 1;
    }

    if folders.is_empty() {
        return Err("at least one folder is required".to_string());
    }

    Ok(Some(CleanOptions {
        folders,
        mode,
        add_number,
    }))
}

fn parse_detect_args(args: &[OsString]) -> Result<Option<DetectOptions>, String> {
    if args
        .iter()
        .any(|a| matches!(a.to_string_lossy().as_ref(), "-h" | "--help" | "help"))
    {
        println!("{DETECT_HELP}");
        return Ok(None);
    }

    let mut inputs: Vec<String> = Vec::new();
    let mut output_dir = "outputs/scenes".to_string();
    let mut list_only = false;
    let mut threshold = 0.27_f64;
    let mut method = "content".to_string();

    let mut i = 0usize;
    while i < args.len() {
        let token = args[i].to_string_lossy().to_string();
        match token.as_str() {
            "-o" | "--output" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --output".to_string());
                }
                output_dir = args[i].to_string_lossy().to_string();
            }
            "--list-only" => list_only = true,
            "-t" | "--threshold" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --threshold".to_string());
                }
                threshold = args[i]
                    .to_string_lossy()
                    .parse::<f64>()
                    .map_err(|_| "threshold must be a number".to_string())?;
            }
            "-m" | "--method" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --method".to_string());
                }
                method = args[i].to_string_lossy().to_string().to_lowercase();
            }
            _ if token.starts_with('-') => return Err(format!("unknown option: {token}")),
            _ => inputs.push(token),
        }
        i += 1;
    }

    if inputs.is_empty() {
        return Err("at least one input is required".to_string());
    }

    Ok(Some(DetectOptions {
        inputs,
        output_dir,
        list_only,
        threshold,
        method,
    }))
}

fn parse_split_detect_args(args: &[OsString]) -> Result<Option<SplitDetectOptions>, String> {
    if args
        .iter()
        .any(|a| matches!(a.to_string_lossy().as_ref(), "-h" | "--help" | "help"))
    {
        println!("{SPLIT_DETECT_HELP}");
        return Ok(None);
    }

    let mut inputs: Vec<String> = Vec::new();
    let mut output_dir = "outputs/split-detect".to_string();
    let mut force_two_panel = false;
    let mut quality = "medium".to_string();
    let mut clip_seconds: Option<f64> = None;
    let mut fast_preview = false;

    let mut i = 0usize;
    while i < args.len() {
        let token = args[i].to_string_lossy().to_string();
        match token.as_str() {
            "-o" | "--output" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --output".to_string());
                }
                output_dir = args[i].to_string_lossy().to_string();
            }
            "--quality" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --quality".to_string());
                }
                quality = args[i].to_string_lossy().to_string().to_lowercase();
            }
            "--clip-seconds" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --clip-seconds".to_string());
                }
                clip_seconds = args[i]
                    .to_string_lossy()
                    .parse::<f64>()
                    .ok()
                    .filter(|v| *v > 0.0);
            }
            "--fast-preview" => fast_preview = true,
            "--force-2x1" => force_two_panel = true,
            _ if token.starts_with('-') => return Err(format!("unknown option: {token}")),
            _ => inputs.push(token),
        }
        i += 1;
    }

    if inputs.is_empty() {
        return Err("at least one input is required".to_string());
    }

    Ok(Some(SplitDetectOptions {
        inputs,
        output_dir,
        force_two_panel,
        quality,
        clip_seconds,
        fast_preview,
    }))
}

fn parse_yt_import_args(args: &[OsString]) -> Result<Option<YtImportOptions>, String> {
    if args
        .iter()
        .any(|a| matches!(a.to_string_lossy().as_ref(), "-h" | "--help" | "help"))
    {
        println!("{YT_IMPORT_HELP}");
        return Ok(None);
    }

    let mut urls: Vec<String> = Vec::new();
    let mut output_dir = "outputs/yt-import".to_string();
    let mut force_two_panel = false;
    let mut quality = "medium".to_string();
    let mut clip_seconds: Option<f64> = None;
    let mut cookies_from_browser: Option<String> = None;
    let mut cookies_file: Option<String> = None;
    let mut fast_preview = false;

    let mut i = 0usize;
    while i < args.len() {
        let token = args[i].to_string_lossy().to_string();
        match token.as_str() {
            "-o" | "--output" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --output".to_string());
                }
                output_dir = args[i].to_string_lossy().to_string();
            }
            "--quality" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --quality".to_string());
                }
                quality = args[i].to_string_lossy().to_string().to_lowercase();
            }
            "--clip-seconds" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --clip-seconds".to_string());
                }
                clip_seconds = args[i]
                    .to_string_lossy()
                    .parse::<f64>()
                    .ok()
                    .filter(|v| *v > 0.0);
            }
            "--fast-preview" => fast_preview = true,
            "--cookies-from-browser" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --cookies-from-browser".to_string());
                }
                cookies_from_browser = Some(args[i].to_string_lossy().to_string());
            }
            "--cookies" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --cookies".to_string());
                }
                cookies_file = Some(args[i].to_string_lossy().to_string());
            }
            "--force-2x1" => force_two_panel = true,
            _ if token.starts_with('-') => return Err(format!("unknown option: {token}")),
            _ => urls.push(token),
        }
        i += 1;
    }

    if urls.is_empty() {
        return Err("at least one URL is required".to_string());
    }

    Ok(Some(YtImportOptions {
        urls,
        output_dir,
        force_two_panel,
        quality,
        clip_seconds,
        cookies_from_browser,
        cookies_file,
        fast_preview,
    }))
}

fn parse_strip_audio_args(args: &[OsString]) -> Result<Option<StripAudioOptions>, String> {
    if args
        .iter()
        .any(|a| matches!(a.to_string_lossy().as_ref(), "-h" | "--help" | "help"))
    {
        println!("{STRIP_AUDIO_HELP}");
        return Ok(None);
    }

    let mut inputs: Vec<String> = Vec::new();
    let mut output_dir = "outputs/strip-audio".to_string();
    let mut overwrite = false;

    let mut i = 0usize;
    while i < args.len() {
        let token = args[i].to_string_lossy().to_string();
        match token.as_str() {
            "-o" | "--output" => {
                i += 1;
                if i >= args.len() {
                    return Err("missing value for --output".to_string());
                }
                output_dir = args[i].to_string_lossy().to_string();
            }
            "--overwrite" => overwrite = true,
            _ if token.starts_with('-') => {
                return Err(format!("unknown option: {token}"));
            }
            _ => inputs.push(token),
        }
        i += 1;
    }

    if inputs.is_empty() {
        return Err("at least one input is required".to_string());
    }

    Ok(Some(StripAudioOptions {
        inputs,
        output_dir,
        overwrite,
    }))
}

fn layout_tile_count(layout: &str) -> Option<usize> {
    match layout {
        "2x1" | "1x2" | "pip" => Some(2),
        "2x2" | "4x1" | "1x4" | "1+3" => Some(4),
        "1+2" | "2+1" | "2x2-focus" | "left-big-right-stack" | "top-big-bottom-stack" => Some(3),
        "3x1" | "1x3" => Some(3),
        "2x3" | "3x2" | "3x3-focus" => Some(6),
        "3x3" => Some(9),
        _ => None,
    }
}

fn default_tiled_output(root: &Path, layout: &str, folders: &[PathBuf]) -> PathBuf {
    let mut names: Vec<String> = folders
        .iter()
        .map(|f| {
            f.file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "tile".to_string())
        })
        .collect();
    if names.len() > 4 {
        names.truncate(4);
    }
    let joined = names.join("_");
    root.join("outputs")
        .join("tiled")
        .join(format!("{layout}_{joined}.mp4"))
}

fn cleanup_temp_files(tile_paths: &[PathBuf], temp_dir: &Path) {
    for p in tile_paths {
        let _ = fs::remove_file(p);
    }
    let _ = fs::remove_dir(temp_dir);
}

fn create_tile_video_simple(files: &[PathBuf], output: &Path, root: &Path) -> bool {
    if files.is_empty() {
        return false;
    }
    if files.len() == 1 {
        let status = Command::new("ffmpeg")
            .arg("-i")
            .arg(&files[0])
            .arg("-c:v")
            .arg("libx264")
            .arg("-preset")
            .arg("medium")
            .arg("-crf")
            .arg("23")
            .arg("-c:a")
            .arg("aac")
            .arg("-b:a")
            .arg("192k")
            .arg("-pix_fmt")
            .arg("yuv420p")
            .arg("-y")
            .arg(output)
            .current_dir(root)
            .output();
        return match status {
            Ok(out) if out.status.success() => true,
            Ok(out) => {
                if !out.stderr.is_empty() {
                    eprintln!(
                        "ffmpeg failed creating single-file tile from {}:",
                        files[0].display()
                    );
                    eprintln!("{}", String::from_utf8_lossy(&out.stderr));
                }
                false
            }
            Err(err) => {
                eprintln!(
                    "error running ffmpeg for single-file tile from {}: {err}",
                    files[0].display()
                );
                false
            }
        };
    }

    let mut cmd = Command::new("ffmpeg");
    for f in files {
        cmd.arg("-i").arg(f);
    }
    let mut filter_parts: Vec<String> = Vec::new();
    let mut concat_inputs: Vec<String> = Vec::new();
    let target_dims = get_video_info(&files[0], root).map(|i| (i.width, i.height));
    for (i, f) in files.iter().enumerate() {
        if let Some((target_w, target_h)) = target_dims {
            filter_parts.push(format!(
                "[{i}:v]scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p,setpts=PTS-STARTPTS[v{i}]"
            ));
        } else {
            filter_parts.push(format!(
                "[{i}:v]fps=30,format=yuv420p,setpts=PTS-STARTPTS[v{i}]"
            ));
        }
        if has_audio_stream(f, root) {
            filter_parts.push(format!(
                "[{i}:a:0]aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a{i}]"
            ));
        } else {
            let dur = get_video_duration(f, root).unwrap_or(1.0);
            filter_parts.push(format!(
                "anullsrc=r=48000:cl=stereo:d={dur:.3},asetpts=PTS-STARTPTS[a{i}]"
            ));
        }
        concat_inputs.push(format!("[v{i}][a{i}]"));
    }
    filter_parts.push(format!(
        "{}concat=n={}:v=1:a=1[outv][outa]",
        concat_inputs.join(""),
        files.len()
    ));
    let filter_complex = filter_parts.join(";");

    let out = cmd
        .arg("-filter_complex")
        .arg(filter_complex)
        .arg("-map")
        .arg("[outv]")
        .arg("-map")
        .arg("[outa]")
        .arg("-c:v")
        .arg("libx264")
        .arg("-preset")
        .arg("medium")
        .arg("-crf")
        .arg("23")
        .arg("-c:a")
        .arg("aac")
        .arg("-b:a")
        .arg("192k")
        .arg("-pix_fmt")
        .arg("yuv420p")
        .arg("-y")
        .arg(output)
        .current_dir(root)
        .output();

    match out {
        Ok(out) if out.status.success() => true,
        Ok(out) => {
            if !out.stderr.is_empty() {
                eprintln!("ffmpeg failed creating concatenated tile:");
                eprintln!("{}", String::from_utf8_lossy(&out.stderr));
            }
            false
        }
        Err(err) => {
            eprintln!("error running ffmpeg for concatenated tile: {err}");
            false
        }
    }
}

fn create_tile_video_with_options(
    files: &[PathBuf],
    output: &Path,
    root: &Path,
    transition: &str,
    transition_duration: f64,
    speed: f64,
    _force_cfr: bool, // Ignored: now always enforced by contract
    trim_duration: Option<f64>,
) -> bool {
    if files.is_empty() {
        return false;
    }

    let mut intermediate_files = Vec::<PathBuf>::new();
    
    // Always normalize to canonical contract (CFR, fixed audio, etc.)
    // This prevents timing drift across tiles and scenarios.
    for (i, file) in files.iter().enumerate() {
        let tmp = env::temp_dir().join(format!(
            "tiles_norm_{}_{}_{}.mp4",
            std::process::id(),
            i,
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0)
        ));
        
        let mut pipeline = FFmpegPipeline::new(root);
        pipeline.cmd.arg("-i").arg(file);
        
        if let Some(trim_dur) = trim_duration {
            pipeline.set_duration(trim_dur);
        }

        let v_filter = if (speed - 1.0).abs() > 1e-6 {
            Some(format!("setpts=PTS/{speed:.6}"))
        } else {
            None
        };
        pipeline.apply_video_params(v_filter);

        if has_audio_stream(file, root) {
            let a_filter = if (speed - 1.0).abs() > 1e-6 {
                Some(build_atempo_filter(speed))
            } else {
                None
            };
            pipeline.apply_audio_params(a_filter);
        } else {
            pipeline.apply_canonical_audio_params(false);
        }

        if !pipeline.run(&tmp) {
            eprintln!("error: normalization failed for {}", file.display());
            for p in &intermediate_files {
                let _ = fs::remove_file(p);
            }
            return false;
        }
        intermediate_files.push(tmp);
    }

    let ok = if transition == "cut" || intermediate_files.len() <= 1 {
        create_tile_video_simple(&intermediate_files, output, root)
    } else {
        let transitioned = concat_with_transitions(
            &intermediate_files,
            output,
            transition,
            transition_duration,
            root,
        );
        if transitioned {
            true
        } else {
            eprintln!(
                "warning: transition '{}' failed for tile segment; falling back to cut",
                transition
            );
            create_tile_video_simple(&intermediate_files, output, root)
        }
    };

    for p in &intermediate_files {
        let _ = fs::remove_file(p);
    }
    ok
}

fn create_image_tile(
    images: &[PathBuf],
    output: &Path,
    root: &Path,
    image_duration: f64,
    force_cfr: bool,
) -> bool {
    if images.is_empty() {
        return false;
    }
    let list_file = env::temp_dir().join(format!(
        "tiles_images_{}_{}.txt",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    ));
    let mut content = String::new();
    for img in images {
        let escaped = img
            .canonicalize()
            .unwrap_or_else(|_| img.clone())
            .to_string_lossy()
            .replace('\'', "'\\''");
        content.push_str(&format!("file '{}'\n", escaped));
        content.push_str(&format!("duration {:.6}\n", image_duration.max(0.01)));
    }
    if let Some(last) = images.last() {
        let escaped = last
            .canonicalize()
            .unwrap_or_else(|_| last.clone())
            .to_string_lossy()
            .replace('\'', "'\\''");
        content.push_str(&format!("file '{}'\n", escaped));
    }
    if fs::write(&list_file, content).is_err() {
        return false;
    }

    let vf = "fps=30,format=yuv420p";
    let mut cmd = Command::new("ffmpeg");
    if force_cfr {
        cmd.arg("-fflags").arg("+genpts");
    }
    cmd.arg("-f")
        .arg("concat")
        .arg("-safe")
        .arg("0")
        .arg("-i")
        .arg(&list_file)
        .arg("-vf")
        .arg(vf)
        .arg("-c:v")
        .arg("libx264")
        .arg("-preset")
        .arg("medium")
        .arg("-crf")
        .arg("23")
        .arg("-pix_fmt")
        .arg("yuv420p")
        .arg("-an");
    if force_cfr {
        cmd.arg("-fps_mode").arg("cfr");
    }
    let out = cmd.arg("-y").arg(output).current_dir(root).output();

    let _ = fs::remove_file(&list_file);
    matches!(out, Ok(o) if o.status.success())
}

fn build_atempo_filter(speed: f64) -> String {
    let mut tempo = speed;
    let mut filters: Vec<String> = Vec::new();
    while tempo < 0.5 {
        filters.push("atempo=0.5".to_string());
        tempo /= 0.5;
    }
    while tempo > 2.0 {
        filters.push("atempo=2.0".to_string());
        tempo /= 2.0;
    }
    filters.push(format!("atempo={tempo:.3}"));
    filters.join(",")
}

#[derive(Debug, Clone)]
struct AdaptiveDimensions {
    tiles: Vec<TileRect>,
    output_width: u32,
    output_height: u32,
}

fn reflow_adaptive_layout(layout: &str, dims: &mut AdaptiveDimensions, scale: Option<f64>) {
    let tiles = &mut dims.tiles;
    let margin = scale.map(|s| make_even((20.0 * s) as u32)).unwrap_or(20);

    match layout {
        "2x1" | "3x1" | "4x1" => {
            let mut x = 0u32;
            let mut max_h = 0u32;
            for t in tiles.iter_mut() {
                t.x = x;
                t.y = 0;
                x += t.w;
                max_h = max_h.max(t.h);
            }
            dims.output_width = make_even(x);
            dims.output_height = make_even(max_h);
        }
        "1x2" | "1x3" | "1x4" => {
            let mut y = 0u32;
            let mut max_w = 0u32;
            for t in tiles.iter_mut() {
                t.x = 0;
                t.y = y;
                y += t.h;
                max_w = max_w.max(t.w);
            }
            dims.output_width = make_even(max_w);
            dims.output_height = make_even(y);
        }
        "2x2" | "3x2" | "2x3" | "3x3" => {
            let (rows, cols) = match layout {
                "2x2" => (2usize, 2usize),
                "2x3" => (3, 2),
                "3x2" => (2, 3),
                _ => (3, 3),
            };
            let mut idx = 0usize;
            let mut y = 0u32;
            let mut max_row_w = 0u32;
            for _ in 0..rows {
                let mut x = 0u32;
                let mut row_h = 0u32;
                for _ in 0..cols {
                    if idx >= tiles.len() {
                        break;
                    }
                    let t = &mut tiles[idx];
                    t.x = x;
                    t.y = y;
                    x += t.w;
                    row_h = row_h.max(t.h);
                    idx += 1;
                }
                max_row_w = max_row_w.max(x);
                y += row_h;
            }
            dims.output_width = make_even(max_row_w);
            dims.output_height = make_even(y);
        }
        "pip" => {
            if tiles.len() >= 2 {
                let main_w = tiles[0].w;
                let main_h = tiles[0].h;
                let pip_w = tiles[1].w;
                let pip_h = tiles[1].h;
                tiles[0].x = 0;
                tiles[0].y = 0;
                tiles[1].x = main_w.saturating_sub(pip_w + margin);
                tiles[1].y = margin;
                dims.output_width = make_even(main_w);
                dims.output_height = make_even(main_h);
            }
        }
        "1+2" | "left-big-right-stack" => {
            if tiles.len() >= 3 {
                let left_w = tiles[0].w;
                let left_h = tiles[0].h;
                let right_w = tiles[1].w.max(tiles[2].w);
                tiles[1].w = right_w;
                tiles[2].w = right_w;
                tiles[0].x = 0;
                tiles[0].y = 0;
                tiles[1].x = left_w;
                tiles[1].y = 0;
                tiles[2].x = left_w;
                tiles[2].y = tiles[1].h;
                tiles[2].h = make_even(left_h.saturating_sub(tiles[1].h));
                dims.output_width = make_even(left_w + right_w);
                dims.output_height = make_even(left_h);
            }
        }
        "2+1" => {
            if tiles.len() >= 3 {
                let right_w = tiles[2].w;
                let right_h = tiles[2].h;
                let left_w = tiles[0].w.max(tiles[1].w);
                tiles[0].w = left_w;
                tiles[1].w = left_w;
                tiles[0].x = 0;
                tiles[0].y = 0;
                tiles[1].x = 0;
                tiles[1].y = tiles[0].h;
                tiles[1].h = make_even(right_h.saturating_sub(tiles[0].h));
                tiles[2].x = left_w;
                tiles[2].y = 0;
                dims.output_width = make_even(left_w + right_w);
                dims.output_height = make_even(right_h);
            }
        }
        "1+3" => {
            if tiles.len() >= 4 {
                let top_w = tiles[0].w;
                let top_h = tiles[0].h;
                tiles[0].x = 0;
                tiles[0].y = 0;
                tiles[1].x = 0;
                tiles[1].y = top_h;
                tiles[2].x = tiles[1].w;
                tiles[2].y = top_h;
                tiles[3].x = tiles[1].w + tiles[2].w;
                tiles[3].y = top_h;
                tiles[3].w = make_even(top_w.saturating_sub(tiles[1].w + tiles[2].w));
                let bot_h = tiles[1].h.max(tiles[2].h).max(tiles[3].h);
                tiles[1].h = bot_h;
                tiles[2].h = bot_h;
                tiles[3].h = bot_h;
                dims.output_width = make_even(top_w);
                dims.output_height = make_even(top_h + bot_h);
            }
        }
        "2x2-focus" | "top-big-bottom-stack" => {
            if tiles.len() >= 3 {
                let top_w = tiles[0].w;
                let top_h = tiles[0].h;
                tiles[0].x = 0;
                tiles[0].y = 0;
                tiles[1].x = 0;
                tiles[1].y = top_h;
                tiles[2].x = tiles[1].w;
                tiles[2].y = top_h;
                tiles[2].w = make_even(top_w.saturating_sub(tiles[1].w));
                let bot_h = tiles[1].h.max(tiles[2].h);
                tiles[1].h = bot_h;
                tiles[2].h = bot_h;
                dims.output_width = make_even(top_w);
                dims.output_height = make_even(top_h + bot_h);
            }
        }
        "3x3-focus" => {
            if tiles.len() >= 6 {
                let right_w = tiles[1].w.max(tiles[2].w);
                tiles[1].w = right_w;
                tiles[2].w = right_w;
                tiles[1].x = tiles[0].w;
                tiles[1].y = 0;
                tiles[2].x = tiles[0].w;
                tiles[2].y = tiles[1].h;

                let top_h = make_even(tiles[1].h + tiles[2].h);
                tiles[0].h = top_h;
                tiles[0].x = 0;
                tiles[0].y = 0;

                tiles[3].x = 0;
                tiles[3].y = top_h;
                tiles[4].x = tiles[3].w;
                tiles[4].y = top_h;
                tiles[5].x = tiles[3].w + tiles[4].w;
                tiles[5].y = top_h;

                let out_w = make_even(tiles[0].w + right_w);
                tiles[5].w = make_even(out_w.saturating_sub(tiles[3].w + tiles[4].w));

                let bot_h = tiles[3].h.max(tiles[4].h).max(tiles[5].h);
                tiles[3].h = bot_h;
                tiles[4].h = bot_h;
                tiles[5].h = bot_h;

                dims.output_width = out_w;
                dims.output_height = make_even(top_h + bot_h);
            }
        }
        _ => {}
    }
}

fn probe_dimensions(folder: &Path, root: &Path) -> Option<(u32, u32)> {
    let files = get_video_files(folder);
    let first = files.first()?;
    let info = get_video_info(first, root)?;
    if info.width == 0 || info.height == 0 {
        return None;
    }
    Some((info.width, info.height))
}

fn compute_adaptive_dimensions(
    layout: &str,
    folders: &[PathBuf],
    root: &Path,
) -> Option<AdaptiveDimensions> {
    let n = layout_tile_count(layout)?;
    if folders.len() != n {
        return None;
    }

    let mut aspects: Vec<f64> = Vec::new();
    let mut widths: Vec<u32> = Vec::new();
    let mut heights: Vec<u32> = Vec::new();
    for folder in folders {
        let (w, h) = probe_dimensions(folder, root)?;
        aspects.push(w as f64 / h as f64);
        widths.push(w);
        heights.push(h);
    }

    match layout {
        // Row layouts: tiles side by side (hstack) - must share height
        "2x1" | "3x1" | "4x1" => {
            let ref_h = *heights.iter().max()? as f64;
            let mut tiles = Vec::new();
            let mut x_off = 0u32;
            for a in &aspects {
                let tw = make_even((a * ref_h) as u32);
                let th = make_even(ref_h as u32);
                tiles.push(TileRect {
                    w: tw,
                    h: th,
                    x: x_off,
                    y: 0,
                });
                x_off += tw;
            }
            Some(AdaptiveDimensions {
                output_width: x_off,
                output_height: make_even(ref_h as u32),
                tiles,
            })
        }

        // Column layouts: tiles stacked (vstack) - must share width
        "1x2" | "1x3" | "1x4" => {
            let ref_w = *widths.iter().max()? as f64;
            let mut tiles = Vec::new();
            let mut y_off = 0u32;
            for a in &aspects {
                let tw = make_even(ref_w as u32);
                let th = make_even((ref_w / a) as u32);
                tiles.push(TileRect {
                    w: tw,
                    h: th,
                    x: 0,
                    y: y_off,
                });
                y_off += th;
            }
            Some(AdaptiveDimensions {
                output_width: make_even(ref_w as u32),
                output_height: y_off,
                tiles,
            })
        }

        // Grid layouts: rows of tiles, hstacked then vstacked
        "2x2" | "3x2" | "2x3" | "3x3" => {
            let (rows, cols) = match layout {
                "2x2" => (2usize, 2usize),
                "2x3" => (3, 2),
                "3x2" => (2, 3),
                _ => (3, 3),
            };

            // For each row, compute the natural row width at a shared reference height
            let ref_h = 1080.0_f64;
            let mut row_widths: Vec<f64> = Vec::new();
            for r in 0..rows {
                let mut rw = 0.0;
                for c in 0..cols {
                    let idx = r * cols + c;
                    rw += aspects[idx] * ref_h;
                }
                row_widths.push(rw);
            }

            // Normalize to the max row width
            let max_rw = row_widths.iter().copied().fold(0.0_f64, f64::max);

            let mut tiles = Vec::new();
            let mut y_off = 0u32;
            for r in 0..rows {
                // Adjust row height so this row's total width == max_rw
                let sum_a: f64 = (0..cols).map(|c| aspects[r * cols + c]).sum();
                let rh = make_even((max_rw / sum_a) as u32);
                let mut x_off = 0u32;
                for c in 0..cols {
                    let idx = r * cols + c;
                    let tw = if c == cols - 1 {
                        make_even(max_rw as u32) - x_off
                    } else {
                        make_even((aspects[idx] * rh as f64) as u32)
                    };
                    tiles.push(TileRect {
                        w: tw,
                        h: rh,
                        x: x_off,
                        y: y_off,
                    });
                    x_off += tw;
                }
                y_off += rh;
            }
            Some(AdaptiveDimensions {
                output_width: make_even(max_rw as u32),
                output_height: y_off,
                tiles,
            })
        }

        // PiP: main tile with overlay
        "pip" => {
            let ref_h = heights[0] as f64;
            let main_w = make_even((aspects[0] * ref_h) as u32);
            let main_h = make_even(ref_h as u32);
            let pip_w = make_even((aspects[1] * ref_h / 4.0) as u32);
            let pip_h = make_even((ref_h / 4.0) as u32);
            let pip_x = main_w.saturating_sub(pip_w + 20);
            let pip_y = 20u32;
            Some(AdaptiveDimensions {
                output_width: main_w,
                output_height: main_h,
                tiles: vec![
                    TileRect {
                        w: main_w,
                        h: main_h,
                        x: 0,
                        y: 0,
                    },
                    TileRect {
                        w: pip_w,
                        h: pip_h,
                        x: pip_x,
                        y: pip_y,
                    },
                ],
            })
        }

        // 1+2 / left-big-right-stack: [left] hstack [rt vstack rb]
        "1+2" | "left-big-right-stack" => {
            let a_left = aspects[0];
            let a_rt = aspects[1];
            let a_rb = aspects[2];
            let ref_h = *heights.iter().max()? as f64;
            // right_w satisfies: right_w/a_rt + right_w/a_rb = ref_h
            let right_w = ref_h / (1.0 / a_rt + 1.0 / a_rb);
            let right_w = make_even(right_w as u32);
            let rt_h = make_even((right_w as f64 / a_rt) as u32);
            let rb_h = make_even(ref_h as u32) - rt_h;
            let left_w = make_even((a_left * ref_h) as u32);
            let left_h = make_even(ref_h as u32);
            Some(AdaptiveDimensions {
                output_width: left_w + right_w,
                output_height: left_h,
                tiles: vec![
                    TileRect {
                        w: left_w,
                        h: left_h,
                        x: 0,
                        y: 0,
                    },
                    TileRect {
                        w: right_w,
                        h: rt_h,
                        x: left_w,
                        y: 0,
                    },
                    TileRect {
                        w: right_w,
                        h: rb_h,
                        x: left_w,
                        y: rt_h,
                    },
                ],
            })
        }

        // 2+1: [lt vstack lb] hstack [right]
        "2+1" => {
            let a_lt = aspects[0];
            let a_lb = aspects[1];
            let a_right = aspects[2];
            let ref_h = *heights.iter().max()? as f64;
            let left_w = ref_h / (1.0 / a_lt + 1.0 / a_lb);
            let left_w = make_even(left_w as u32);
            let lt_h = make_even((left_w as f64 / a_lt) as u32);
            let lb_h = make_even(ref_h as u32) - lt_h;
            let right_w = make_even((a_right * ref_h) as u32);
            let right_h = make_even(ref_h as u32);
            Some(AdaptiveDimensions {
                output_width: left_w + right_w,
                output_height: right_h,
                tiles: vec![
                    TileRect {
                        w: left_w,
                        h: lt_h,
                        x: 0,
                        y: 0,
                    },
                    TileRect {
                        w: left_w,
                        h: lb_h,
                        x: 0,
                        y: lt_h,
                    },
                    TileRect {
                        w: right_w,
                        h: right_h,
                        x: left_w,
                        y: 0,
                    },
                ],
            })
        }

        // 1+3: [top] vstack [b1 hstack b2 hstack b3]
        "1+3" => {
            let a_top = aspects[0];
            let a_b1 = aspects[1];
            let a_b2 = aspects[2];
            let a_b3 = aspects[3];
            let ref_w = *widths.iter().max()? as f64;
            let top_h = make_even((ref_w / a_top) as u32);
            let bot_h = make_even((ref_w / (a_b1 + a_b2 + a_b3)) as u32);
            let b1_w = make_even((a_b1 * bot_h as f64) as u32);
            let b2_w = make_even((a_b2 * bot_h as f64) as u32);
            let b3_w = make_even(ref_w as u32) - b1_w - b2_w;
            let out_w = make_even(ref_w as u32);
            Some(AdaptiveDimensions {
                output_width: out_w,
                output_height: top_h + bot_h,
                tiles: vec![
                    TileRect {
                        w: out_w,
                        h: top_h,
                        x: 0,
                        y: 0,
                    },
                    TileRect {
                        w: b1_w,
                        h: bot_h,
                        x: 0,
                        y: top_h,
                    },
                    TileRect {
                        w: b2_w,
                        h: bot_h,
                        x: b1_w,
                        y: top_h,
                    },
                    TileRect {
                        w: b3_w,
                        h: bot_h,
                        x: b1_w + b2_w,
                        y: top_h,
                    },
                ],
            })
        }

        // 2x2-focus / top-big-bottom-stack: [top] vstack [bl hstack br]
        "2x2-focus" | "top-big-bottom-stack" => {
            let a_top = aspects[0];
            let a_bl = aspects[1];
            let a_br = aspects[2];
            let ref_w = *widths.iter().max()? as f64;
            let top_h = make_even((ref_w / a_top) as u32);
            let bot_h = make_even((ref_w / (a_bl + a_br)) as u32);
            let bl_w = make_even((a_bl * bot_h as f64) as u32);
            let br_w = make_even(ref_w as u32) - bl_w;
            let out_w = make_even(ref_w as u32);
            Some(AdaptiveDimensions {
                output_width: out_w,
                output_height: top_h + bot_h,
                tiles: vec![
                    TileRect {
                        w: out_w,
                        h: top_h,
                        x: 0,
                        y: 0,
                    },
                    TileRect {
                        w: bl_w,
                        h: bot_h,
                        x: 0,
                        y: top_h,
                    },
                    TileRect {
                        w: br_w,
                        h: bot_h,
                        x: bl_w,
                        y: top_h,
                    },
                ],
            })
        }

        // 3x3-focus: [big hstack [rt vstack rm]] vstack [bl hstack bm hstack br]
        "3x3-focus" => {
            let a_big = aspects[0];
            let a_rt = aspects[1];
            let a_rm = aspects[2];
            let a_bl = aspects[3];
            let a_bm = aspects[4];
            let a_br = aspects[5];
            let ref_w = *widths.iter().max()? as f64;
            // right_w satisfies: a_big * (right_w/a_rt + right_w/a_rm) + right_w = ref_w
            // => right_w * (a_big * (1/a_rt + 1/a_rm) + 1) = ref_w
            let right_w = ref_w / (a_big * (1.0 / a_rt + 1.0 / a_rm) + 1.0);
            let right_w = make_even(right_w as u32);
            let rt_h = make_even((right_w as f64 / a_rt) as u32);
            let rm_h = make_even((right_w as f64 / a_rm) as u32);
            let top_h = rt_h + rm_h;
            let big_w = make_even(ref_w as u32) - right_w;
            let bot_h = make_even((ref_w / (a_bl + a_bm + a_br)) as u32);
            let bl_w = make_even((a_bl * bot_h as f64) as u32);
            let bm_w = make_even((a_bm * bot_h as f64) as u32);
            let br_w = make_even(ref_w as u32) - bl_w - bm_w;
            let out_w = make_even(ref_w as u32);
            Some(AdaptiveDimensions {
                output_width: out_w,
                output_height: top_h + bot_h,
                tiles: vec![
                    TileRect {
                        w: big_w,
                        h: top_h,
                        x: 0,
                        y: 0,
                    },
                    TileRect {
                        w: right_w,
                        h: rt_h,
                        x: big_w,
                        y: 0,
                    },
                    TileRect {
                        w: right_w,
                        h: rm_h,
                        x: big_w,
                        y: rt_h,
                    },
                    TileRect {
                        w: bl_w,
                        h: bot_h,
                        x: 0,
                        y: top_h,
                    },
                    TileRect {
                        w: bm_w,
                        h: bot_h,
                        x: bl_w,
                        y: top_h,
                    },
                    TileRect {
                        w: br_w,
                        h: bot_h,
                        x: bl_w + bm_w,
                        y: top_h,
                    },
                ],
            })
        }

        _ => None,
    }
}

fn apply_padding_to_tile(x: u32, y: u32, w: u32, h: u32, padding: u32) -> TileRect {
    if padding == 0 {
        return TileRect {
            x: make_even(x),
            y: make_even(y),
            w: make_even(w),
            h: make_even(h),
        };
    }

    // Standard CSS Gap/Padding Model:
    // We treat 'padding' as the gap between tiles and the margin from the canvas edge.
    // To be perfectly deterministic, we inset every tile by the padding amount.
    let inset = padding;
    let safe_w = if w > inset * 2 { w - inset * 2 } else { 2 };
    let safe_h = if h > inset * 2 { h - inset * 2 } else { 2 };

    TileRect {
        x: make_even(x + inset),
        y: make_even(y + inset),
        w: make_even(safe_w),
        h: make_even(safe_h),
    }
}

fn build_custom_dimensions(
    rects: &[LayoutRect],
    width: u32,
    height: u32,
    padding: u32,
) -> AdaptiveDimensions {
    let mut tiles = Vec::new();
    for rect in rects {
        let mut x = (rect.x * width as f64).round() as u32;
        let mut y = (rect.y * height as f64).round() as u32;
        let mut w = (rect.w * width as f64).round() as u32;
        let mut h = (rect.h * height as f64).round() as u32;

        if x > width {
            x = width;
        }
        if y > height {
            y = height;
        }
        if x + w > width {
            w = width.saturating_sub(x);
        }
        if y + h > height {
            h = height.saturating_sub(y);
        }

        w = make_even(w);
        h = make_even(h);
        x = make_even(x);
        y = make_even(y);

        if padding > 0 {
            tiles.push(apply_padding_to_tile(x, y, w, h, padding));
        } else {
            tiles.push(TileRect { x, y, w, h });
        }
    }

    AdaptiveDimensions {
        tiles,
        output_width: make_even(width),
        output_height: make_even(height),
    }
}

fn build_tiled_command(
    opts: &TileOptions,
    tile_paths: &[PathBuf],
    tile_crop_positions: &[String],
    target_duration: &f64,
    output_path: &Path,
    per_tile_dims: Option<&AdaptiveDimensions>,
) -> Command {
    let mut cmd = Command::new("ffmpeg");
    for p in tile_paths {
        if !opts.no_repeat {
            cmd.arg("-stream_loop").arg("-1");
        }
        cmd.arg("-i").arg(p);
    }

    let mut filter_parts: Vec<String> = Vec::new();
    let n = tile_paths.len();

    if let Some(ad) = per_tile_dims {
        // Adaptive mode: use pre-computed per-tile dimensions with xstack for all layouts
        match opts.layout.as_str() {
            "pip" => {
                // PiP uses overlay, not xstack
                let main = &ad.tiles[0];
                let pip = &ad.tiles[1];
                filter_parts.push(format!(
                    "[0:v]{}[main]",
                    scale_expr_for_crop_mode_position(
                        main.w,
                        main.h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .first()
                            .map(String::as_str)
                            .unwrap_or("center"),
                    )
                ));
                filter_parts.push(format!(
                    "[1:v]{}[pip]",
                    scale_expr_for_crop_mode_position(
                        pip.w,
                        pip.h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .get(1)
                            .map(String::as_str)
                            .unwrap_or("center"),
                    )
                ));
                filter_parts.push(format!("[main][pip]overlay={}:{}[outv]", pip.x, pip.y));
            }
            "1+2" | "left-big-right-stack" => {
                let d = &ad.tiles;
                filter_parts.push(format!(
                    "[0:v]{}[l]",
                    scale_expr_for_crop_mode_position(
                        d[0].w,
                        d[0].h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .first()
                            .map(String::as_str)
                            .unwrap_or("center")
                    )
                ));
                filter_parts.push(format!(
                    "[1:v]{}[rt]",
                    scale_expr_for_crop_mode_position(
                        d[1].w,
                        d[1].h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .get(1)
                            .map(String::as_str)
                            .unwrap_or("center")
                    )
                ));
                filter_parts.push(format!(
                    "[2:v]{}[rb]",
                    scale_expr_for_crop_mode_position(
                        d[2].w,
                        d[2].h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .get(2)
                            .map(String::as_str)
                            .unwrap_or("center")
                    )
                ));
                filter_parts.push("[rt][rb]vstack[r]".to_string());
                filter_parts.push("[l][r]hstack[outv]".to_string());
            }
            "2+1" => {
                let d = &ad.tiles;
                filter_parts.push(format!(
                    "[0:v]{}[lt]",
                    scale_expr_for_crop_mode_position(
                        d[0].w,
                        d[0].h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .first()
                            .map(String::as_str)
                            .unwrap_or("center")
                    )
                ));
                filter_parts.push(format!(
                    "[1:v]{}[lb]",
                    scale_expr_for_crop_mode_position(
                        d[1].w,
                        d[1].h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .get(1)
                            .map(String::as_str)
                            .unwrap_or("center")
                    )
                ));
                filter_parts.push(format!(
                    "[2:v]{}[r]",
                    scale_expr_for_crop_mode_position(
                        d[2].w,
                        d[2].h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .get(2)
                            .map(String::as_str)
                            .unwrap_or("center")
                    )
                ));
                filter_parts.push("[lt][lb]vstack[l]".to_string());
                filter_parts.push("[l][r]hstack[outv]".to_string());
            }
            "1+3" => {
                let d = &ad.tiles;
                filter_parts.push(format!(
                    "[0:v]{}[t]",
                    scale_expr_for_crop_mode_position(
                        d[0].w,
                        d[0].h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .first()
                            .map(String::as_str)
                            .unwrap_or("center")
                    )
                ));
                filter_parts.push(format!(
                    "[1:v]{}[b1]",
                    scale_expr_for_crop_mode_position(
                        d[1].w,
                        d[1].h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .get(1)
                            .map(String::as_str)
                            .unwrap_or("center")
                    )
                ));
                filter_parts.push(format!(
                    "[2:v]{}[b2]",
                    scale_expr_for_crop_mode_position(
                        d[2].w,
                        d[2].h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .get(2)
                            .map(String::as_str)
                            .unwrap_or("center")
                    )
                ));
                filter_parts.push(format!(
                    "[3:v]{}[b3]",
                    scale_expr_for_crop_mode_position(
                        d[3].w,
                        d[3].h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .get(3)
                            .map(String::as_str)
                            .unwrap_or("center")
                    )
                ));
                filter_parts.push("[b1][b2][b3]hstack=inputs=3[b]".to_string());
                filter_parts.push("[t][b]vstack[outv]".to_string());
            }
            "2x2-focus" | "top-big-bottom-stack" => {
                let d = &ad.tiles;
                filter_parts.push(format!(
                    "[0:v]{}[t]",
                    scale_expr_for_crop_mode_position(
                        d[0].w,
                        d[0].h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .first()
                            .map(String::as_str)
                            .unwrap_or("center")
                    )
                ));
                filter_parts.push(format!(
                    "[1:v]{}[bl]",
                    scale_expr_for_crop_mode_position(
                        d[1].w,
                        d[1].h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .get(1)
                            .map(String::as_str)
                            .unwrap_or("center")
                    )
                ));
                filter_parts.push(format!(
                    "[2:v]{}[br]",
                    scale_expr_for_crop_mode_position(
                        d[2].w,
                        d[2].h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .get(2)
                            .map(String::as_str)
                            .unwrap_or("center")
                    )
                ));
                filter_parts.push("[bl][br]hstack[b]".to_string());
                filter_parts.push("[t][b]vstack[outv]".to_string());
            }
            "3x3-focus" => {
                let d = &ad.tiles;
                filter_parts.push(format!(
                    "[0:v]{}[big]",
                    scale_expr_for_crop_mode_position(
                        d[0].w,
                        d[0].h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .first()
                            .map(String::as_str)
                            .unwrap_or("center")
                    )
                ));
                filter_parts.push(format!(
                    "[1:v]{}[rt]",
                    scale_expr_for_crop_mode_position(
                        d[1].w,
                        d[1].h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .get(1)
                            .map(String::as_str)
                            .unwrap_or("center")
                    )
                ));
                filter_parts.push(format!(
                    "[2:v]{}[rm]",
                    scale_expr_for_crop_mode_position(
                        d[2].w,
                        d[2].h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .get(2)
                            .map(String::as_str)
                            .unwrap_or("center")
                    )
                ));
                filter_parts.push(format!(
                    "[3:v]{}[bl]",
                    scale_expr_for_crop_mode_position(
                        d[3].w,
                        d[3].h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .get(3)
                            .map(String::as_str)
                            .unwrap_or("center")
                    )
                ));
                filter_parts.push(format!(
                    "[4:v]{}[bm]",
                    scale_expr_for_crop_mode_position(
                        d[4].w,
                        d[4].h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .get(4)
                            .map(String::as_str)
                            .unwrap_or("center")
                    )
                ));
                filter_parts.push(format!(
                    "[5:v]{}[br]",
                    scale_expr_for_crop_mode_position(
                        d[5].w,
                        d[5].h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .get(5)
                            .map(String::as_str)
                            .unwrap_or("center")
                    )
                ));
                filter_parts.push("[rt][rm]vstack[r]".to_string());
                filter_parts.push("[big][r]hstack[t]".to_string());
                filter_parts.push("[bl][bm][br]hstack=inputs=3[b]".to_string());
                filter_parts.push("[t][b]vstack[outv]".to_string());
            }
            _ => {
                // Grid/row/column layouts: use xstack with adaptive per-tile dims
                let mut layout_positions = Vec::<String>::new();
                let mut inputs = String::new();
                for (i, dim) in ad.tiles.iter().enumerate() {
                    let crop_pos = tile_crop_positions
                        .get(i)
                        .map(String::as_str)
                        .unwrap_or("center");
                    filter_parts.push(format!(
                        "[{i}:v]{}[sv{i}]",
                        scale_expr_for_crop_mode_position(dim.w, dim.h, &opts.crop_mode, crop_pos)
                    ));
                    inputs.push_str(&format!("[sv{i}]"));
                    layout_positions.push(format!("{}_{}", dim.x, dim.y));
                }
                filter_parts.push(format!(
                    "{inputs}xstack=inputs={n}:layout={}:fill=#{}[outv]",
                    layout_positions.join("|"),
                    opts.bg_color
                ));
            }
        }
    } else {
        match opts.layout.as_str() {
            "2x1" | "1x2" | "2x2" | "2x3" | "3x2" | "3x1" | "1x3" | "4x1" | "1x4" | "3x3" => {
                let (rows, cols) = match opts.layout.as_str() {
                    "2x1" => (1, 2),
                    "1x2" => (2, 1),
                    "2x2" => (2, 2),
                    "2x3" => (3, 2),
                    "3x2" => (2, 3),
                    "3x1" => (1, 3),
                    "1x3" => (3, 1),
                    "4x1" => (1, 4),
                    "1x4" => (4, 1),
                    _ => (3, 3),
                };
                let raw_tile_w = opts.width / cols;
                let raw_tile_h = opts.height / rows;
                let mut layout_positions = Vec::<String>::new();
                let mut inputs = String::new();
                for i in 0..n {
                    let col = (i % cols as usize) as u32;
                    let row = (i / cols as usize) as u32;
                    let raw_x = col * raw_tile_w;
                    let raw_y = row * raw_tile_h;
                    let tile = if opts.padding > 0 {
                        apply_padding_to_tile(raw_x, raw_y, raw_tile_w, raw_tile_h, opts.padding)
                    } else {
                        TileRect {
                            x: raw_x,
                            y: raw_y,
                            w: raw_tile_w,
                            h: raw_tile_h,
                        }
                    };
                    let crop_pos = tile_crop_positions
                        .get(i)
                        .map(String::as_str)
                        .unwrap_or("center");
                    filter_parts.push(format!(
                        "[{i}:v]{}[sv{i}]",
                        scale_expr_for_crop_mode_position(
                            tile.w,
                            tile.h,
                            &opts.crop_mode,
                            crop_pos
                        )
                    ));
                    inputs.push_str(&format!("[sv{i}]"));
                    layout_positions.push(format!("{}_{}", tile.x, tile.y));
                }
                filter_parts.push(format!(
                    "{inputs}xstack=inputs={n}:layout={}:fill=#{}[outv]",
                    layout_positions.join("|"),
                    opts.bg_color
                ));
            }
            "pip" => {
                let main_w = opts.width;
                let main_h = opts.height;
                let pip_w = opts.width / 4;
                let pip_h = opts.height / 4;
                let pip_x = opts.width.saturating_sub(pip_w + 20);
                let pip_y = 20_u32;
                filter_parts.push(format!(
                    "[0:v]{}[main]",
                    scale_expr_for_crop_mode_position(
                        main_w,
                        main_h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .first()
                            .map(String::as_str)
                            .unwrap_or("center"),
                    )
                ));
                filter_parts.push(format!(
                    "[1:v]{}[pip]",
                    scale_expr_for_crop_mode_position(
                        pip_w,
                        pip_h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .get(1)
                            .map(String::as_str)
                            .unwrap_or("center"),
                    )
                ));
                filter_parts.push(format!("[main][pip]overlay={pip_x}:{pip_y}[outv]"));
            }
            "1+2" | "left-big-right-stack" => {
                let left_w = ((opts.width * 2) / 3) & !1;
                let right_w = opts.width - left_w;
                let top_h = (opts.height / 2) & !1;
                let bot_h = opts.height - top_h;
                filter_parts.push(format!(
                    "[0:v]{}[l]",
                    scale_expr_for_crop_mode_position(
                        left_w,
                        opts.height,
                        &opts.crop_mode,
                        tile_crop_positions
                            .first()
                            .map(String::as_str)
                            .unwrap_or("center"),
                    )
                ));
                filter_parts.push(format!(
                    "[1:v]{}[rt]",
                    scale_expr_for_crop_mode_position(
                        right_w,
                        top_h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .get(1)
                            .map(String::as_str)
                            .unwrap_or("center"),
                    )
                ));
                filter_parts.push(format!(
                    "[2:v]{}[rb]",
                    scale_expr_for_crop_mode_position(
                        right_w,
                        bot_h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .get(2)
                            .map(String::as_str)
                            .unwrap_or("center"),
                    )
                ));
                filter_parts.push("[rt][rb]vstack[r]".to_string());
                filter_parts.push("[l][r]hstack[outv]".to_string());
            }
            "2+1" => {
                let left_w = (opts.width / 3) & !1;
                let right_w = opts.width - left_w;
                let top_h = (opts.height / 2) & !1;
                let bot_h = opts.height - top_h;
                filter_parts.push(format!(
                    "[0:v]{}[lt]",
                    scale_expr_for_crop_mode_position(
                        left_w,
                        top_h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .first()
                            .map(String::as_str)
                            .unwrap_or("center"),
                    )
                ));
                filter_parts.push(format!(
                    "[1:v]{}[lb]",
                    scale_expr_for_crop_mode_position(
                        left_w,
                        bot_h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .get(1)
                            .map(String::as_str)
                            .unwrap_or("center"),
                    )
                ));
                filter_parts.push(format!(
                    "[2:v]{}[r]",
                    scale_expr_for_crop_mode_position(
                        right_w,
                        opts.height,
                        &opts.crop_mode,
                        tile_crop_positions
                            .get(2)
                            .map(String::as_str)
                            .unwrap_or("center"),
                    )
                ));
                filter_parts.push("[lt][lb]vstack[l]".to_string());
                filter_parts.push("[l][r]hstack[outv]".to_string());
            }
            "1+3" => {
                let top_h = ((opts.height * 2) / 3) & !1;
                let bot_h = opts.height - top_h;
                let bw = (opts.width / 3) & !1;
                let bw_last = opts.width - bw * 2;
                filter_parts.push(format!(
                    "[0:v]{}[t]",
                    scale_expr_for_crop_mode_position(
                        opts.width,
                        top_h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .first()
                            .map(String::as_str)
                            .unwrap_or("center"),
                    )
                ));
                filter_parts.push(format!(
                    "[1:v]{}[b1]",
                    scale_expr_for_crop_mode_position(
                        bw,
                        bot_h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .get(1)
                            .map(String::as_str)
                            .unwrap_or("center"),
                    )
                ));
                filter_parts.push(format!(
                    "[2:v]{}[b2]",
                    scale_expr_for_crop_mode_position(
                        bw,
                        bot_h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .get(2)
                            .map(String::as_str)
                            .unwrap_or("center"),
                    )
                ));
                filter_parts.push(format!(
                    "[3:v]{}[b3]",
                    scale_expr_for_crop_mode_position(
                        bw_last,
                        bot_h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .get(3)
                            .map(String::as_str)
                            .unwrap_or("center"),
                    )
                ));
                filter_parts.push("[b1][b2][b3]hstack=inputs=3[b]".to_string());
                filter_parts.push("[t][b]vstack[outv]".to_string());
            }
            "2x2-focus" | "top-big-bottom-stack" => {
                let top_h = ((opts.height * 2) / 3) & !1;
                let bot_h = opts.height - top_h;
                let left_w = (opts.width / 2) & !1;
                let right_w = opts.width - left_w;
                filter_parts.push(format!(
                    "[0:v]{}[t]",
                    scale_expr_for_crop_mode_position(
                        opts.width,
                        top_h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .first()
                            .map(String::as_str)
                            .unwrap_or("center"),
                    )
                ));
                filter_parts.push(format!(
                    "[1:v]{}[bl]",
                    scale_expr_for_crop_mode_position(
                        left_w,
                        bot_h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .get(1)
                            .map(String::as_str)
                            .unwrap_or("center"),
                    )
                ));
                filter_parts.push(format!(
                    "[2:v]{}[br]",
                    scale_expr_for_crop_mode_position(
                        right_w,
                        bot_h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .get(2)
                            .map(String::as_str)
                            .unwrap_or("center"),
                    )
                ));
                filter_parts.push("[bl][br]hstack[b]".to_string());
                filter_parts.push("[t][b]vstack[outv]".to_string());
            }
            "3x3-focus" => {
                let col_w = (opts.width / 3) & !1;
                let right_w = opts.width - col_w * 2;
                let row_h = ((opts.height * 2) / 5) & !1;
                let row_h2 = ((opts.height * 2) / 5) & !1;
                let bot_h = opts.height - row_h - row_h2;
                let big_w = opts.width - right_w;
                let big_h = row_h + row_h2;

                filter_parts.push(format!(
                    "[0:v]{}[big]",
                    scale_expr_for_crop_mode_position(
                        big_w,
                        big_h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .first()
                            .map(String::as_str)
                            .unwrap_or("center"),
                    )
                ));
                filter_parts.push(format!(
                    "[1:v]{}[rt]",
                    scale_expr_for_crop_mode_position(
                        right_w,
                        row_h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .get(1)
                            .map(String::as_str)
                            .unwrap_or("center"),
                    )
                ));
                filter_parts.push(format!(
                    "[2:v]{}[rm]",
                    scale_expr_for_crop_mode_position(
                        right_w,
                        row_h2,
                        &opts.crop_mode,
                        tile_crop_positions
                            .get(2)
                            .map(String::as_str)
                            .unwrap_or("center"),
                    )
                ));
                filter_parts.push(format!(
                    "[3:v]{}[bl]",
                    scale_expr_for_crop_mode_position(
                        col_w,
                        bot_h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .get(3)
                            .map(String::as_str)
                            .unwrap_or("center"),
                    )
                ));
                filter_parts.push(format!(
                    "[4:v]{}[bm]",
                    scale_expr_for_crop_mode_position(
                        col_w,
                        bot_h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .get(4)
                            .map(String::as_str)
                            .unwrap_or("center"),
                    )
                ));
                filter_parts.push(format!(
                    "[5:v]{}[br]",
                    scale_expr_for_crop_mode_position(
                        right_w,
                        bot_h,
                        &opts.crop_mode,
                        tile_crop_positions
                            .get(5)
                            .map(String::as_str)
                            .unwrap_or("center"),
                    )
                ));
                filter_parts.push("[rt][rm]vstack[r]".to_string());
                filter_parts.push("[big][r]hstack[t]".to_string());
                filter_parts.push("[bl][bm][br]hstack=inputs=3[b]".to_string());
                filter_parts.push("[t][b]vstack[outv]".to_string());
            }
            _ => {}
        }
    } // end fixed mode

    let filtered_audio_tiles: Vec<usize> = opts
        .audio_tiles
        .iter()
        .copied()
        .filter(|i| *i < n)
        .collect();

    if opts.audio_enabled && !filtered_audio_tiles.is_empty() {
        let mut audio_inputs = Vec::<String>::new();
        for idx in &filtered_audio_tiles {
            let label = format!("a{idx}");
            filter_parts.push(format!(
                "[{idx}:a:0]aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[{label}]"
            ));
            audio_inputs.push(format!("[{label}]"));
        }
        // One audio path for all cases: always amix to ensure deterministic duration/mixing policy
        filter_parts.push(format!(
            "{}amix=inputs={}:duration=longest:dropout_transition=0[outa]",
            audio_inputs.join(""),
            audio_inputs.len()
        ));
    }

    let mut video_map = "[outv]".to_string();
    if opts.padding > 0 {
        filter_parts.push(format!(
            "[outv]pad={}:{}:0:0:#{}[outv_canvas]",
            make_even(opts.width),
            make_even(opts.height),
            opts.bg_color
        ));
        video_map = "[outv_canvas]".to_string();
    } else if per_tile_dims.is_some() {
        filter_parts.push("[outv]pad=ceil(iw/2)*2:ceil(ih/2)*2[outv_even]".to_string());
        video_map = "[outv_even]".to_string();
    }

    // Enforce Canonical Contract on Final Output
    cmd.arg("-fflags").arg("+genpts");
    
    cmd.arg("-filter_complex")
        .arg(filter_parts.join(";"))
        .arg("-map")
        .arg(video_map);

    if opts.audio_enabled && !filtered_audio_tiles.is_empty() {
        cmd.arg("-map").arg("[outa]");
    }

    cmd.arg("-c:v")
        .arg("libx264")
        .arg("-preset")
        .arg("medium")
        .arg("-crf")
        .arg("23")
        .arg("-pix_fmt")
        .arg("yuv420p");

    if opts.audio_enabled && !filtered_audio_tiles.is_empty() {
        cmd.arg("-c:a").arg("aac").arg("-b:a").arg("192k")
           .arg("-ar").arg("48000").arg("-ac").arg("2");
    } else {
        cmd.arg("-an");
    }

    // Always enforce CFR in final output to prevent drift
    cmd.arg("-vsync").arg("cfr").arg("-fps_mode").arg("cfr");

    cmd.arg("-t")
        .arg(format!("{:.6}", target_duration))
        .arg("-y")
        .arg(output_path);

    cmd
}

fn run_command_output(mut cmd: Command) -> bool {
    match cmd.output() {
        Ok(out) if out.status.success() => true,
        Ok(out) => {
            if !out.stderr.is_empty() {
                eprintln!("{}", String::from_utf8_lossy(&out.stderr));
            }
            false
        }
        Err(err) => {
            eprintln!("error running command: {err}");
            false
        }
    }
}

fn resolve_output_no_overwrite(path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }
    let parent = path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "output".to_string());
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_default();
    let mut i = 1usize;
    loop {
        let candidate = if ext.is_empty() {
            parent.join(format!("{stem}_{i:03}"))
        } else {
            parent.join(format!("{stem}_{i:03}.{ext}"))
        };
        if !candidate.exists() {
            return candidate;
        }
        i += 1;
    }
}

fn order_files(mut files: Vec<PathBuf>, mode: &str) -> Vec<PathBuf> {
    if mode == "random" || mode == "shuffle-round-robin" {
        simple_shuffle(&mut files);
    }
    files
}

fn apply_source_repeat_policy(
    files: Vec<PathBuf>,
    policy: &str,
    used_global: &mut HashSet<PathBuf>,
) -> Vec<PathBuf> {
    if policy == "allow" {
        return files;
    }

    let mut unique_tile = Vec::<PathBuf>::new();
    let mut seen_tile = HashSet::<PathBuf>::new();
    for file in files {
        if seen_tile.insert(file.clone()) {
            unique_tile.push(file);
        }
    }

    if policy == "no_reuse_per_tile" {
        return unique_tile;
    }

    if policy == "no_reuse_global" {
        let mut unique_global = Vec::<PathBuf>::new();
        for file in unique_tile {
            if used_global.insert(file.clone()) {
                unique_global.push(file);
            }
        }
        return unique_global;
    }

    unique_tile
}

fn simple_shuffle<T>(items: &mut [T]) {
    if items.len() < 2 {
        return;
    }
    let mut seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0x1234_5678_9abc_def0);
    for i in (1..items.len()).rev() {
        // xorshift64*
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        let j = (seed as usize) % (i + 1);
        items.swap(i, j);
    }
}

fn distribute_videos(files: &[PathBuf], num_tiles: usize, mode: &str) -> Vec<Vec<PathBuf>> {
    let mut out = vec![Vec::<PathBuf>::new(); num_tiles];
    if num_tiles == 0 {
        return out;
    }
    if files.is_empty() {
        return out;
    }

    match mode {
        "sequential" => {
            let total = files.len();
            let per_tile = total / num_tiles;
            let remainder = total % num_tiles;
            let mut start = 0usize;
            for (i, bucket) in out.iter_mut().enumerate().take(num_tiles) {
                let size = per_tile + if i < remainder { 1 } else { 0 };
                let end = (start + size).min(total);
                if start < end {
                    *bucket = files[start..end].to_vec();
                }
                start = end;
            }
        }
        "random" => {
            let mut shuffled = files.to_vec();
            simple_shuffle(&mut shuffled);
            let total = shuffled.len();
            let per_tile = total / num_tiles;
            let remainder = total % num_tiles;
            let mut start = 0usize;
            for (i, bucket) in out.iter_mut().enumerate().take(num_tiles) {
                let size = per_tile + if i < remainder { 1 } else { 0 };
                let end = (start + size).min(total);
                if start < end {
                    *bucket = shuffled[start..end].to_vec();
                }
                start = end;
            }
        }
        "shuffle-round-robin" => {
            let mut shuffled = files.to_vec();
            simple_shuffle(&mut shuffled);
            for (i, f) in shuffled.iter().enumerate() {
                out[i % num_tiles].push(f.clone());
            }
        }
        _ => {
            // round-robin (and unknown fallback)
            for (i, f) in files.iter().enumerate() {
                out[i % num_tiles].push(f.clone());
            }
        }
    }
    out
}

fn scale_expr_for_crop_mode_position(
    w: u32,
    h: u32,
    crop_mode: &str,
    crop_position: &str,
) -> String {
    match crop_mode {
        "pad" => format!(
            "scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2"
        ),
        "stretch" => format!("scale={w}:{h}"),
        _ => {
            let crop = match crop_position {
                "top" => format!("crop={w}:{h}:0:0"),
                "bottom" => format!("crop={w}:{h}:0:ih-{h}"),
                "left" => format!("crop={w}:{h}:0:0"),
                "right" => format!("crop={w}:{h}:iw-{w}:0"),
                "top-left" => format!("crop={w}:{h}:0:0"),
                "top-right" => format!("crop={w}:{h}:iw-{w}:0"),
                "bottom-left" => format!("crop={w}:{h}:0:ih-{h}"),
                "bottom-right" => format!("crop={w}:{h}:iw-{w}:ih-{h}"),
                _ => format!("crop={w}:{h}"),
            };
            format!("scale={w}:{h}:force_original_aspect_ratio=increase,{crop}")
        }
    }
}

fn json_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for ch in s.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            _ => out.push(ch),
        }
    }
    out
}

fn save_tile_settings_json(
    path: &Path,
    layout: &str,
    crop_mode: &str,
    tile_folders: &[String],
    audio_enabled: bool,
    audio_tiles: &[usize],
    distribution_mode: Option<&str>,
    max_total_duration: Option<f64>,
    max_duration: Option<f64>,
    tile_settings: &[EditableTileSetting],
    sizing_mode: Option<&str>,
) -> Result<(), String> {
    let mut body = String::new();
    body.push_str("{\n");
    body.push_str(&format!(
        "  \"layout_code\": \"{}\",\n",
        json_escape(layout)
    ));
    body.push_str(&format!(
        "  \"crop_mode\": \"{}\",\n",
        json_escape(crop_mode)
    ));

    body.push_str("  \"tile_folders\": [");
    for (i, folder) in tile_folders.iter().enumerate() {
        if i > 0 {
            body.push_str(", ");
        }
        body.push_str(&format!("\"{}\"", json_escape(folder)));
    }
    body.push_str("],\n");

    body.push_str(&format!(
        "  \"audio_enabled\": {},\n",
        if audio_enabled { "true" } else { "false" }
    ));
    body.push_str("  \"audio_tiles\": [");
    for (i, tile) in audio_tiles.iter().enumerate() {
        if i > 0 {
            body.push_str(", ");
        }
        body.push_str(&tile.to_string());
    }
    body.push_str("],\n");
    body.push_str(&format!(
        "  \"audio_tile\": {},\n",
        audio_tiles.first().copied().unwrap_or(0)
    ));

    if let Some(v) = max_total_duration {
        body.push_str(&format!("  \"max_total_duration\": {:.6},\n", v));
    }
    if let Some(v) = max_duration {
        body.push_str(&format!("  \"max_duration\": {:.6},\n", v));
    }
    if let Some(dm) = distribution_mode {
        body.push_str(&format!(
            "  \"distribution_mode\": \"{}\",\n",
            json_escape(dm)
        ));
    }
    if let Some(sm) = sizing_mode {
        body.push_str(&format!("  \"sizing_mode\": \"{}\",\n", json_escape(sm)));
    }

    body.push_str("  \"max_durations\": [");
    for (i, item) in tile_settings.iter().enumerate() {
        if i > 0 {
            body.push_str(", ");
        }
        if let Some(v) = item.max_duration {
            body.push_str(&format!("{:.6}", v));
        } else {
            body.push_str("null");
        }
    }
    body.push_str("],\n");

    body.push_str("  \"tile_settings\": [\n");
    for (i, ts) in tile_settings.iter().enumerate() {
        body.push_str("    {\n");
        body.push_str(&format!(
            "      \"trans_type\": \"{}\",\n",
            json_escape(&ts.trans_type)
        ));
        body.push_str(&format!(
            "      \"trans_duration\": {:.6},\n",
            ts.trans_duration
        ));
        body.push_str(&format!(
            "      \"crop_position\": \"{}\",\n",
            json_escape(&ts.crop_position)
        ));
        body.push_str(&format!("      \"speed\": {:.6},\n", ts.speed));
        body.push_str(&format!("      \"mode\": \"{}\",\n", json_escape(&ts.mode)));
        body.push_str(&format!(
            "      \"image_duration\": {:.6},\n",
            ts.image_duration
        ));
        body.push_str(&format!(
            "      \"use_landscape\": {}\n",
            if ts.use_landscape { "true" } else { "false" }
        ));
        body.push_str("    }");
        if i + 1 < tile_settings.len() {
            body.push(',');
        }
        body.push('\n');
    }
    body.push_str("  ]\n");
    body.push_str("}\n");

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed creating {}: {e}", parent.display()))?;
    }
    fs::write(path, body).map_err(|e| format!("failed writing {}: {e}", path.display()))
}

fn find_key_value_start(s: &str, key: &str) -> Option<usize> {
    let needle = format!("\"{key}\"");
    let key_pos = s.find(&needle)?;
    let rest = &s[key_pos + needle.len()..];
    let colon = rest.find(':')?;
    Some(key_pos + needle.len() + colon + 1)
}

fn parse_json_string_value(s: &str, key: &str) -> Option<String> {
    let mut i = find_key_value_start(s, key)?;
    let b = s.as_bytes();
    while i < b.len() && b[i].is_ascii_whitespace() {
        i += 1;
    }
    if i >= b.len() || b[i] != b'"' {
        return None;
    }
    i += 1;
    let start = i;
    while i < b.len() && b[i] != b'"' {
        i += 1;
    }
    Some(s[start..i].to_string())
}

fn parse_json_bool_value(s: &str, key: &str) -> Option<bool> {
    let mut i = find_key_value_start(s, key)?;
    let b = s.as_bytes();
    while i < b.len() && b[i].is_ascii_whitespace() {
        i += 1;
    }
    if s[i..].starts_with("true") {
        Some(true)
    } else if s[i..].starts_with("false") {
        Some(false)
    } else {
        None
    }
}

fn parse_json_number_value(s: &str, key: &str) -> Option<f64> {
    let mut i = find_key_value_start(s, key)?;
    let b = s.as_bytes();
    while i < b.len() && b[i].is_ascii_whitespace() {
        i += 1;
    }
    let start = i;
    while i < b.len() && (b[i].is_ascii_digit() || b[i] == b'.' || b[i] == b'-') {
        i += 1;
    }
    s[start..i].parse::<f64>().ok()
}

fn parse_json_array_block(s: &str, key: &str) -> Option<String> {
    let mut i = find_key_value_start(s, key)?;
    let b = s.as_bytes();
    while i < b.len() && b[i].is_ascii_whitespace() {
        i += 1;
    }
    if i >= b.len() || b[i] != b'[' {
        return None;
    }
    let start = i;
    let mut depth = 0_i32;
    while i < b.len() {
        if b[i] == b'[' {
            depth += 1;
        } else if b[i] == b']' {
            depth -= 1;
            if depth == 0 {
                return Some(s[start..=i].to_string());
            }
        }
        i += 1;
    }
    None
}

fn parse_json_string_array(s: &str, key: &str) -> Vec<String> {
    let block = match parse_json_array_block(s, key) {
        Some(v) => v,
        None => return Vec::new(),
    };
    let mut out = Vec::<String>::new();
    let bytes = block.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'"' {
            i += 1;
            let start = i;
            while i < bytes.len() && bytes[i] != b'"' {
                i += 1;
            }
            if i <= bytes.len() {
                out.push(block[start..i].to_string());
            }
        }
        i += 1;
    }
    out
}

fn parse_json_usize_array(s: &str, key: &str) -> Vec<usize> {
    let block = match parse_json_array_block(s, key) {
        Some(v) => v,
        None => return Vec::new(),
    };
    block
        .trim_matches(|c| c == '[' || c == ']')
        .split(',')
        .filter_map(|v| v.trim().parse::<usize>().ok())
        .collect()
}

fn parse_tile_settings_block(
    s: &str,
) -> (
    Vec<String>,
    Vec<f64>,
    Vec<f64>,
    Vec<String>,
    Vec<f64>,
    Vec<bool>,
    Vec<String>,
) {
    let block = match parse_json_array_block(s, "tile_settings") {
        Some(v) => v,
        None => {
            return (
                Vec::new(),
                Vec::new(),
                Vec::new(),
                Vec::new(),
                Vec::new(),
                Vec::new(),
                Vec::new(),
            )
        }
    };
    let mut trans = Vec::<String>::new();
    let mut durs = Vec::<f64>::new();
    let mut speeds = Vec::<f64>::new();
    let mut modes = Vec::<String>::new();
    let mut image_durations = Vec::<f64>::new();
    let mut use_landscape = Vec::<bool>::new();
    let mut crop_positions = Vec::<String>::new();

    let bytes = block.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'{' {
            let start = i;
            let mut depth = 0_i32;
            while i < bytes.len() {
                if bytes[i] == b'{' {
                    depth += 1;
                } else if bytes[i] == b'}' {
                    depth -= 1;
                    if depth == 0 {
                        let obj = &block[start..=i];
                        trans.push(
                            parse_json_string_value(obj, "trans_type")
                                .unwrap_or_else(|| "cut".to_string()),
                        );
                        durs.push(parse_json_number_value(obj, "trans_duration").unwrap_or(0.0));
                        speeds.push(parse_json_number_value(obj, "speed").unwrap_or(1.0));
                        modes.push(
                            parse_json_string_value(obj, "mode")
                                .unwrap_or_else(|| "video".to_string()),
                        );
                        image_durations
                            .push(parse_json_number_value(obj, "image_duration").unwrap_or(3.0));
                        use_landscape
                            .push(parse_json_bool_value(obj, "use_landscape").unwrap_or(false));
                        crop_positions.push(
                            parse_json_string_value(obj, "crop_position")
                                .unwrap_or_else(|| "center".to_string()),
                        );
                        break;
                    }
                }
                i += 1;
            }
        }
        i += 1;
    }
    (
        trans,
        durs,
        speeds,
        modes,
        image_durations,
        use_landscape,
        crop_positions,
    )
}

fn parse_json_optional_number_array(s: &str, key: &str) -> Vec<Option<f64>> {
    let block = match parse_json_array_block(s, key) {
        Some(v) => v,
        None => return Vec::new(),
    };
    let inner = block.trim_matches(|c| c == '[' || c == ']');
    if inner.trim().is_empty() {
        return Vec::new();
    }
    inner
        .split(',')
        .map(|v| {
            let t = v.trim();
            if t.eq_ignore_ascii_case("null") || t.is_empty() {
                None
            } else {
                t.parse::<f64>().ok()
            }
        })
        .collect()
}

fn parse_json_layout_rects(s: &str, key: &str) -> Vec<LayoutRect> {
    let block = match parse_json_array_block(s, key) {
        Some(v) => v,
        None => return Vec::new(),
    };
    let mut out = Vec::<LayoutRect>::new();
    let bytes = block.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'{' {
            let start = i;
            let mut depth = 0i32;
            while i < bytes.len() {
                if bytes[i] == b'{' {
                    depth += 1;
                } else if bytes[i] == b'}' {
                    depth -= 1;
                    if depth == 0 {
                        let obj = &block[start..=i];
                        let x = parse_json_number_value(obj, "x").unwrap_or(0.0);
                        let y = parse_json_number_value(obj, "y").unwrap_or(0.0);
                        let w = parse_json_number_value(obj, "w").unwrap_or(0.0);
                        let h = parse_json_number_value(obj, "h").unwrap_or(0.0);
                        if w > 0.0 && h > 0.0 {
                            out.push(LayoutRect { x, y, w, h });
                        }
                        break;
                    }
                }
                i += 1;
            }
        }
        i += 1;
    }
    out
}

fn load_settings_json(path: &Path) -> Result<LoadedSettings, String> {
    let content =
        fs::read_to_string(path).map_err(|e| format!("failed reading {}: {e}", path.display()))?;
    let mut out = LoadedSettings::default();
    out.layout_code = parse_json_string_value(&content, "layout_code");
    out.crop_mode = parse_json_string_value(&content, "crop_mode");
    out.layout_mode = parse_json_string_value(&content, "layout_mode");
    out.layout_rects = parse_json_layout_rects(&content, "layout_rects");
    out.render_mode = parse_json_string_value(&content, "render_mode");
    out.tile_folders = parse_json_string_array(&content, "tile_folders");
    out.audio_enabled = parse_json_bool_value(&content, "audio_enabled");
    out.audio_tiles = parse_json_usize_array(&content, "audio_tiles");
    out.max_total_duration = parse_json_number_value(&content, "max_total_duration");
    out.distribution_mode = parse_json_string_value(&content, "distribution_mode");
    let (t, d, s, m, id, ul, cp) = parse_tile_settings_block(&content);
    out.tile_transitions = t;
    out.tile_transition_durations = d;
    out.tile_speeds = s;
    out.tile_modes = m;
    out.tile_image_durations = id;
    out.tile_use_landscape = ul;
    out.tile_crop_positions = cp;
    out.max_durations = parse_json_optional_number_array(&content, "max_durations");
    out.max_duration = parse_json_number_value(&content, "max_duration");
    out.audio_tile = parse_json_number_value(&content, "audio_tile").and_then(|v| {
        if v >= 0.0 && v.fract().abs() < 1e-6 {
            Some(v as usize)
        } else {
            None
        }
    });
    out.sizing_mode = parse_json_string_value(&content, "sizing_mode");
    out.canvas_width = parse_json_number_value(&content, "canvas_width").map(|v| v as u32);
    out.canvas_height = parse_json_number_value(&content, "canvas_height").map(|v| v as u32);
    out.padding = parse_json_number_value(&content, "padding").map(|v| v as u32);
    out.bg_color = parse_json_string_value(&content, "bg_color");
    out.no_repeat = parse_json_bool_value(&content, "no_repeat");
    out.output_length_policy = parse_json_string_value(&content, "output_length_policy");
    out.source_repeat_policy = parse_json_string_value(&content, "source_repeat_policy");
    Ok(out)
}

fn check_ffmpeg_tools(root: &Path) -> bool {
    let ffmpeg_ok = Command::new("ffmpeg")
        .arg("-version")
        .current_dir(root)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    let ffprobe_ok = Command::new("ffprobe")
        .arg("-version")
        .current_dir(root)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    ffmpeg_ok && ffprobe_ok
}

fn resolve_output_dir(root: &Path, output: &str) -> PathBuf {
    let path = PathBuf::from(output);
    if path.is_absolute() {
        path
    } else {
        root.join(path)
    }
}

fn project_from_output_dir(root: &Path, output_dir: &Path) -> Option<String> {
    let rel = output_dir.strip_prefix(root).ok()?;
    let mut parts = rel.components();
    match (parts.next(), parts.next()) {
        (Some(Component::Normal(first)), Some(Component::Normal(second))) if first == "src" => {
            Some(second.to_string_lossy().to_string())
        }
        _ => None,
    }
}

fn list_immediate_dirs(folder: &Path) -> Vec<String> {
    let mut out = Vec::new();
    let entries = match fs::read_dir(folder) {
        Ok(e) => e,
        Err(_) => return out,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
            out.push(name.to_string());
        }
    }
    out
}

fn resolve_import_output_dir(
    output_dir: &Path,
    before_dirs: &[String],
) -> Option<(String, PathBuf)> {
    let after_dirs = list_immediate_dirs(output_dir);
    let mut new_dirs: Vec<String> = after_dirs
        .into_iter()
        .filter(|d| !before_dirs.iter().any(|b| b == d))
        .collect();
    if new_dirs.is_empty() {
        return None;
    }
    new_dirs.sort();
    let name = new_dirs.last().cloned()?;
    Some((name.clone(), output_dir.join(&name)))
}

fn resolve_folder_path(root: &Path, input: &str) -> PathBuf {
    let folder_path = PathBuf::from(input);

    if folder_path.is_absolute() || input.starts_with("./") || input.starts_with("../") {
        return folder_path;
    }

    let cwd_path = env::current_dir()
        .unwrap_or_else(|_| root.to_path_buf())
        .join(&folder_path);
    if cwd_path.exists() {
        return cwd_path;
    }

    let root_path = root.join(&folder_path);
    if root_path.exists() {
        return root_path;
    }

    let src_path = root.join("src").join(&folder_path);
    if src_path.exists() {
        return src_path;
    }

    src_path
}

fn get_video_files(folder: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let entries = match fs::read_dir(folder) {
        Ok(e) => e,
        Err(_) => return files,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = match path.extension() {
            Some(e) => format!(".{}", e.to_string_lossy().to_lowercase()),
            None => continue,
        };
        if VIDEO_EXTENSIONS.iter().any(|v| *v == ext) {
            files.push(path);
        }
    }

    files.sort_by_key(|p| {
        p.file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .unwrap_or_default()
    });
    files
}

fn get_video_files_recursive(folder: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let entries = match fs::read_dir(folder) {
        Ok(e) => e,
        Err(_) => return files,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            files.extend(get_video_files_recursive(&path));
            continue;
        }
        let ext = match path.extension() {
            Some(e) => format!(".{}", e.to_string_lossy().to_lowercase()),
            None => continue,
        };
        if VIDEO_EXTENSIONS.iter().any(|v| *v == ext) {
            files.push(path);
        }
    }
    files.sort_by_key(|p| {
        p.file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .unwrap_or_default()
    });
    files
}

fn get_video_files_with_trim(
    folder: &Path,
    max_duration: Option<f64>,
    root: &Path,
) -> (Vec<PathBuf>, Option<f64>) {
    let all = get_video_files(folder);
    let Some(max_dur) = max_duration else {
        return (all, None);
    };

    let mut filtered = Vec::<PathBuf>::new();
    for v in &all {
        if let Some(d) = get_video_duration(v, root) {
            if d <= max_dur {
                filtered.push(v.clone());
            }
        } else {
            filtered.push(v.clone());
        }
    }

    if filtered.is_empty() && !all.is_empty() {
        (all, Some(max_dur))
    } else {
        (filtered, None)
    }
}

fn get_image_files(folder: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let entries = match fs::read_dir(folder) {
        Ok(e) => e,
        Err(_) => return files,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = match path.extension() {
            Some(e) => format!(".{}", e.to_string_lossy().to_lowercase()),
            None => continue,
        };
        if IMAGE_EXTENSIONS.iter().any(|v| *v == ext) {
            files.push(path);
        }
    }
    files.sort_by_key(|p| {
        p.file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .unwrap_or_default()
    });
    files
}

fn limit_videos_by_duration(
    files: &[PathBuf],
    target_duration: Option<f64>,
    transition: &str,
    transition_duration: f64,
    speed: f64,
    root: &Path,
) -> Vec<PathBuf> {
    let Some(target) = target_duration else {
        return files.to_vec();
    };
    if target <= 0.0 {
        return files.to_vec();
    }

    let mut out = Vec::<PathBuf>::new();
    let overlap = if transition == "fade" {
        transition_duration.max(0.0)
    } else {
        0.0
    };
    let mut total = 0.0_f64;
    let speed_factor = if speed <= 0.0 { 1.0 } else { speed };

    for file in files {
        out.push(file.clone());
        let duration = match get_video_duration(file, root) {
            Some(d) if d > 0.0 => d / speed_factor,
            _ => continue,
        };
        if out.len() > 1 {
            total += duration - overlap;
        } else {
            total += duration;
        }
        if total >= target {
            break;
        }
    }

    out
}

fn limit_images_by_duration(
    files: &[PathBuf],
    target_duration: Option<f64>,
    image_duration: f64,
) -> Vec<PathBuf> {
    let Some(target) = target_duration else {
        return files.to_vec();
    };
    if target <= 0.0 || image_duration <= 0.0 {
        return files.to_vec();
    }
    let max_count = (target / image_duration).floor() as usize;
    if max_count == 0 {
        return files.iter().take(1).cloned().collect();
    }
    files.iter().take(max_count).cloned().collect()
}

fn is_video_file(path: &Path) -> bool {
    let ext = match path.extension() {
        Some(e) => format!(".{}", e.to_string_lossy().to_lowercase()),
        None => return false,
    };
    VIDEO_EXTENSIONS.iter().any(|v| *v == ext)
}

fn normalize_scene_threshold(value: f64) -> f64 {
    if value > 1.0 {
        (value / 100.0).clamp(0.01, 1.0)
    } else {
        value.clamp(0.01, 1.0)
    }
}

fn parse_pts_times(stderr_text: &str) -> Vec<f64> {
    let mut times = Vec::<f64>::new();
    for line in stderr_text.lines() {
        if let Some(idx) = line.find("pts_time:") {
            let rest = &line[idx + "pts_time:".len()..];
            let token = rest
                .split(|c: char| c.is_whitespace() || c == ',')
                .next()
                .unwrap_or("");
            if let Ok(v) = token.parse::<f64>() {
                if v.is_finite() && v > 0.0 {
                    times.push(v);
                }
            }
        }
    }
    times.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mut deduped = Vec::new();
    for t in times {
        if deduped
            .last()
            .map(|prev: &f64| (t - *prev).abs() > 0.05)
            .unwrap_or(true)
        {
            deduped.push(t);
        }
    }
    deduped
}

fn detect_scenes_ffmpeg(video: &Path, threshold: f64, root: &Path) -> Vec<(f64, f64)> {
    let duration = match get_video_duration(video, root) {
        Some(d) if d > 0.0 => d,
        _ => return Vec::new(),
    };

    let filter = format!("select='gt(scene,{threshold})',showinfo");
    let out = Command::new("ffmpeg")
        .arg("-i")
        .arg(video)
        .arg("-filter:v")
        .arg(filter)
        .arg("-an")
        .arg("-f")
        .arg("null")
        .arg("-")
        .current_dir(root)
        .output();

    let Ok(o) = out else {
        return Vec::new();
    };
    let stderr_text = String::from_utf8_lossy(&o.stderr);
    let cuts = parse_pts_times(&stderr_text);
    if cuts.is_empty() {
        return Vec::new();
    }

    let mut scenes = Vec::<(f64, f64)>::new();
    let mut start = 0.0_f64;
    for cut in cuts {
        if cut > start && cut < duration {
            scenes.push((start, cut));
            start = cut;
        }
    }
    if duration > start {
        scenes.push((start, duration));
    }
    scenes
}

fn split_video_into_scenes(
    video: &Path,
    scenes: &[(f64, f64)],
    output_dir: &Path,
    prefix: &str,
    root: &Path,
) -> bool {
    if scenes.is_empty() {
        return false;
    }
    let mut success = 0usize;
    for (i, (start, end)) in scenes.iter().enumerate() {
        let out_path = output_dir.join(format!("{prefix}-Scene-{:03}.mp4", i + 1));
        let status = Command::new("ffmpeg")
            .arg("-i")
            .arg(video)
            .arg("-ss")
            .arg(format!("{start:.6}"))
            .arg("-to")
            .arg(format!("{end:.6}"))
            .arg("-c:v")
            .arg("libx264")
            .arg("-preset")
            .arg("medium")
            .arg("-crf")
            .arg("23")
            .arg("-c:a")
            .arg("aac")
            .arg("-b:a")
            .arg("192k")
            .arg("-y")
            .arg(&out_path)
            .current_dir(root)
            .output();
        if matches!(status, Ok(s) if s.status.success())
            && fs::metadata(&out_path)
                .map(|m| m.len() > 0)
                .unwrap_or(false)
        {
            success += 1;
        }
    }
    success > 0
}

fn format_timecode(seconds: f64) -> String {
    let hours = (seconds / 3600.0).floor() as u64;
    let minutes = ((seconds % 3600.0) / 60.0).floor() as u64;
    let secs = seconds % 60.0;
    format!("{hours:02}:{minutes:02}:{secs:06.3}")
}

fn file_signature(path: &Path) -> Option<u64> {
    let mut file = fs::File::open(path).ok()?;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    let mut buf = [0_u8; 8192];
    loop {
        let read = file.read(&mut buf).ok()?;
        if read == 0 {
            break;
        }
        hasher.write(&buf[..read]);
    }
    Some(hasher.finish())
}

fn files_equal(a: &Path, b: &Path) -> bool {
    let ma = match fs::metadata(a) {
        Ok(m) => m,
        Err(_) => return false,
    };
    let mb = match fs::metadata(b) {
        Ok(m) => m,
        Err(_) => return false,
    };
    if ma.len() != mb.len() {
        return false;
    }

    let mut fa = match fs::File::open(a) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let mut fb = match fs::File::open(b) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let mut ba = [0_u8; 8192];
    let mut bb = [0_u8; 8192];
    loop {
        let ra = match fa.read(&mut ba) {
            Ok(v) => v,
            Err(_) => return false,
        };
        let rb = match fb.read(&mut bb) {
            Ok(v) => v,
            Err(_) => return false,
        };
        if ra != rb {
            return false;
        }
        if ra == 0 {
            break;
        }
        if ba[..ra] != bb[..rb] {
            return false;
        }
    }
    true
}

fn remove_duplicates(folder: &Path) -> usize {
    let files = get_video_files(folder);
    if files.is_empty() {
        return 0;
    }

    let mut groups: std::collections::HashMap<u64, Vec<PathBuf>> = std::collections::HashMap::new();
    for path in &files {
        if let Some(sig) = file_signature(path) {
            groups.entry(sig).or_default().push(path.clone());
        }
    }

    let mut removed = 0usize;
    let mut removed_bytes = 0u64;
    for mut group in groups.into_values() {
        if group.len() < 2 {
            continue;
        }
        group.sort_by_key(|p| {
            p.file_name()
                .map(|n| n.to_string_lossy().to_lowercase())
                .unwrap_or_default()
        });
        let keep = group[0].clone();
        for dup in group.into_iter().skip(1) {
            if !files_equal(&keep, &dup) {
                continue;
            }
            let size = fs::metadata(&dup).map(|m| m.len()).unwrap_or(0);
            if fs::remove_file(&dup).is_ok() {
                removed += 1;
                removed_bytes += size;
                println!("  removed duplicate: {}", dup.display());
            }
        }
    }
    if removed > 0 {
        println!("Freed {:.2} MB", removed_bytes as f64 / 1024.0 / 1024.0);
    }
    removed
}

fn format_mtime_filename(path: &Path) -> String {
    let fallback = "1970-01-01_00-00-00".to_string();
    let mtime = match fs::metadata(path).and_then(|m| m.modified()) {
        Ok(v) => v,
        Err(_) => return fallback,
    };
    let secs = match mtime.duration_since(UNIX_EPOCH) {
        Ok(v) => v.as_secs().to_string(),
        Err(_) => return fallback,
    };

    let out = Command::new("date")
        .arg("-r")
        .arg(&secs)
        .arg("+%Y-%m-%d_%H-%M-%S")
        .output();
    match out {
        Ok(o) if o.status.success() => {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if s.is_empty() {
                fallback
            } else {
                s
            }
        }
        _ => fallback,
    }
}

fn rename_by_date(folder: &Path, add_number: bool) -> usize {
    let mut files = get_video_files(folder);
    if files.is_empty() {
        return 0;
    }

    files.sort_by_key(|p| {
        p.file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .unwrap_or_default()
    });
    let num_digits = files.len().to_string().len();
    let mut renamed = 0usize;

    for (idx, video) in files.iter().enumerate() {
        let date_str = format_mtime_filename(video);
        let ext = video
            .extension()
            .map(|e| format!(".{}", e.to_string_lossy()))
            .unwrap_or_default();
        let base = if add_number {
            format!("{:0width$}_{}", idx + 1, date_str, width = num_digits)
        } else {
            date_str
        };
        let mut candidate = video
            .parent()
            .unwrap_or(folder)
            .join(format!("{base}{ext}"));
        let mut counter = 1usize;
        while candidate.exists() && candidate != *video {
            candidate = video
                .parent()
                .unwrap_or(folder)
                .join(format!("{base}_{counter:02}{ext}"));
            counter += 1;
        }

        if candidate == *video {
            continue;
        }
        if fs::rename(video, &candidate).is_ok() {
            renamed += 1;
            println!("  renamed: {} -> {}", video.display(), candidate.display());
        }
    }
    renamed
}

fn concat_simple_cut(files: &[PathBuf], output: &Path, root: &Path) -> bool {
    if files.is_empty() {
        return false;
    }

    let mut cmd = Command::new("ffmpeg");
    for f in files {
        cmd.arg("-i").arg(f);
    }
    let mut filter_parts: Vec<String> = Vec::new();
    let mut concat_inputs: Vec<String> = Vec::new();
    let target_dims = get_video_info(&files[0], root).map(|i| (i.width, i.height));
    for (i, f) in files.iter().enumerate() {
        if let Some((target_w, target_h)) = target_dims {
            filter_parts.push(format!(
                "[{i}:v]scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p,setpts=PTS-STARTPTS[v{i}]"
            ));
        } else {
            filter_parts.push(format!(
                "[{i}:v]fps=30,format=yuv420p,setpts=PTS-STARTPTS[v{i}]"
            ));
        }
        if has_audio_stream(f, root) {
            filter_parts.push(format!(
                "[{i}:a:0]aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a{i}]"
            ));
        } else {
            let dur = get_video_duration(f, root).unwrap_or(1.0);
            filter_parts.push(format!(
                "anullsrc=r=48000:cl=stereo:d={dur:.3},asetpts=PTS-STARTPTS[a{i}]"
            ));
        }
        concat_inputs.push(format!("[v{i}][a{i}]"));
    }
    filter_parts.push(format!(
        "{}concat=n={}:v=1:a=1[outv][outa]",
        concat_inputs.join(""),
        files.len()
    ));
    let filter_complex = filter_parts.join(";");

    let out = cmd
        .arg("-filter_complex")
        .arg(filter_complex)
        .arg("-map")
        .arg("[outv]")
        .arg("-map")
        .arg("[outa]")
        .arg("-c:v")
        .arg("libx264")
        .arg("-preset")
        .arg("medium")
        .arg("-crf")
        .arg("23")
        .arg("-c:a")
        .arg("aac")
        .arg("-b:a")
        .arg("192k")
        .arg("-pix_fmt")
        .arg("yuv420p")
        .arg("-y")
        .arg(output)
        .current_dir(root)
        .output();

    match out {
        Ok(out) if out.status.success() => true,
        Ok(out) => {
            if !out.stderr.is_empty() {
                eprintln!("ffmpeg failed creating concatenated output:");
                eprintln!("{}", String::from_utf8_lossy(&out.stderr));
            }
            false
        }
        Err(err) => {
            eprintln!("error running ffmpeg for concatenated output: {err}");
            false
        }
    }
}

fn concat_with_transitions(
    files: &[PathBuf],
    output: &Path,
    transition: &str,
    duration: f64,
    root: &Path,
) -> bool {
    if files.len() < 2 {
        return concat_simple_cut(files, output, root);
    }

    let mut infos = Vec::new();
    for file in files {
        let mut info = match get_video_info(file, root) {
            Some(i) => i,
            None => {
                eprintln!("error: could not read video info for {}", file.display());
                return false;
            }
        };
        info.has_audio = has_audio_stream(file, root);
        info.video_stream_index = get_primary_video_stream_index(file, root);
        infos.push(info);
    }

    let width = infos[0].width;
    let height = infos[0].height;
    let mut use_duration = duration;
    let min_duration = infos
        .iter()
        .map(|i| i.duration)
        .fold(f64::INFINITY, f64::min);
    let max_transition = (min_duration - 0.05).max(0.01);
    if use_duration > max_transition {
        use_duration = max_transition;
    }

    let filter = if transition == "dissolve" || transition == "fade" {
        build_xfade_filter(&infos, use_duration, width, height)
    } else {
        build_fadeblack_filter(&infos, use_duration, width, height)
    };

    let mut cmd = Command::new("ffmpeg");
    for file in files {
        cmd.arg("-i").arg(file);
    }
    cmd.arg("-filter_complex")
        .arg(filter)
        .arg("-map")
        .arg("[outv]")
        .arg("-map")
        .arg("[outa]")
        .arg("-c:v")
        .arg("libx264")
        .arg("-pix_fmt")
        .arg("yuv420p")
        .arg("-preset")
        .arg("medium")
        .arg("-crf")
        .arg("23")
        .arg("-c:a")
        .arg("aac")
        .arg("-b:a")
        .arg("192k")
        .arg("-movflags")
        .arg("+faststart")
        .arg("-y")
        .arg(output)
        .current_dir(root);

    match cmd.output() {
        Ok(out) if out.status.success() => true,
        Ok(out) => {
            if !out.stderr.is_empty() {
                eprintln!("{}", String::from_utf8_lossy(&out.stderr));
            }
            false
        }
        Err(err) => {
            eprintln!("error running ffmpeg: {err}");
            false
        }
    }
}

fn build_xfade_filter(infos: &[ClipInfo], duration: f64, width: u32, height: u32) -> String {
    let mut parts: Vec<String> = Vec::new();

    for (i, info) in infos.iter().enumerate() {
        // Since files are pre-normalized, we just need to ensure timebase and PTS are reset
        // Adding 'fifo' is critical to prevent the transition from freezing during processing
        parts.push(format!(
            "[{i}:v:0]settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p,fifo[v{i}]"
        ));

        if info.has_audio {
            // Force audio duration to match video duration exactly to prevent sync drift in transitions
            parts.push(format!(
                "[{i}:a:0]aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS,atrim=duration={:.3},afifo[a{i}]",
                info.duration
            ));
        } else {
            parts.push(format!(
                "anullsrc=r=48000:cl=stereo:d={:.3},asetpts=PTS-STARTPTS,afifo[a{i}]",
                info.duration
            ));
        }
    }

    let mut offsets: Vec<f64> = vec![0.0];
    let mut current_offset = 0.0;
    for info in infos.iter().take(infos.len() - 1) {
        current_offset += info.duration - duration;
        offsets.push(current_offset);
    }

    let mut current_v = "v0".to_string();
    let mut current_a = "a0".to_string();

    for i in 1..infos.len() {
        let next_v = if i < infos.len() - 1 {
            format!("v{i}{i}")
        } else {
            "outv".to_string()
        };
        let next_a = if i < infos.len() - 1 {
            format!("a{i}{i}")
        } else {
            "outa".to_string()
        };

        // Use the specified transition (defaulting to fade for xfade if not 'dissolve')
        parts.push(format!(
            "[{current_v}][v{i}]xfade=transition=fade:duration={duration}:offset={:.3}[{next_v}]",
            offsets[i]
        ));
        
        // Ensure audio fades are consistent
        parts.push(format!(
            "[{current_a}][a{i}]acrossfade=d={duration}:curve1=exp:curve2=exp[{next_a}]"
        ));

        current_v = next_v;
        current_a = next_a;
    }

    parts.join(";")
}

fn build_fadeblack_filter(infos: &[ClipInfo], duration: f64, width: u32, height: u32) -> String {
    let fade_time = duration / 2.0;
    let mut parts: Vec<String> = Vec::new();
    let mut concat_inputs: Vec<String> = Vec::new();

    for (i, info) in infos.iter().enumerate() {
        let st = (info.duration - fade_time).max(0.0);

        if i == 0 {
            parts.push(format!(
                "[{i}:v:{}]scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p,setpts=PTS-STARTPTS,fade=t=out:st={st:.3}:d={fade_time:.3}[v{i}]",
                info.video_stream_index
            ));
            if info.has_audio {
                parts.push(format!(
                    "[{i}:a:0]aformat=sample_rates=48000:channel_layouts=stereo,aresample=48000,asetpts=PTS-STARTPTS,afade=t=out:st={st:.3}:d={fade_time:.3}[a{i}]"
                ));
            } else {
                parts.push(format!(
                    "anullsrc=r=48000:cl=stereo:d={:.3},asetpts=PTS-STARTPTS,afade=t=out:st={st:.3}:d={fade_time:.3}[a{i}]",
                    info.duration
                ));
            }
        } else if i == infos.len() - 1 {
            parts.push(format!(
                "[{i}:v:{}]scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p,setpts=PTS-STARTPTS,fade=t=in:st=0:d={fade_time:.3}[v{i}]",
                info.video_stream_index
            ));
            if info.has_audio {
                parts.push(format!(
                    "[{i}:a:0]aformat=sample_rates=48000:channel_layouts=stereo,aresample=48000,asetpts=PTS-STARTPTS,afade=t=in:st=0:d={fade_time:.3}[a{i}]"
                ));
            } else {
                parts.push(format!(
                    "anullsrc=r=48000:cl=stereo:d={:.3},asetpts=PTS-STARTPTS,afade=t=in:st=0:d={fade_time:.3}[a{i}]",
                    info.duration
                ));
            }
        } else {
            parts.push(format!(
                "[{i}:v:{}]scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p,setpts=PTS-STARTPTS,fade=t=in:st=0:d={fade_time:.3},fade=t=out:st={st:.3}:d={fade_time:.3}[v{i}]",
                info.video_stream_index
            ));
            if info.has_audio {
                parts.push(format!(
                    "[{i}:a:0]aformat=sample_rates=48000:channel_layouts=stereo,aresample=48000,asetpts=PTS-STARTPTS,afade=t=in:st=0:d={fade_time:.3},afade=t=out:st={st:.3}:d={fade_time:.3}[a{i}]"
                ));
            } else {
                parts.push(format!(
                    "anullsrc=r=48000:cl=stereo:d={:.3},asetpts=PTS-STARTPTS,afade=t=in:st=0:d={fade_time:.3},afade=t=out:st={st:.3}:d={fade_time:.3}[a{i}]",
                    info.duration
                ));
            }
        }

        concat_inputs.push(format!("[v{i}][a{i}]"));
    }

    parts.push(format!(
        "{}concat=n={}:v=1:a=1[outv][outa]",
        concat_inputs.join(""),
        infos.len()
    ));

    parts.join(";")
}

fn get_video_info(path: &Path, root: &Path) -> Option<ClipInfo> {
    let out = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height,duration",
            "-of",
            "default=noprint_wrappers=1",
        ])
        .arg(path)
        .current_dir(root)
        .output()
        .ok()?;

    if !out.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&out.stdout);
    let mut duration = 0.0_f64;
    let mut width = 0_u32;
    let mut height = 0_u32;

    for line in text.lines() {
        if let Some(value) = line.strip_prefix("duration=") {
            duration = value.parse::<f64>().unwrap_or(0.0);
        } else if let Some(value) = line.strip_prefix("width=") {
            width = value.parse::<u32>().unwrap_or(0);
        } else if let Some(value) = line.strip_prefix("height=") {
            height = value.parse::<u32>().unwrap_or(0);
        }
    }

    // Fall back to container/format duration if the video stream does not
    // report its own duration (e.g. some MPEG-TS or raw-stream files).
    if duration <= 0.0 {
        duration = get_video_duration(path, root).unwrap_or(0.0);
    }

    if width == 0 || height == 0 {
        return None;
    }

    Some(ClipInfo {
        duration,
        width,
        height,
        has_audio: false,
        video_stream_index: 0,
    })
}

fn get_video_duration(path: &Path, root: &Path) -> Option<f64> {
    let out = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
        ])
        .arg(path)
        .current_dir(root)
        .output()
        .ok()?;

    if !out.status.success() {
        return None;
    }
    String::from_utf8_lossy(&out.stdout)
        .trim()
        .parse::<f64>()
        .ok()
}

fn build_no_audio_output_path(base_dir: &Path, input: &Path) -> PathBuf {
    let stem = input
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "output".to_string());
    let ext = input
        .extension()
        .map(|s| format!(".{}", s.to_string_lossy()))
        .unwrap_or_else(|| ".mp4".to_string());
    base_dir.join(format!("{stem}_noaudio{ext}"))
}

fn strip_audio_video(input: &Path, output: &Path, root: &Path) -> bool {
    let out = Command::new("ffmpeg")
        .args(["-i"])
        .arg(input)
        .args(["-c:v", "copy", "-an", "-y"])
        .arg(output)
        .current_dir(root)
        .output();

    match out {
        Ok(o) if o.status.success() => true,
        _ => {
            let fallback = Command::new("ffmpeg")
                .args(["-i"])
                .arg(input)
                .args([
                    "-c:v",
                    "libx264",
                    "-preset",
                    "medium",
                    "-crf",
                    "23",
                    "-pix_fmt",
                    "yuv420p",
                    "-an",
                    "-movflags",
                    "+faststart",
                    "-y",
                ])
                .arg(output)
                .current_dir(root)
                .output();
            match fallback {
                Ok(o) if o.status.success() => true,
                Ok(o) => {
                    if !o.stderr.is_empty() {
                        eprintln!("{}", String::from_utf8_lossy(&o.stderr));
                    }
                    false
                }
                Err(err) => {
                    eprintln!("error running ffmpeg: {err}");
                    false
                }
            }
        }
    }
}

fn trim_video(input: &Path, output: &Path, trim_start: f64, trim_end: f64, no_audio: bool, root: &Path) -> bool {
    let duration = match get_video_duration(input, root) {
        Some(d) => d,
        None => return false,
    };
    let new_duration = duration - trim_start - trim_end;
    if new_duration <= 0.0 {
        return false;
    }

    let mut pipeline = FFmpegPipeline::new(root);
    
    // Build the command using the contract
    pipeline.cmd.arg("-i").arg(input);
    pipeline.cmd.arg("-ss").arg(format!("{trim_start:.3}"));
    pipeline.cmd.arg("-t").arg(format!("{new_duration:.3}"));
    
    pipeline.apply_canonical_video_params();
    pipeline.apply_canonical_audio_params(!no_audio);
    
    pipeline.run(output)
}

fn detect_split_tiles(video: &Path, root: &Path, info: &ClipInfo) -> Option<Vec<TileRect>> {
    if info.width == 0 || info.height == 0 {
        return None;
    }
    let sample_w = 120usize;
    let mut sample_h = ((info.height as f64 / info.width as f64) * sample_w as f64)
        .round()
        .max(1.0) as usize;
    if sample_h < 60 {
        sample_h = 60;
    }
    if sample_h > 120 {
        sample_h = 120;
    }

    let ts = if info.duration > 0.5 {
        info.duration * 0.5
    } else {
        0.0
    };
    let frame = extract_gray_frame(video, root, sample_w, sample_h, ts)?;
    let (v_lines, h_lines) = find_separator_lines(&frame, sample_w, sample_h);
    let tiles = build_tile_rects(
        info.width,
        info.height,
        sample_w as u32,
        sample_h as u32,
        v_lines,
        h_lines,
    );
    Some(tiles)
}

fn extract_gray_frame(
    video: &Path,
    root: &Path,
    width: usize,
    height: usize,
    ts: f64,
) -> Option<Vec<u8>> {
    let out = Command::new("ffmpeg")
        .args(["-v", "error", "-ss", &format!("{ts}")])
        .arg("-i")
        .arg(video)
        .args([
            "-frames:v",
            "1",
            "-vf",
            &format!("scale={width}:{height}:flags=area,format=gray"),
            "-f",
            "rawvideo",
            "-",
        ])
        .current_dir(root)
        .output()
        .ok()?;

    if !out.status.success() {
        return None;
    }
    let expected = width * height;
    if out.stdout.len() < expected {
        return None;
    }
    Some(out.stdout[..expected].to_vec())
}

fn find_separator_lines(gray: &[u8], w: usize, h: usize) -> (Vec<usize>, Vec<usize>) {
    let mut col_var = vec![0.0_f64; w];
    let mut row_var = vec![0.0_f64; h];

    for x in 0..w {
        let mut sum = 0.0_f64;
        let mut sumsq = 0.0_f64;
        for y in 0..h {
            let v = gray[y * w + x] as f64;
            sum += v;
            sumsq += v * v;
        }
        let mean = sum / h as f64;
        col_var[x] = (sumsq / h as f64) - (mean * mean);
    }

    for y in 0..h {
        let mut sum = 0.0_f64;
        let mut sumsq = 0.0_f64;
        let row_start = y * w;
        for x in 0..w {
            let v = gray[row_start + x] as f64;
            sum += v;
            sumsq += v * v;
        }
        let mean = sum / w as f64;
        row_var[y] = (sumsq / w as f64) - (mean * mean);
    }

    let v_lines = pick_separator_lines(&col_var, 2);
    let h_lines = pick_separator_lines(&row_var, 2);
    (v_lines, h_lines)
}

fn pick_separator_lines(values: &[f64], min_span: usize) -> Vec<usize> {
    if values.is_empty() {
        return Vec::new();
    }
    let mut min_val = f64::INFINITY;
    let mut sum = 0.0_f64;
    for &v in values {
        if v < min_val {
            min_val = v;
        }
        sum += v;
    }
    let avg = sum / values.len() as f64;
    let threshold = min_val + (avg - min_val) * 0.15;

    let mut lines = Vec::new();
    let mut start: Option<usize> = None;
    for (i, &v) in values.iter().enumerate() {
        if v <= threshold {
            if start.is_none() {
                start = Some(i);
            }
        } else if let Some(s) = start.take() {
            let e = i.saturating_sub(1);
            if e + 1 >= s + min_span {
                lines.push((s + e) / 2);
            }
        }
    }
    if let Some(s) = start.take() {
        let e = values.len().saturating_sub(1);
        if e + 1 >= s + min_span {
            lines.push((s + e) / 2);
        }
    }

    let mut filtered: Vec<usize> = lines
        .into_iter()
        .filter(|&i| i > 1 && i + 2 < values.len())
        .collect();
    filtered.sort_unstable();
    if filtered.len() > 4 {
        filtered.truncate(4);
    }
    filtered
}

fn build_tile_rects(
    orig_w: u32,
    orig_h: u32,
    sample_w: u32,
    sample_h: u32,
    v_lines: Vec<usize>,
    h_lines: Vec<usize>,
) -> Vec<TileRect> {
    let xs = build_split_positions(sample_w as usize, v_lines, 8)
        .into_iter()
        .map(|v| map_pos(v, sample_w, orig_w))
        .collect::<Vec<u32>>();
    let ys = build_split_positions(sample_h as usize, h_lines, 8)
        .into_iter()
        .map(|v| map_pos(v, sample_h, orig_h))
        .collect::<Vec<u32>>();

    let mut tiles = Vec::new();
    for y_idx in 0..ys.len().saturating_sub(1) {
        for x_idx in 0..xs.len().saturating_sub(1) {
            let mut x0 = xs[x_idx];
            let mut y0 = ys[y_idx];
            let mut x1 = xs[x_idx + 1];
            let mut y1 = ys[y_idx + 1];

            if x_idx + 1 == xs.len() - 1 {
                x1 = orig_w;
            }
            if y_idx + 1 == ys.len() - 1 {
                y1 = orig_h;
            }

            x0 = make_even(x0);
            y0 = make_even(y0);
            x1 = make_even(x1);
            y1 = make_even(y1);

            if x1 <= x0 || y1 <= y0 {
                continue;
            }
            let w = x1 - x0;
            let h = y1 - y0;
            if w < 16 || h < 16 {
                continue;
            }
            tiles.push(TileRect { x: x0, y: y0, w, h });
        }
    }

    if tiles.is_empty() {
        tiles.push(TileRect {
            x: 0,
            y: 0,
            w: make_even(orig_w),
            h: make_even(orig_h),
        });
    }
    tiles
}

fn build_split_positions(size: usize, lines: Vec<usize>, min_size: usize) -> Vec<u32> {
    let mut sorted = lines;
    sorted.sort_unstable();
    let mut splits = Vec::new();
    let mut last = 0usize;
    splits.push(0u32);
    for line in sorted {
        if line <= last + min_size {
            continue;
        }
        if size <= line + min_size {
            continue;
        }
        splits.push(line as u32);
        last = line;
    }
    splits.push(size as u32);
    splits
}

fn map_pos(pos: u32, sample: u32, orig: u32) -> u32 {
    if sample == 0 {
        return 0;
    }
    let scaled = (pos as f64 / sample as f64) * orig as f64;
    let mut out = scaled.round() as u32;
    if out > orig {
        out = orig;
    }
    out
}

fn make_even(value: u32) -> u32 {
    if value % 2 == 0 {
        value
    } else {
        value.saturating_sub(1)
    }
}

fn build_forced_two_panel_tiles(width: u32, height: u32) -> Vec<TileRect> {
    let mut left_w = make_even(width / 2);
    if left_w == 0 {
        left_w = make_even(width);
    }
    let mut right_w = width.saturating_sub(left_w);
    right_w = make_even(right_w);
    if right_w == 0 {
        right_w = make_even(width.saturating_sub(left_w));
    }
    let h = make_even(height);
    let right_x = width.saturating_sub(right_w);
    vec![
        TileRect {
            x: 0,
            y: 0,
            w: left_w,
            h,
        },
        TileRect {
            x: right_x,
            y: 0,
            w: right_w,
            h,
        },
    ]
}

fn crop_video_to_tile(
    input: &Path,
    output: &Path,
    tile: &TileRect,
    root: &Path,
    quality: &str,
    duration: f64,
    clip_seconds: Option<f64>,
    fast_preview: bool,
) -> bool {
    let (crf, preset, fps, max_width) = if fast_preview {
        (38, "ultrafast", Some(12u32), Some(640u32))
    } else {
        let (crf, preset) = quality_profile(quality);
        (crf, preset, None, None)
    };
    let effective_duration = clip_seconds
        .filter(|v| *v > 0.0)
        .map(|v| v.min(duration))
        .unwrap_or(duration);
    let mut filter = format!("crop={}:{}:{}:{}", tile.w, tile.h, tile.x, tile.y);
    if let Some(max_w) = max_width {
        filter = format!("{filter},scale='min({max_w},iw)':-2");
    }
    if let Some(fps) = fps {
        filter = format!("{filter},fps={fps}");
    }
    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-i").arg(input);
    if let Some(limit) = clip_seconds.filter(|v| *v > 0.0) {
        cmd.args(["-t", &format!("{limit}")]);
    }
    let mut child = match cmd
        .args(["-vf", &filter])
        .args(["-map", "0:v:0", "-map", "0:a?"])
        .args([
            "-c:v",
            "libx264",
            "-preset",
            preset,
            "-crf",
            &crf.to_string(),
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            "-y",
            "-progress",
            "pipe:1",
            "-nostats",
        ])
        .arg(output)
        .current_dir(root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(err) => {
            eprintln!("error running ffmpeg: {err}");
            return false;
        }
    };

    let mut last_percent = 0u32;
    let mut stderr = String::new();
    if let Some(stdout) = child.stdout.take() {
        let reader = io::BufReader::new(stdout);
        for line in reader.lines().flatten() {
            if let Some(value) = line.strip_prefix("out_time_ms=") {
                if effective_duration > 0.1 {
                    let out_ms = value.trim().parse::<u64>().unwrap_or(0);
                    let pct = ((out_ms as f64 / (effective_duration * 1_000_000.0)) * 100.0)
                        .min(100.0)
                        .max(0.0)
                        .round() as u32;
                    if pct >= last_percent + 5 {
                        last_percent = pct;
                        println!("  encoding... {pct}%");
                    }
                }
            }
        }
    }
    if let Some(err) = child.stderr.take() {
        let mut reader = io::BufReader::new(err);
        let _ = reader.read_to_string(&mut stderr);
    }

    match child.wait() {
        Ok(status) if status.success() => true,
        Ok(_) => {
            if !stderr.is_empty() {
                eprintln!("{}", stderr);
            }
            false
        }
        Err(err) => {
            eprintln!("error running ffmpeg: {err}");
            false
        }
    }
}

fn quality_profile(quality: &str) -> (u32, &str) {
    match quality {
        "low" => (35, "veryfast"),
        "high" => (23, "medium"),
        "ultra" => (18, "slow"),
        _ => (28, "fast"),
    }
}

fn check_yt_dlp(root: &Path) -> bool {
    Command::new("yt-dlp")
        .arg("--version")
        .current_dir(root)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn yt_dlp_video_id(root: &Path, url: &str) -> Option<String> {
    let out = Command::new("yt-dlp")
        .args(["--no-playlist", "--print", "id"])
        .arg(url)
        .current_dir(root)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let id = String::from_utf8_lossy(&out.stdout)
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    if id.is_empty() {
        None
    } else {
        Some(id)
    }
}

fn yt_dlp_download(
    root: &Path,
    url: &str,
    output_template: &str,
    cookies_from_browser: Option<&str>,
    cookies_file: Option<&str>,
) -> bool {
    let mut cmd = Command::new("yt-dlp");
    cmd.args([
        "--no-playlist",
        "-f",
        "bv*+ba/b",
        "--write-auto-sub",
        "--write-sub",
        "--sub-lang",
        "en.*",
        "--sub-format",
        "json3",
        "-o",
        output_template,
    ]);
    if let Some(browser) = cookies_from_browser {
        cmd.args(["--cookies-from-browser", browser]);
    }
    if let Some(file) = cookies_file {
        cmd.args(["--cookies", file]);
    }
    let out = cmd.arg(url).current_dir(root).output();

    match out {
        Ok(o) if o.status.success() => true,
        Ok(o) => {
            if !o.stderr.is_empty() {
                eprintln!("{}", String::from_utf8_lossy(&o.stderr));
            }
            false
        }
        Err(err) => {
            eprintln!("error running yt-dlp: {err}");
            false
        }
    }
}

fn has_audio_stream(path: &Path, root: &Path) -> bool {
    let out = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=index",
            "-of",
            "csv=p=0",
        ])
        .arg(path)
        .current_dir(root)
        .output();

    match out {
        Ok(o) if o.status.success() => !String::from_utf8_lossy(&o.stdout).trim().is_empty(),
        _ => false,
    }
}

fn get_primary_video_stream_index(path: &Path, root: &Path) -> u32 {
    let out = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "v",
            "-show_entries",
            "stream=index:stream_disposition=attached_pic",
            "-of",
            "default=noprint_wrappers=1",
        ])
        .arg(path)
        .current_dir(root)
        .output();

    let Ok(o) = out else {
        return 0;
    };
    if !o.status.success() {
        return 0;
    }

    let text = String::from_utf8_lossy(&o.stdout);
    let mut first_index: Option<u32> = None;
    let mut current_index: Option<u32> = None;

    for line in text.lines() {
        if let Some(val) = line.strip_prefix("index=") {
            let idx = val.parse::<u32>().unwrap_or(0);
            if first_index.is_none() {
                first_index = Some(idx);
            }
            current_index = Some(idx);
        } else if let Some(val) = line.strip_prefix("DISPOSITION:attached_pic=") {
            let attached = val.parse::<u32>().unwrap_or(0);
            if attached == 0 {
                if let Some(idx) = current_index {
                    return idx;
                }
            }
        }
    }

    first_index.unwrap_or(0)
}

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
        let has_rust_markers = cur
            .join("apps")
            .join("tiles-tui")
            .join("Cargo.toml")
            .exists()
            && cur.join("src").is_dir();
        if has_rust_markers {
            return Some(cur);
        }
        if !cur.pop() {
            return None;
        }
    }
}
