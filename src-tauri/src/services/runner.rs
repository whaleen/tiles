use std::ffi::OsString;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};
use std::{fs, io};

use crate::models::{ActionProgress, ActionRunRequest, ActionRunResult};

pub fn run_action(
    root: &Path,
    tiles_bin: &Path,
    req: &ActionRunRequest,
    on_progress: impl Fn(ActionProgress) + Send + Sync + 'static,
) -> Result<ActionRunResult, io::Error> {
    if req.action == "transcribe" {
        return run_transcribe(root, req, &on_progress);
    }
    let args = build_args(req);
    let (exit_code, output, log_path) =
        run_subcommand(root, tiles_bin, &req.action, &args, on_progress)?;
    Ok(ActionRunResult {
        exit_code,
        output,
        log_file: log_path.display().to_string(),
    })
}

pub(crate) fn build_args(req: &ActionRunRequest) -> Vec<OsString> {
    let mut args: Vec<OsString> = Vec::new();

    for target in &req.targets {
        args.push(OsString::from(normalize_target(target)));
    }

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
            if action_supports_output(&req.action) {
                args.push("--output".into());
                args.push(
                    req.params
                        .get("output")
                        .and_then(|v| v.as_str())
                        .filter(|v| !v.is_empty())
                        .map(String::from)
                        .unwrap_or_else(|| format!("outputs/{}", req.action))
                        .into(),
                );
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
            if action_supports_output(&req.action) {
                if req.target_type != "settings"
                    || req.params.get("output").and_then(|v| v.as_str()).is_some()
                {
                    if let Some(output) = req
                        .params
                        .get("output")
                        .and_then(|v| v.as_str())
                        .filter(|v| !v.is_empty())
                        .map(String::from)
                        .or_else(|| project_output_dir(req))
                    {
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
            if params
                .get("no_audio")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                args.push("--no-audio".into());
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
                args.push("--number".into());
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
        action if is_ai_action(action) => {
            if let Some(media) = crate::commands::providers::capability_output_media(action) {
                args.push("--output-media".into());
                args.push(media.into());
            }
            if let Some(v) = params.get("provider").and_then(|v| v.as_str()) {
                if !v.is_empty() {
                    args.push("--provider".into());
                    args.push(v.into());
                }
            }
            if let Some(v) = params.get("model").and_then(|v| v.as_str()) {
                if !v.is_empty() {
                    args.push("--model".into());
                    args.push(v.into());
                }
            }
            let ai_params = params
                .get("ai_params")
                .cloned()
                .unwrap_or_else(|| serde_json::json!({}));
            if let Ok(serialized) = serde_json::to_string(&ai_params) {
                args.push("--params".into());
                args.push(serialized.into());
            }
        }
        _ => {}
    }

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
    is_ai_action(action)
        || matches!(
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

/// AI capability actions dispatched through the `tiles ai` CLI subcommand.
/// Their generic verb is the action name; provider/model are params.
fn is_ai_action(action: &str) -> bool {
    matches!(
        action,
        "image-edit" | "image-upscale" | "image-remove-bg" | "image-animate"
    )
}

fn action_supports_overwrite(action: &str) -> bool {
    matches!(
        action,
        "trim"
            | "strip-audio"
            | "chop"
            | "crop"
            | "slowmo"
            | "doctor-reencode"
            | "doctor-trim-start"
    )
}

fn run_transcribe(
    root: &Path,
    req: &ActionRunRequest,
    on_progress: &(dyn Fn(ActionProgress) + Send + Sync),
) -> Result<ActionRunResult, io::Error> {
    let log_dir = root.join("outputs").join("tui-logs");
    let _ = fs::create_dir_all(&log_dir);
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let log_path = log_dir.join(format!("studio_transcribe_run_{ts}.log"));

    let model = match resolve_whisper_model(root, req) {
        Ok(path) => path,
        Err(err) => {
            let msg = format!("failed to prepare Whisper model: {err}");
            let _ = fs::write(&log_path, &msg);
            return Ok(ActionRunResult {
                exit_code: 1,
                output: msg,
                log_file: log_path.display().to_string(),
            });
        }
    };

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
        .unwrap_or("txt")
        .to_lowercase();

    let language = req
        .params
        .get("language")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "auto".to_string());

    // whisper-cli format flags and file extensions
    let (format_flag, ext) = match format.as_str() {
        "srt" => ("--output-srt", "srt"),
        "vtt" => ("--output-vtt", "vtt"),
        "json" => ("--output-json", "json"),
        _ => ("--output-txt", "txt"),
    };

    // Temp dir for extracted audio
    let tmp_dir = root.join("outputs").join("tui-tmp");
    let _ = fs::create_dir_all(&tmp_dir);
    let run_id = format!("run-{ts}");
    let ffmpeg_bin = resolve_tool_bin("ffmpeg");
    let whisper_bin = resolve_tool_bin("whisper-cli");

    let mut combined = String::new();
    combined.push_str(&format!("Transcribe run: {run_id}\n"));
    combined.push_str(&format!("Model: {}\n", model.display()));
    combined.push_str(&format!("Output dir: {}\n", output_dir.display()));
    combined.push_str(&format!("ffmpeg: {}\n", ffmpeg_bin.display()));
    combined.push_str(&format!("whisper-cli: {}\n\n", whisper_bin.display()));
    let mut exit_code = 0;
    let total = inputs.len() as u64;
    on_progress(ActionProgress {
        phase: "Preparing".to_string(),
        current: Some(0),
        total: Some(total),
        percent: Some(0.0),
        message: Some("Preparing transcription…".to_string()),
    });

    for (index, input) in inputs.iter().enumerate() {
        on_progress(ActionProgress {
            phase: "Transcribing".to_string(),
            current: Some(index as u64),
            total: Some(total),
            percent: Some(((index as f64 / total as f64) * 100.0).clamp(0.0, 100.0)),
            message: Some(format!("Transcribing {}", input.display())),
        });
        let file_stem = input
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("audio");

        // 1. Extract mono 16kHz WAV — the only format whisper-cli reliably accepts
        let tmp_wav = tmp_dir.join(format!("{file_stem}_{ts}.wav"));
        combined.push_str(&format!(
            "$ {} -y -i {} -vn -acodec pcm_s16le -ar 16000 -ac 1 {}\n\n",
            ffmpeg_bin.display(),
            input.display(),
            tmp_wav.display()
        ));
        let extract = Command::new(&ffmpeg_bin)
            .args(["-y", "-i"])
            .arg(input)
            .args(["-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1"])
            .arg(&tmp_wav)
            .current_dir(root)
            .output();
        match extract {
            Ok(out) if !out.status.success() => {
                exit_code = 1;
                combined.push_str(&String::from_utf8_lossy(&out.stderr));
                combined.push('\n');
                let _ = fs::remove_file(&tmp_wav);
                continue;
            }
            Err(e) => {
                exit_code = 1;
                combined.push_str(&format!("error running ffmpeg: {e}\n"));
                continue;
            }
            _ => {}
        }

        // 2. Build output stem (no extension — whisper-cli appends it).
        // Global outputs mirror src/<project>/..., but project outputs should be
        // relative to that project so lookup paths stay predictable.
        let output_stem = {
            let rel = transcript_output_rel(root, input, &output_dir);
            let mut p = output_dir.join(rel);
            p.set_extension("");
            p
        };
        if let Some(parent) = output_stem.parent() {
            let _ = fs::create_dir_all(parent);
        }

        // 3. Run whisper-cli
        combined.push_str(&format!(
            "$ {} -m {} -l {} -of {} {} {}\n\n",
            whisper_bin.display(),
            model.display(),
            language,
            output_stem.display(),
            format_flag,
            tmp_wav.display()
        ));
        let whisper = Command::new(&whisper_bin)
            .arg("-m")
            .arg(&model)
            .arg("-l")
            .arg(&language)
            .arg("-of")
            .arg(&output_stem)
            .arg(format_flag)
            .arg("--no-prints")
            .arg(&tmp_wav)
            .current_dir(root)
            .output();
        match whisper {
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
                if !out.status.success() {
                    exit_code = 1;
                } else {
                    combined.push_str(&format!("wrote {}.{ext}\n", output_stem.display()));
                }
            }
            Err(e) => {
                exit_code = 1;
                combined.push_str(&format!("error running whisper-cli: {e}\n"));
            }
        }

        // 4. Clean up temp WAV
        let _ = fs::remove_file(&tmp_wav);
    }

    on_progress(ActionProgress {
        phase: if exit_code == 0 { "Complete" } else { "Failed" }.to_string(),
        current: Some(total),
        total: Some(total),
        percent: Some(100.0),
        message: Some(if exit_code == 0 {
            "Transcription complete".to_string()
        } else {
            "Transcription failed".to_string()
        }),
    });

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
            .and_then(|v| safe_output_path(root, v)),
        "alongside" => Some(root.join("src")),
        "source" => project_output_dir(req)
            .map(|v| root.join(v))
            .or_else(|| Some(root.join("outputs").join("transcribe"))),
        "overwrite" => None,
        _ => Some(root.join("outputs").join("transcribe")),
    }
}

fn safe_output_path(root: &Path, rel: &str) -> Option<PathBuf> {
    let rel = rel.trim().trim_start_matches('/');
    if rel.is_empty() || rel.contains("..") || rel.contains('\\') || Path::new(rel).is_absolute() {
        return None;
    }
    Some(root.join(rel))
}

fn transcript_output_rel(root: &Path, input: &Path, output_dir: &Path) -> PathBuf {
    let src_root = root.join("src");
    let src_rel = input
        .strip_prefix(&src_root)
        .ok()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| {
            input
                .file_name()
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("transcript"))
        });

    // outputs/transcribe mirrors the full src-relative path, including project.
    if output_dir == root.join("outputs").join("transcribe") {
        return src_rel;
    }

    // src/<project>/outputs/... stores paths relative to <project>/.
    let parts: Vec<_> = src_rel.iter().collect();
    if parts.len() > 1 {
        if let Some(project) = parts[0].to_str() {
            let project_outputs = root.join("src").join(project).join("outputs");
            if output_dir.starts_with(&project_outputs) {
                return parts.iter().skip(1).collect();
            }
        }
    }

    src_rel
}

