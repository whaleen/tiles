use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};
use std::{fs, io};

use crate::models::{ActionRunRequest, ActionRunResult};

pub fn run_action(
    root: &Path,
    tiles_bin: &Path,
    req: &ActionRunRequest,
) -> Result<ActionRunResult, io::Error> {
    if req.action == "transcribe" {
        return run_transcribe(root, req);
    }
    let args = build_args(req);
    let (exit_code, output, log_path) = run_subcommand(root, tiles_bin, &req.action, &args)?;
    Ok(ActionRunResult {
        exit_code,
        output,
        log_file: log_path.display().to_string(),
    })
}

fn build_args(req: &ActionRunRequest) -> Vec<OsString> {
    let mut args: Vec<OsString> = Vec::new();

    // Add targets
    for target in &req.targets {
        args.push(OsString::from(normalize_target(target)));
    }

    // Add output mode
    match req.output_mode.as_str() {
        "overwrite" => {
            if action_supports_overwrite(&req.action) {
                args.push("--overwrite".into());
            }
        }
        "alongside" => {
            if req.target_type != "settings" && action_supports_output(&req.action) {
                args.push("--output".into());
                args.push("__alongside__".into());
            }
        }
        "global" => {
            if req.target_type != "settings" && action_supports_output(&req.action) {
                args.push("--output".into());
                args.push(format!("outputs/{}", req.action).into());
            }
        }
        "custom" => {
            if let Some(v) = req.params.get("output").and_then(|v| v.as_str()) {
                if !v.is_empty() {
                    if action_supports_output(&req.action) {
                        args.push("--output".into());
                        args.push(v.into());
                    }
                }
            }
        }
        "project" => {
            if let Some(v) = req.params.get("output").and_then(|v| v.as_str()) {
                if !v.is_empty() {
                    if action_supports_output(&req.action) {
                        args.push("--output".into());
                        args.push(v.into());
                    }
                }
            }
        }
        _ => {
            // "source" mode - prefer per-project outputs when possible
            if action_supports_output(&req.action) {
                if req.target_type != "settings" {
                    if let Some(output) = project_output_dir(req) {
                        args.push("--output".into());
                        args.push(output.into());
                    } else {
                        args.push("--output".into());
                        args.push("__source_outputs__".into());
                    }
                }
            }
        }
    }

    // Add action-specific params
    let params = &req.params;
    match req.action.as_str() {
        "concat" => {
            if let Some(v) = params.get("transition").and_then(|v| v.as_str()) {
                if !v.is_empty() {
                    args.push("--transition".into());
                    args.push(v.into());
                }
            }
            if let Some(v) = params.get("duration").and_then(|v| v.as_f64()) {
                args.push("--duration".into());
                args.push(format!("{v}").into());
            }
        }
        "trim" => {
            if let Some(v) = params.get("trim_start").and_then(|v| v.as_f64()) {
                args.push("--start".into());
                args.push(format!("{v}").into());
            }
            if let Some(v) = params.get("trim_end").and_then(|v| v.as_f64()) {
                args.push("--end".into());
                args.push(format!("{v}").into());
            }
        }
        "detect" => {
            if let Some(v) = params.get("threshold").and_then(|v| v.as_f64()) {
                args.push("--threshold".into());
                args.push(format!("{v}").into());
            }
            if let Some(v) = params.get("method").and_then(|v| v.as_str()) {
                if !v.is_empty() {
                    args.push("--method".into());
                    args.push(v.into());
                }
            }
            if params
                .get("list_only")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                args.push("--list-only".into());
            }
        }
        "split-detect" => {
            if params
                .get("force_two_panel")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                args.push("--force-2x1".into());
            }
            if let Some(v) = params.get("quality").and_then(|v| v.as_str()) {
                if !v.is_empty() {
                    args.push("--quality".into());
                    args.push(v.into());
                }
            }
            if let Some(v) = params.get("clip_seconds").and_then(|v| v.as_f64()) {
                if v > 0.0 {
                    args.push("--clip-seconds".into());
                    args.push(format!("{v}").into());
                }
            }
            if params
                .get("fast_preview")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                args.push("--fast-preview".into());
            }
        }
        "yt-import" => {
            if params
                .get("force_two_panel")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                args.push("--force-2x1".into());
            }
            if let Some(v) = params.get("quality").and_then(|v| v.as_str()) {
                if !v.is_empty() {
                    args.push("--quality".into());
                    args.push(v.into());
                }
            }
            if let Some(v) = params.get("clip_seconds").and_then(|v| v.as_f64()) {
                if v > 0.0 {
                    args.push("--clip-seconds".into());
                    args.push(format!("{v}").into());
                }
            }
            if params
                .get("fast_preview")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                args.push("--fast-preview".into());
            }
            if let Some(v) = params.get("cookies_from_browser").and_then(|v| v.as_str()) {
                if !v.is_empty() {
                    args.push("--cookies-from-browser".into());
                    args.push(v.into());
                }
            }
            if let Some(v) = params.get("cookies_file").and_then(|v| v.as_str()) {
                if !v.is_empty() {
                    args.push("--cookies".into());
                    args.push(v.into());
                }
            }
        }
        "tile" | "run" => {
            if let Some(v) = params.get("settings_path").and_then(|v| v.as_str()) {
                if !v.is_empty() {
                    args.push("--settings".into());
                    args.push(v.into());
                }
            }
            if let Some(v) = params.get("render_mode").and_then(|v| v.as_str()) {
                if !v.is_empty() {
                    args.push("--render-mode".into());
                    args.push(v.into());
                }
            }
        }
        "clean" => {
            if let Some(v) = params.get("mode").and_then(|v| v.as_str()) {
                if !v.is_empty() {
                    args.push("--mode".into());
                    args.push(v.into());
                }
            }
            if params
                .get("add_number")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                args.push("--add-number".into());
            }
        }
        "slowmo" => {
            if let Some(v) = params.get("factor").and_then(|v| v.as_f64()) {
                args.push("--factor".into());
                args.push(format!("{v}").into());
            }
        }
        "doctor-reencode" => {
            if let Some(v) = params.get("fps").and_then(|v| v.as_u64()) {
                args.push("--fps".into());
                args.push(format!("{v}").into());
            }
        }
        "doctor-trim-start" => {
            if let Some(v) = params.get("seconds").and_then(|v| v.as_f64()) {
                args.push("--seconds".into());
                args.push(format!("{v}").into());
            }
        }
        "loop" => {
            if let Some(v) = params.get("count").and_then(|v| v.as_u64()) {
                args.push("--count".into());
                args.push(format!("{v}").into());
            }
            if let Some(v) = params.get("transition").and_then(|v| v.as_str()) {
                if !v.is_empty() {
                    args.push("--transition".into());
                    args.push(v.into());
                }
            }
            if let Some(v) = params.get("duration").and_then(|v| v.as_f64()) {
                args.push("--duration".into());
                args.push(format!("{v}").into());
            }
        }
        "chop" => {
            if let Some(v) = params.get("duration").and_then(|v| v.as_f64()) {
                args.push("--duration".into());
                args.push(format!("{v}").into());
            }
            if let Some(v) = params.get("count").and_then(|v| v.as_u64()) {
                args.push("--count".into());
                args.push(format!("{v}").into());
            }
        }
        "crop" => {
            if let Some(v) = params.get("x").and_then(|v| v.as_u64()) {
                args.push("--x".into());
                args.push(format!("{v}").into());
            }
            if let Some(v) = params.get("y").and_then(|v| v.as_u64()) {
                args.push("--y".into());
                args.push(format!("{v}").into());
            }
            if let Some(v) = params.get("w").and_then(|v| v.as_u64()) {
                args.push("--w".into());
                args.push(format!("{v}").into());
            }
            if let Some(v) = params.get("h").and_then(|v| v.as_u64()) {
                args.push("--h".into());
                args.push(format!("{v}").into());
            }
        }
        _ => {}
    }

    // Generic flags (after action-specific params)
    if params
        .get("no_audio")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        args.push("--no-audio".into());
    }
    if params
        .get("no_overwrite")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        args.push("--no-overwrite".into());
    }
    if params
        .get("force_cfr")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        args.push("--force-cfr".into());
    }

    args
}

