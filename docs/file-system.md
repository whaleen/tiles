# File System Reference

Canonical directory structure and output paths used by CLI, TUI, and Tiles Studio.

## Project Structure

```text
.
├── apps/
│   ├── tiles-api/          # Axum REST API (serves Studio frontend)
│   ├── tiles-studio/       # React + Vite web UI
│   └── tiles-tui/          # Native Rust CLI and TUI
├── configs/
│   └── tile_videos_settings.json   # Saved tile builder settings
├── docs/                   # Documentation
├── outputs/                # Global output root
│   ├── tui-logs/           # Run logs from TUI and Studio
│   └── tui-thumbs/         # Cached video thumbnails
└── src/                    # Source media root
    ├── project-a/          # A project folder
    │   ├── video1.mp4
    │   ├── subfolder/
    │   │   └── clip.mp4
    │   └── outputs/        # Per-project outputs (source mode)
    └── project-b/
```

## Terms

- **Project**: A top-level folder under `src/` that contains source media.
- **Source output**: Output stored alongside a project inside `src/<project>/outputs/`.
- **Global output**: Output stored under the repo-level `outputs/` folder.
- **Overwrite**: Replace original files in place (no output folder created).

## Output Modes

All three surfaces (CLI, TUI, Studio) support the same output modes:

| Mode | CLI | TUI | Studio | Behavior |
| --- | --- | --- | --- | --- |
| Source | `--output __source_outputs__` | "source/outputs" picker | "Save alongside originals" | Creates `src/<project>/outputs/` next to source files |
| Global | _(default, no flag)_ | "outputs/..." picker | "Save to project outputs folder" | Writes to `outputs/` at project root |
| Custom | `--output <path>` | "custom..." picker | "Custom path" | User-specified path, resolved relative to project root |
| Overwrite | `--overwrite` | "overwrite" picker | "Overwrite originals" | Replaces original files in place |

## CLI Default Output Directories

When no `--output` flag is given, each CLI action writes to a default folder under `outputs/`:

| Action | Default output |
| --- | --- |
| `concat` | `outputs/concatenated/` |
| `trim` | `outputs/trimmed/` |
| `detect` | `outputs/scenes/` |
| `strip-audio` | `outputs/strip-audio/` |
| `tile` | `outputs/tiled/<auto>.mp4` |
| `clean` | _(operates in-place on filenames, no output folder)_ |
| `doctor-reencode` | `outputs/doctor-reencode/` |
| `doctor-trim-start` | `outputs/doctor-trim-start/` |
| `slowmo` | `outputs/slowmo/` |
| `organize-landscape` | _(moves files into subfolders in place)_ |

## Source Output Paths

When using source mode, each action creates a timestamped run folder under the project's outputs directory:

```text
src/<project>/outputs/<action>/run_<timestamp>/
```

For example, concat on a project called "ready":

```text
src/ready/outputs/concat/run_1708300000/ready_concatenated/output.mp4
```

## TUI and Studio Log Paths

Both the TUI and Studio write command logs to:

```text
outputs/tui-logs/
├── tui_concat_run_1708300000.log      # TUI runs
├── studio_concat_run_1708300001.log   # Studio runs
└── ...
```

## Thumbnail Cache

Studio generates mid-frame video thumbnails on demand:

```text
outputs/tui-thumbs/
├── project-a/video1.mp4.jpg
└── project-b/subfolder/clip.mp4.jpg
```

## Folder Resolution

- Bare folder names (no `/`) are resolved under `src/` when it exists. `ready` becomes `src/ready/`.
- Paths starting with `./`, `../`, or `/` are used as-is.
- The project root is auto-detected by walking up from the working directory.

## Environment Variables

- `VIDEO_TILING_SETTINGS_PATH` — Override the default tile settings path (`configs/tile_videos_settings.json`).
- `VIDEO_TILING_NO_OVERWRITE=1` — Enable no-overwrite behavior by default for tile runs.