fn resolve_tool_bin(name: &str) -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = [
        format!("/opt/homebrew/bin/{name}"),
        format!("/usr/local/bin/{name}"),
        format!("/usr/bin/{name}"),
        format!("{home}/.cargo/bin/{name}"),
        format!("{home}/.local/bin/{name}"),
    ];
    for candidate in candidates {
        let path = PathBuf::from(candidate);
        if path.exists() {
            return path;
        }
    }
    PathBuf::from(name)
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

    let models_dir = default_whisper_models_dir(root);
    let model_path = models_dir.join("ggml-base.bin");
    if model_path.exists() {
        return Ok(model_path);
    }

    fs::create_dir_all(&models_dir)?;
    migrate_workspace_model_download(root, &model_path);
    if model_path.exists() {
        return Ok(model_path);
    }

    download_whisper_model(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
        &model_path,
    )?;
    Ok(model_path)
}

fn default_whisper_models_dir(root: &Path) -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("com.whaleen.tiles")
            .join("models");
    }
    root.join("models")
}

fn migrate_workspace_model_download(root: &Path, model_path: &Path) {
    let legacy_model = root.join("models").join("ggml-base.bin");
    let legacy_partial = root.join("models").join("ggml-base.bin.download");
    let partial = model_path.with_extension("download");

    if legacy_model.is_file() {
        let _ = fs::rename(&legacy_model, model_path)
            .or_else(|_| fs::copy(&legacy_model, model_path).map(|_| ()));
    } else if legacy_partial.is_file() && !partial.exists() {
        let _ = fs::rename(&legacy_partial, &partial)
            .or_else(|_| fs::copy(&legacy_partial, &partial).map(|_| ()));
    }
}