fn action_supports_output(action: &str) -> bool {
    matches!(
        action,
        "concat"
            | "trim"
            | "detect"
            | "split-detect"
            | "yt-import"
            | "strip-audio"
            | "transcribe"
            | "slowmo"
            | "loop"
            | "doctor-reencode"
            | "doctor-trim-start"
            | "chop"
            | "crop"
            | "tile"
            | "run"
    )
}

fn action_supports_overwrite(action: &str) -> bool {
    matches!(
        action,
        "trim" | "strip-audio" | "chop" | "crop" | "slowmo" | "doctor-reencode" | "doctor-trim-start"
    )
}

fn run_transcribe(root: &Path, req: &ActionRunRequest) -> Result<ActionRunResult, io::Error> {
    let log_dir = root.join("outputs").join("tui-logs");
    let _ = fs::create_dir_all(&log_dir);
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let log_path = log_dir.join(format!("studio_transcribe_run_{ts}.log"));

    let model = resolve_whisper_model(root, req)?;

    let output_dir = match resolve_transcribe_output_dir(root, req) {
        Some(dir) => dir,
        None => {
            let msg = "invalid output configuration".to_string();
            let _ = fs::write(&log_path, &msg);
            return Ok(ActionRunResult {
                exit_code: 1,
                output: msg,
                log_file: log_path.display().to_string(),
            });
        }
    };

    let inputs = collect_transcribe_targets(root, &req.targets);
    if inputs.is_empty() {
        let msg = "no input videos found".to_string();
        let _ = fs::write(&log_path, &msg);
        return Ok(ActionRunResult {
            exit_code: 1,
            output: msg,
            log_file: log_path.display().to_string(),
        });
    }

    let format = req
        .params
        .get("format")
        .and_then(|v| v.as_str())
        .unwrap_or("text")
        .to_lowercase();
    let ext = match format.as_str() {
        "srt" => "srt",
        "json" => "json",
        _ => "txt",
    };

    let language = req
        .params
        .get("language")
        .and_then(|v| v.as_str())
        .unwrap_or("auto")
        .trim();
    let queue = req.params.get("queue").and_then(|v| v.as_f64());
    let use_gpu = req.params.get("use_gpu").and_then(|v| v.as_bool());
    let gpu_device = req.params.get("gpu_device").and_then(|v| v.as_u64());
    let max_len = req.params.get("max_len").and_then(|v| v.as_u64());
    let vad_model = req.params.get("vad_model").and_then(|v| v.as_str());
    let vad_threshold = req.params.get("vad_threshold").and_then(|v| v.as_f64());
    let vad_min_speech = req
        .params
        .get("vad_min_speech_duration")
        .and_then(|v| v.as_f64());
    let vad_min_silence = req
        .params
        .get("vad_min_silence_duration")
        .and_then(|v| v.as_f64());

    let mut combined = String::new();
    let mut exit_code = 0;
    for input in inputs {
        let output = build_transcribe_output_path(&output_dir, root, &input, ext);
        if let Some(parent) = output.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let filter = build_whisper_filter(
            model.to_string_lossy().as_ref(),
            language,
            queue,
            use_gpu,
            gpu_device,
            &output,
            &format,
            max_len,
            vad_model,
            vad_threshold,
            vad_min_speech,
            vad_min_silence,
        );

        let mut cmd = Command::new("ffmpeg");
        cmd.arg("-hide_banner");
        cmd.arg("-i");
        cmd.arg(&input);
        cmd.arg("-vn");
        cmd.arg("-af");
        cmd.arg(&filter);
        cmd.arg("-f");
        cmd.arg("null");
        cmd.arg("-");
        cmd.current_dir(root);
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        combined.push_str(&format!(
            "$ ffmpeg -i {} -vn -af \"{}\" -f null -\n\n",
            input.display(),
            filter
        ));

        match cmd.output() {
            Ok(out) => {
                if !out.stdout.is_empty() {
                    combined.push_str(&String::from_utf8_lossy(&out.stdout));
                }
                if !out.stderr.is_empty() {
                    if !combined.ends_with('\n') {
                        combined.push('\n');
                    }
                    combined.push_str(&String::from_utf8_lossy(&out.stderr));
                }
                let status = out.status.code().unwrap_or(1);
                if status != 0 {
                    exit_code = 1;
                }
            }
            Err(err) => {
                exit_code = 1;
                combined.push_str(&format!("error running ffmpeg: {err}\n"));
            }
        }
    }

    let _ = fs::write(&log_path, &combined);
    Ok(ActionRunResult {
        exit_code,
        output: combined,
        log_file: log_path.display().to_string(),
    })
}

