// Integration tests for tiles-cli
//
// Each test:
//   1. Builds a temporary workspace (src/, outputs/, configs/) so find_repo_root() succeeds
//   2. Generates synthetic clips with ffmpeg's lavfi source — no real video files needed
//   3. Runs the tiles binary against that workspace
//   4. Verifies output with ffprobe and a full ffmpeg decode pass
//
// Run with: cargo test -p tiles-cli -- --test-threads=1
// (--test-threads=1 avoids contention on ffmpeg CPU; remove for faster parallel runs)

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

// ---------------------------------------------------------------------------
// Workspace harness
// ---------------------------------------------------------------------------

struct TestWorkspace {
    _dir: tempfile::TempDir, // kept alive for the duration of the test
    root: PathBuf,
}

impl TestWorkspace {
    fn new() -> Self {
        let dir = tempfile::TempDir::new().expect("failed to create temp dir");
        let root = dir.path().to_path_buf();
        // find_repo_root() requires all three directories to exist
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(root.join("outputs")).unwrap();
        fs::create_dir_all(root.join("configs")).unwrap();
        Self { _dir: dir, root }
    }

    fn root(&self) -> &Path {
        &self.root
    }

    /// Create a folder under src/ and populate it with `count` synthetic clips.
    /// Each clip is `duration` seconds, 320x240 @ 30fps, with a sine-wave audio track.
    fn create_clip_folder(&self, folder: &str, count: usize, duration: f64) -> PathBuf {
        let folder_path = self.root.join("src").join(folder);
        fs::create_dir_all(&folder_path).unwrap();
        for i in 0..count {
            self.create_clip(&folder_path, &format!("clip_{i:02}.mp4"), duration);
        }
        folder_path
    }

    /// Create a single synthetic clip at the given absolute path.
    fn create_clip(&self, dir: &Path, name: &str, duration: f64) -> PathBuf {
        self.create_clip_custom(dir, name, duration, "320x240", "30", true)
    }

    fn create_clip_custom(
        &self,
        dir: &Path,
        name: &str,
        duration: f64,
        size: &str,
        rate: &str,
        audio: bool,
    ) -> PathBuf {
        let path = dir.join(name);
        let mut cmd = Command::new("ffmpeg");
        cmd.args([
            "-f",
            "lavfi",
            "-i",
            &format!("testsrc=duration={duration}:size={size}:rate={rate}"),
        ]);
        if audio {
            cmd.args([
                "-f",
                "lavfi",
                "-i",
                &format!("sine=frequency=440:duration={duration}"),
            ]);
        }
        cmd.args(["-c:v", "libx264", "-preset", "ultrafast", "-crf", "35"]);
        if audio {
            cmd.args(["-c:a", "aac", "-b:a", "64k", "-shortest"]);
        }
        let out = cmd
            .args(["-y", path.to_str().unwrap()])
            .output()
            .expect("ffmpeg not found — install ffmpeg to run integration tests");
        assert!(
            out.status.success(),
            "ffmpeg failed creating test clip:\n{}",
            String::from_utf8_lossy(&out.stderr)
        );
        path
    }

    /// Run the tiles binary in this workspace with the given args.
    fn run(&self, args: &[&str]) -> std::process::Output {
        Command::new(tiles_bin())
            .current_dir(&self.root)
            .args(args)
            .output()
            .expect("failed to run tiles binary")
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Path to the tiles binary built by cargo.
fn tiles_bin() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_tiles"))
}

/// Query a single ffprobe stream field for a given stream selector.
fn ffprobe_duration(path: &Path, stream: &str) -> Option<f64> {
    let out = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            stream,
            "-show_entries",
            "stream=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path.to_str().unwrap(),
        ])
        .output()
        .ok()?;
    String::from_utf8_lossy(&out.stdout)
        .trim()
        .parse::<f64>()
        .ok()
}

fn video_duration(path: &Path) -> f64 {
    ffprobe_duration(path, "v:0").unwrap_or(0.0)
}

fn audio_duration(path: &Path) -> f64 {
    ffprobe_duration(path, "a:0").unwrap_or(0.0)
}

fn assert_decodes_cleanly(path: &Path) {
    let out = Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-i",
            path.to_str().unwrap(),
            "-f",
            "null",
            "-",
        ])
        .output()
        .expect("ffmpeg not found — install ffmpeg to run integration tests");
    assert!(
        out.status.success(),
        "output failed full decode pass {}:\n{}",
        path.display(),
        String::from_utf8_lossy(&out.stderr)
    );
}

/// The core invariant: file decodes fully and video/audio end within 150ms.
fn assert_av_sync(path: &Path) {
    assert!(
        path.exists(),
        "output file does not exist: {}",
        path.display()
    );
    assert_decodes_cleanly(path);
    let v = video_duration(path);
    let a = audio_duration(path);
    assert!(v > 0.0, "output has no video track: {}", path.display());
    assert!(a > 0.0, "output has no audio track: {}", path.display());
    let diff = (v - a).abs();
    assert!(
        diff < 0.15,
        "A/V sync failure in {}: video={v:.3}s audio={a:.3}s diff={diff:.3}s",
        path.display()
    );
}