fn download_whisper_model(url: &str, dest: &Path) -> Result<(), io::Error> {
    let url = url.to_string();
    let dest = dest.to_path_buf();
    let handle = thread::spawn(move || -> Result<(), io::Error> {
        let tmp = dest.with_extension("download");

        // Prefer curl because Hugging Face can return responses that reqwest's
        // decoder rejects, and curl can resume partial model downloads.
        match download_whisper_model_curl(&url, &tmp) {
            Ok(()) => {
                fs::rename(&tmp, &dest)?;
                return Ok(());
            }
            Err(curl_err) => {
                // If curl is unavailable, fall back to a streaming reqwest download.
                // Start fresh because reqwest does not resume the partial curl file.
                let _ = fs::remove_file(&tmp);
                match download_whisper_model_reqwest(&url, &tmp) {
                    Ok(()) => {
                        fs::rename(&tmp, &dest)?;
                        Ok(())
                    }
                    Err(reqwest_err) => Err(io::Error::new(
                        io::ErrorKind::Other,
                        format!(
                            "curl download failed: {curl_err}; reqwest fallback failed: {reqwest_err}"
                        ),
                    )),
                }
            }
        }
    });
    match handle.join() {
        Ok(result) => result,
        Err(_) => Err(io::Error::new(
            io::ErrorKind::Other,
            "model download thread panicked",
        )),
    }
}