fn resolve_transcribe_output_dir(root: &Path, req: &ActionRunRequest) -> Option<PathBuf> {
    match req.output_mode.as_str() {
        "global" => Some(root.join("outputs").join("transcribe")),
        "custom" | "project" => req
            .params
            .get("output")
            .and_then(|v| v.as_str())
            .filter(|v| !v.trim().is_empty())
            .map(|v| root.join(v)),
        "alongside" => Some(root.join("src")),
        "source" => project_output_dir(req)
            .map(|v| root.join(v))
            .or_else(|| Some(root.join("outputs").join("transcribe"))),
        "overwrite" => None,
        _ => Some(root.join("outputs").join("transcribe")),
    }
}

fn resolve_whisper_model(root: &Path, req: &ActionRunRequest) -> Result<PathBuf, io::Error> {
    let model_param = req
        .params
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if !model_param.is_empty() {
        let path = PathBuf::from(model_param);
        return Ok(if path.is_absolute() {
            path
        } else {
            root.join(path)
        });
    }

    let models_dir = root.join("models");
    let model_path = models_dir.join("ggml-base.bin");
    if model_path.exists() {
        return Ok(model_path);
    }

    fs::create_dir_all(&models_dir)?;
    download_whisper_model(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
        &model_path,
    )?;
    Ok(model_path)
}