/// Assert output duration is within `tolerance` seconds of `expected`.
fn assert_duration_approx(path: &Path, expected: f64, tolerance: f64) {
    let v = video_duration(path);
    let diff = (v - expected).abs();
    assert!(
        diff <= tolerance,
        "duration mismatch in {}: got {v:.3}s expected ~{expected:.3}s (±{tolerance}s)",
        path.display()
    );
}

/// Find the first .mp4 file in a directory.
fn first_mp4(dir: &Path) -> Option<PathBuf> {
    fs::read_dir(dir).ok()?.flatten().find_map(|e| {
        let p = e.path();
        if p.extension().and_then(|x| x.to_str()) == Some("mp4") {
            Some(p)
        } else {
            None
        }
    })
}

// ---------------------------------------------------------------------------
// concat tests
// ---------------------------------------------------------------------------

#[test]
fn test_concat_cut_3_equal_clips() {
    let ws = TestWorkspace::new();
    ws.create_clip_folder("clips", 3, 5.0);
    fs::create_dir_all(ws.root().join("src/clips/outputs/concat")).unwrap();

    let out = ws.run(&[
        "concat",
        "src/clips",
        "--output",
        "src/clips/outputs/concat",
        "--transition",
        "cut",
    ]);
    assert!(
        out.status.success(),
        "tiles concat cut failed:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );

    let output_dir = ws.root().join("src/clips/outputs/concat");
    let file = first_mp4(&output_dir).expect("no output file found");
    assert_av_sync(&file);
    // 3 × 5s with cut = 15s
    assert_duration_approx(&file, 15.0, 1.0);
}

#[test]
fn test_concat_dissolve_3_equal_clips() {
    let ws = TestWorkspace::new();
    ws.create_clip_folder("clips", 3, 5.0);
    fs::create_dir_all(ws.root().join("src/clips/outputs/concat")).unwrap();

    let out = ws.run(&[
        "concat",
        "src/clips",
        "--output",
        "src/clips/outputs/concat",
        "--transition",
        "dissolve",
        "--duration",
        "1",
    ]);
    assert!(
        out.status.success(),
        "tiles concat dissolve failed:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );

    let output_dir = ws.root().join("src/clips/outputs/concat");
    let file = first_mp4(&output_dir).expect("no output file found");
    assert_av_sync(&file);
    // 3 × 5s with 1s dissolve = 13s
    assert_duration_approx(&file, 13.0, 1.0);
}

#[test]
fn test_concat_dissolve_mixed_durations() {
    // This is the original bug: clips of different durations caused 6588 dropped
    // frames without -fps_mode cfr, producing ~30s video against ~230s audio.
    let ws = TestWorkspace::new();
    let folder = ws.root().join("src/mixed");
    fs::create_dir_all(&folder).unwrap();
    ws.create_clip(&folder, "short.mp4", 4.0);
    ws.create_clip(&folder, "medium.mp4", 8.0);
    ws.create_clip(&folder, "long.mp4", 12.0);
    fs::create_dir_all(ws.root().join("src/mixed/outputs/concat")).unwrap();

    let out = ws.run(&[
        "concat",
        "src/mixed",
        "--output",
        "src/mixed/outputs/concat",
        "--transition",
        "dissolve",
        "--duration",
        "1",
    ]);
    assert!(
        out.status.success(),
        "tiles concat dissolve mixed failed:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );

    let output_dir = ws.root().join("src/mixed/outputs/concat");
    let file = first_mp4(&output_dir).expect("no output file found");
    assert_av_sync(&file);
    // (4 + 8 + 12) - 2 transitions × 1s = 22s
    assert_duration_approx(&file, 22.0, 1.5);
}

#[test]
fn test_concat_fadeblack_3_clips() {
    let ws = TestWorkspace::new();
    ws.create_clip_folder("clips", 3, 5.0);
    fs::create_dir_all(ws.root().join("src/clips/outputs/concat")).unwrap();

    let out = ws.run(&[
        "concat",
        "src/clips",
        "--output",
        "src/clips/outputs/concat",
        "--transition",
        "fadeblack",
        "--duration",
        "1",
    ]);
    assert!(
        out.status.success(),
        "tiles concat fadeblack failed:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );

    let output_dir = ws.root().join("src/clips/outputs/concat");
    let file = first_mp4(&output_dir).expect("no output file found");
    assert_av_sync(&file);
    // Segment-based fadeblack is a real crossfade, so total duration shrinks.
    assert_duration_approx(&file, 13.0, 1.5);
}

#[test]
fn test_concat_dissolve_mixed_dimensions_and_missing_audio() {
    let ws = TestWorkspace::new();
    let folder = ws.root().join("src/messy");
    fs::create_dir_all(&folder).unwrap();
    ws.create_clip_custom(&folder, "a_audio_24fps.mp4", 2.3, "320x180", "24", true);
    ws.create_clip_custom(&folder, "b_noaudio_30fps.mp4", 3.1, "640x360", "30", false);
    ws.create_clip_custom(&folder, "c_audio_25fps.mp4", 1.7, "480x270", "25", true);
    fs::create_dir_all(ws.root().join("src/messy/outputs/concat")).unwrap();

    let out = ws.run(&[
        "concat",
        "src/messy",
        "--output",
        "src/messy/outputs/concat",
        "--transition",
        "dissolve",
        "--duration",
        "0.5",
    ]);
    assert!(
        out.status.success(),
        "tiles concat dissolve messy failed:\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );

    let output_dir = ws.root().join("src/messy/outputs/concat");
    let file = first_mp4(&output_dir).expect("no output file found");
    assert_av_sync(&file);
    assert_duration_approx(&file, 6.1, 1.0);
}

// ---------------------------------------------------------------------------
// loop tests
// ---------------------------------------------------------------------------

#[test]
fn test_loop_cut_3x() {
    let ws = TestWorkspace::new();
    ws.create_clip_folder("clips", 1, 5.0);
    fs::create_dir_all(ws.root().join("src/clips/outputs/loop")).unwrap();

    let out = ws.run(&[
        "loop",
        "src/clips",
        "--output",
        "src/clips/outputs/loop",
        "--count",
        "3",
        "--transition",
        "cut",
    ]);
    assert!(
        out.status.success(),
        "tiles loop cut failed:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );

    let output_dir = ws.root().join("src/clips/outputs/loop");
    let file = first_mp4(&output_dir).expect("no output file found");
    assert_av_sync(&file);
    // 3 × 5s = 15s
    assert_duration_approx(&file, 15.0, 1.0);
}

#[test]
fn test_loop_dissolve_3x() {
    let ws = TestWorkspace::new();
    ws.create_clip_folder("clips", 1, 5.0);
    fs::create_dir_all(ws.root().join("src/clips/outputs/loop")).unwrap();

    let out = ws.run(&[
        "loop",
        "src/clips",
        "--output",
        "src/clips/outputs/loop",
        "--count",
        "3",
        "--transition",
        "dissolve",
        "--duration",
        "1",
    ]);
    assert!(
        out.status.success(),
        "tiles loop dissolve failed:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );

    let output_dir = ws.root().join("src/clips/outputs/loop");
    let file = first_mp4(&output_dir).expect("no output file found");
    assert_av_sync(&file);
    // 3 × 5s - 2 × 1s = 13s
    assert_duration_approx(&file, 13.0, 1.0);
}

// ---------------------------------------------------------------------------
// tile tests
// ---------------------------------------------------------------------------

#[test]
fn test_tile_2x1_two_folders() {
    let ws = TestWorkspace::new();
    ws.create_clip_folder("left", 2, 5.0);
    ws.create_clip_folder("right", 2, 5.0);
    fs::create_dir_all(ws.root().join("outputs/tile")).unwrap();

    let out = ws.run(&[
        "tile",
        "src/left",
        "src/right",
        "--layout",
        "2x1",
        "--output",
        "outputs/tile/out.mp4",
    ]);
    assert!(
        out.status.success(),
        "tiles tile 2x1 failed:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );

    let file = ws.root().join("outputs/tile/out.mp4");
    assert_av_sync(&file);
}

#[test]
fn test_tile_2x2_four_folders() {
    let ws = TestWorkspace::new();
    ws.create_clip_folder("a", 2, 5.0);
    ws.create_clip_folder("b", 2, 5.0);
    ws.create_clip_folder("c", 2, 5.0);
    ws.create_clip_folder("d", 2, 5.0);
    fs::create_dir_all(ws.root().join("outputs/tile")).unwrap();

    let out = ws.run(&[
        "tile",
        "src/a",
        "src/b",
        "src/c",
        "src/d",
        "--layout",
        "2x2",
        "--output",
        "outputs/tile/out.mp4",
    ]);
    assert!(
        out.status.success(),
        "tiles tile 2x2 failed:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );

    let file = ws.root().join("outputs/tile/out.mp4");
    assert_av_sync(&file);
}

// ---------------------------------------------------------------------------
// slowmo tests
// ---------------------------------------------------------------------------

#[test]
fn test_slowmo_half_speed() {
    let ws = TestWorkspace::new();
    ws.create_clip_folder("clips", 1, 4.0);
    fs::create_dir_all(ws.root().join("src/clips/outputs/slowmo")).unwrap();

    let out = ws.run(&[
        "slowmo",
        "src/clips",
        "--output",
        "src/clips/outputs/slowmo",
        "--factor",
        "0.5",
    ]);
    assert!(
        out.status.success(),
        "tiles slowmo failed:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );

    let output_dir = ws.root().join("src/clips/outputs/slowmo");
    let file = first_mp4(&output_dir).expect("no output file found");
    assert_av_sync(&file);
    // 4s at 0.5x = ~8s
    assert_duration_approx(&file, 8.0, 1.5);
}