fn download_whisper_model_reqwest(url: &str, dest: &Path) -> Result<(), io::Error> {
    let mut response = reqwest::blocking::Client::new()
        .get(url)
        .header(reqwest::header::ACCEPT_ENCODING, "identity")
        .send()
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
    if !response.status().is_success() {
        return Err(io::Error::new(
            io::ErrorKind::Other,
            format!("failed to download model: {}", response.status()),
        ));
    }
    let mut file = fs::File::create(dest)?;
    response
        .copy_to(&mut file)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
    Ok(())
}

fn download_whisper_model_curl(url: &str, dest: &Path) -> Result<(), io::Error> {
    let curl_bin = resolve_tool_bin("curl");
    let output = Command::new(&curl_bin)
        .args([
            "-L",
            "--fail",
            "--silent",
            "--show-error",
            "--continue-at",
            "-",
            "--output",
        ])
        .arg(dest)
        .arg(url)
        .output()
        .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("error running curl: {e}")))?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(io::Error::new(
            io::ErrorKind::Other,
            format!("curl exited with {}: {stderr}", output.status),
        ))
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

fn normalize_target(target: &str) -> String {
    if target.is_empty() {
        return target.to_string();
    }
    let lower = target.to_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        return target.to_string();
    }
    if target.starts_with('/')
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
        let mut parts = normalized.split('/').filter(|part| !part.is_empty());
        let first = parts.next()?;
        let current = if first == "src" {
            parts.next()?.to_string()
        } else {
            first.to_string()
        };
        if let Some(existing) = &project {
            if existing != &current {
                return None;
            }
        } else {
            project = Some(current);
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
    on_progress: impl Fn(ActionProgress) + Send + Sync + 'static,
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

    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(err) => {
            let msg = format!("error running subcommand: {err}");
            let _ = fs::write(&log_path, &msg);
            return Ok((1, msg, log_path));
        }
    };

    let combined = Arc::new(Mutex::new(format!(
        "$ tiles {subcommand} {}\n\n",
        args.iter()
            .map(|a| a.to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join(" ")
    )));
    let progress: Arc<dyn Fn(ActionProgress) + Send + Sync + 'static> = Arc::new(on_progress);
    progress.as_ref()(ActionProgress {
        phase: "Running".to_string(),
        current: None,
        total: None,
        percent: None,
        message: Some(format!("Running {subcommand}…")),
    });

    let mut readers = Vec::new();
    if let Some(stdout) = child.stdout.take() {
        readers.push(spawn_output_reader(
            stdout,
            combined.clone(),
            progress.clone(),
        ));
    }
    if let Some(stderr) = child.stderr.take() {
        readers.push(spawn_output_reader(
            stderr,
            combined.clone(),
            progress.clone(),
        ));
    }

    let status = child.wait().map(|status| status.code().unwrap_or(1))?;
    for reader in readers {
        let _ = reader.join();
    }

    progress.as_ref()(ActionProgress {
        phase: if status == 0 { "Complete" } else { "Failed" }.to_string(),
        current: Some(1),
        total: Some(1),
        percent: Some(100.0),
        message: Some(if status == 0 {
            format!("{subcommand} complete")
        } else {
            format!("{subcommand} failed")
        }),
    });

    let output = combined.lock().map(|s| s.clone()).unwrap_or_default();
    let _ = fs::write(&log_path, &output);
    Ok((status, output, log_path))
}

fn spawn_output_reader<R: std::io::Read + Send + 'static>(
    reader: R,
    combined: Arc<Mutex<String>>,
    on_progress: Arc<dyn Fn(ActionProgress) + Send + Sync + 'static>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let reader = BufReader::new(reader);
        for line in reader.lines().map_while(Result::ok) {
            if let Some(progress) =
                parse_progress_line(&line).or_else(|| progress_from_text_line(&line))
            {
                on_progress.as_ref()(progress);
            }
            if let Ok(mut combined) = combined.lock() {
                combined.push_str(&line);
                combined.push('\n');
            }
        }
    })
}

fn parse_progress_line(line: &str) -> Option<ActionProgress> {
    const PREFIX: &str = "TILES_PROGRESS ";
    let payload = line.strip_prefix(PREFIX)?;
    serde_json::from_str(payload).ok()
}