fn download_whisper_model(url: &str, dest: &Path) -> Result<(), io::Error> {
    let url = url.to_string();
    let dest = dest.to_path_buf();
    let handle = thread::spawn(move || -> Result<(), io::Error> {
        let response = reqwest::blocking::get(&url)
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
        if !response.status().is_success() {
            return Err(io::Error::new(
                io::ErrorKind::Other,
                format!("failed to download model: {}", response.status()),
            ));
        }
        let bytes = response
            .bytes()
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
        fs::write(&dest, &bytes)?;
        Ok(())
    });
    match handle.join() {
        Ok(result) => result,
        Err(_) => Err(io::Error::new(
            io::ErrorKind::Other,
            "model download thread panicked",
        )),
    }
}

fn collect_transcribe_targets(root: &Path, targets: &[String]) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for target in targets {
        let normalized = normalize_target(target);
        let path = root.join(&normalized);
        if path.is_dir() {
            collect_videos_in_dir(&path, &mut out);
        } else if path.is_file() && crate::services::fs_scanner::is_video_file(&path) {
            out.push(path);
        }
    }
    out.sort();
    out.dedup();
    out
}

fn collect_videos_in_dir(dir: &Path, out: &mut Vec<PathBuf>) {
    let entries = match fs::read_dir(dir) {
        Ok(v) => v,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if path.file_name().and_then(|s| s.to_str()) == Some("outputs") {
                continue;
            }
            collect_videos_in_dir(&path, out);
        } else if path.is_file() && crate::services::fs_scanner::is_video_file(&path) {
            out.push(path);
        }
    }
}