fn progress_from_text_line(line: &str) -> Option<ActionProgress> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    let lower = trimmed.to_lowercase();
    if !(lower.starts_with("processing")
        || lower.starts_with("looping")
        || lower.starts_with("rendering")
        || lower.starts_with("encoding")
        || lower.starts_with("downloading")
        || lower.starts_with("transcribing"))
    {
        return None;
    }
    Some(ActionProgress {
        phase: "Running".to_string(),
        current: None,
        total: None,
        percent: None,
        message: Some(trimmed.to_string()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn req(action: &str) -> ActionRunRequest {
        ActionRunRequest {
            action: action.to_string(),
            targets: vec!["project-a/clip.mp4".to_string()],
            target_type: "folders_or_videos".to_string(),
            output_mode: "source".to_string(),
            params: json!({}),
        }
    }

    fn args_as_strings(req: &ActionRunRequest) -> Vec<String> {
        build_args(req)
            .into_iter()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect()
    }

    #[test]
    fn clean_numbering_uses_cli_flag_name() {
        let request = ActionRunRequest {
            action: "clean".to_string(),
            targets: vec!["project-a".to_string()],
            target_type: "folders".to_string(),
            output_mode: "global".to_string(),
            params: json!({ "mode": "rename", "add_number": true }),
        };

        let args = args_as_strings(&request);

        assert!(args.contains(&"--number".to_string()));
        assert!(!args.contains(&"--add-number".to_string()));
    }

    #[test]
    fn project_output_dir_uses_project_from_relative_target() {
        let args = args_as_strings(&req("slowmo"));

        assert!(args
            .windows(2)
            .any(|pair| { pair[0] == "--output" && pair[1] == "src/project-a/outputs/slowmo" }));
    }

    #[test]
    fn alongside_output_uses_cli_token() {
        let mut request = req("trim");
        request.output_mode = "alongside".to_string();

        let args = args_as_strings(&request);

        assert!(args
            .windows(2)
            .any(|pair| { pair[0] == "--output" && pair[1] == "__alongside__" }));
    }

    #[test]
    fn ai_action_passes_provider_model_and_params() {
        let request = ActionRunRequest {
            action: "image-edit".to_string(),
            targets: vec!["demo/cat.jpg".to_string()],
            target_type: "folders_or_videos".to_string(),
            output_mode: "custom".to_string(),
            params: json!({
                "output": "src/demo/outputs/image-edit",
                "provider": "modelslab",
                "model": "flux",
                "ai_params": { "prompt": "neon", "strength": 0.6 }
            }),
        };

        let args = args_as_strings(&request);

        assert!(args
            .windows(2)
            .any(|p| p[0] == "--output" && p[1] == "src/demo/outputs/image-edit"));
        assert!(args.windows(2).any(|p| p[0] == "--provider" && p[1] == "modelslab"));
        assert!(args.windows(2).any(|p| p[0] == "--model" && p[1] == "flux"));
        let params_idx = args.iter().position(|a| a == "--params").expect("--params present");
        let payload = &args[params_idx + 1];
        assert!(payload.contains("\"prompt\":\"neon\""));
        assert!(payload.contains("\"strength\":0.6"));
    }

    #[test]
    fn image_animate_passes_video_output_media() {
        let request = ActionRunRequest {
            action: "image-animate".to_string(),
            targets: vec!["demo/cat.jpg".to_string()],
            target_type: "folders_or_videos".to_string(),
            output_mode: "custom".to_string(),
            params: json!({
                "output": "src/demo/outputs/image-animate",
                "provider": "modelslab",
                "ai_params": { "num_frames": 25 }
            }),
        };

        let args = args_as_strings(&request);

        assert!(args
            .windows(2)
            .any(|p| p[0] == "--output-media" && p[1] == "video"));
    }

    #[test]
    fn transcribe_global_output_keeps_project_prefix() {
        let root = Path::new("/workspace");
        let input = root.join("src/project-a/footage/clip.mp4");
        let output_dir = root.join("outputs/transcribe");

        assert_eq!(
            transcript_output_rel(root, &input, &output_dir),
            PathBuf::from("project-a/footage/clip.mp4")
        );
    }

    #[test]
    fn transcribe_project_output_strips_project_prefix() {
        let root = Path::new("/workspace");
        let input = root.join("src/project-a/footage/clip.mp4");
        let output_dir = root.join("src/project-a/outputs/transcribe");

        assert_eq!(
            transcript_output_rel(root, &input, &output_dir),
            PathBuf::from("footage/clip.mp4")
        );
    }
}