fn build_transcribe_output_path(
    output_dir: &Path,
    root: &Path,
    input: &Path,
    ext: &str,
) -> PathBuf {
    let src_root = root.join("src");
    let rel = input
        .strip_prefix(&src_root)
        .ok()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| {
            input
                .file_name()
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("transcript"))
        });
    let mut out = output_dir.join(rel);
    out.set_extension(ext);
    out
}

fn build_whisper_filter(
    model: &str,
    language: &str,
    queue: Option<f64>,
    use_gpu: Option<bool>,
    gpu_device: Option<u64>,
    destination: &Path,
    format: &str,
    max_len: Option<u64>,
    vad_model: Option<&str>,
    vad_threshold: Option<f64>,
    vad_min_speech: Option<f64>,
    vad_min_silence: Option<f64>,
) -> String {
    let mut parts = Vec::new();
    parts.push(format!("model={}", escape_filter_value(model)));
    if !language.is_empty() {
        parts.push(format!("language={}", escape_filter_value(language)));
    }
    if let Some(v) = queue {
        parts.push(format!("queue={v}"));
    }
    if let Some(v) = use_gpu {
        parts.push(format!("use_gpu={}", if v { "true" } else { "false" }));
    }
    if let Some(v) = gpu_device {
        parts.push(format!("gpu_device={v}"));
    }
    parts.push(format!(
        "destination={}",
        escape_filter_value(&destination.display().to_string())
    ));
    parts.push(format!("format={}", escape_filter_value(format)));
    if let Some(v) = max_len {
        parts.push(format!("max_len={v}"));
    }
    if let Some(v) = vad_model {
        if !v.trim().is_empty() {
            parts.push(format!("vad_model={}", escape_filter_value(v)));
        }
    }
    if let Some(v) = vad_threshold {
        parts.push(format!("vad_threshold={v}"));
    }
    if let Some(v) = vad_min_speech {
        parts.push(format!("vad_min_speech_duration={v}"));
    }
    if let Some(v) = vad_min_silence {
        parts.push(format!("vad_min_silence_duration={v}"));
    }
    format!("whisper={}", parts.join(":"))
}

fn escape_filter_value(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace(':', "\\:")
        .replace(' ', "\\ ")
        .replace('\'', "\\'")
}

fn normalize_target(target: &str) -> String {
    if target.is_empty() {
        return target.to_string();
    }
    let lower = target.to_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        return target.to_string();
    }
    if target.starts_with("/")
        || target.starts_with("./")
        || target.starts_with("../")
        || target.starts_with("src/")
    {
        return target.to_string();
    }
    format!("src/{target}")
}

fn project_output_dir(req: &ActionRunRequest) -> Option<String> {
    if req.targets.is_empty() {
        return None;
    }
    let mut project: Option<String> = None;
    for target in &req.targets {
        let normalized = target.replace('\\', "/");
        let first = normalized.split('/').next()?.to_string();
        if let Some(existing) = &project {
            if existing != &first {
                return None;
            }
        } else {
            project = Some(first);
        }
    }
    let project = project?;
    Some(format!("src/{project}/outputs/{}", req.action))
}

fn run_subcommand(
    root: &Path,
    tiles_bin: &Path,
    subcommand: &str,
    args: &[OsString],
) -> Result<(i32, String, PathBuf), io::Error> {
    let log_dir = root.join("outputs").join("tui-logs");
    let _ = fs::create_dir_all(&log_dir);
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let log_path = log_dir.join(format!("studio_{subcommand}_run_{ts}.log"));

    let mut cmd = Command::new(tiles_bin);
    cmd.arg(subcommand);
    for a in args {
        cmd.arg(a);
    }
    cmd.current_dir(root);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let output = match cmd.output() {
        Ok(out) => out,
        Err(err) => {
            let msg = format!("error running subcommand: {err}");
            let _ = fs::write(&log_path, &msg);
            return Ok((1, msg, log_path));
        }
    };

    let mut combined = String::new();
    combined.push_str(&format!(
        "$ tiles {subcommand} {}\n\n",
        args.iter()
            .map(|a| a.to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join(" ")
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
    Ok((status, combined, log_path))
}
