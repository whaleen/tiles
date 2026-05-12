# File System Reference

Workspace layout and output paths used by tiles.

## Workspace Structure

The workspace is a folder the user picks on first launch (default: `~/Movies/tiles`). All project files, outputs, and configs live here — separate from the app itself.

```text
~/Movies/tiles/              # workspace root (user-configured)
├── src/                     # source media root
│   ├── project-a/           # a project folder
│   │   ├── video1.mp4
│   │   ├── subfolder/
│   │   │   └── clip.mp4
│   │   └── outputs/         # per-project outputs (source mode)
│   └── project-b/
├── outputs/                 # global output root
│   ├── tui-logs/            # action run logs
│   └── tui-thumbs/          # cached video thumbnails (hash-named JPEGs)
├── configs/
│   └── tile_videos_settings.json   # saved tile builder settings
├── models/                  # Whisper models (auto-downloaded on first transcribe)
│   └── ggml-base.bin
└── apps/tiles-tui/          # workspace marker required by the tiles CLI
    └── Cargo.toml
```

The workspace path is persisted to:

```text
~/Library/Application Support/com.whaleen.tiles/prefs.json
```

To reset the workspace (pick a new folder on next launch):

```bash
rm ~/Library/Application\ Support/com.whaleen.tiles/prefs.json
```

## Terms

- **Project**: A top-level folder under `src/` that contains source media.
- **Source output**: Output stored alongside a project inside `src/<project>/outputs/`.
- **Global output**: Output stored under `outputs/` in the workspace root.
- **Overwrite**: Replace original files in place (no output folder created).

## Output Modes

| Mode | Behavior |
| --- | --- |
| Source | Creates `src/<project>/outputs/<action>/` next to source files |
| Global | Writes to `outputs/<action>/` at workspace root |
| Alongside | Saves next to the original files (same directory) |
| Custom | User-specified relative path |
| Overwrite | Replaces original files in place |

## Default Output Directories

When using global mode, each action writes to a folder under `outputs/`:

| Action | Default output |
| --- | --- |
| `concat` | `outputs/concat/` |
| `trim` | `outputs/trim/` |
| `detect` | `outputs/detect/` |
| `split-detect` | `outputs/split-detect/` |
| `yt-import` (URL import) | `outputs/yt-import/` |
| `strip-audio` | `outputs/strip-audio/` |
| `chop` | `outputs/chop/` |
| `transcribe` | `outputs/transcribe/` |
| `tile` | `outputs/tile/` |
| `slowmo` | `outputs/slowmo/` |
| `loop` | `outputs/loop/` |
| `crop` | `outputs/crop/` |
| `doctor-reencode` | `outputs/doctor-reencode/` |
| `clean` | _(renames files in place, no output folder)_ |
| `organize-landscape` | _(moves files into subfolders in place)_ |

## Source Output Paths

When using source mode, each action creates a timestamped run folder under the project's outputs directory:

```text
src/<project>/outputs/<action>/
```

## Log Paths

Action run logs are written to:

```text
outputs/tui-logs/
├── studio_concat_run_1708300000.log
├── studio_trim_run_1708300001.log
└── ...
```

## Thumbnail Cache

The embedded media server generates mid-frame video thumbnails on demand and caches them as hash-named JPEGs:

```text
outputs/tui-thumbs/
├── a3f2c1d4e5b6.jpg
├── 9b8a7c6d5e4f.jpg
└── ...
```

Thumbnails are keyed by the video's relative path and modification time. Stale thumbnails are regenerated automatically when the source file changes.

## Workspace Marker

The `apps/tiles-tui/Cargo.toml` file is a required marker for the `tiles` CLI binary. The binary locates the workspace root by walking up from its current working directory looking for this file. It is created automatically when you set or pick a workspace.

## App Layout (Repo)

The repo only contains the app code — no source media or outputs are stored here.

```text
src/           # React frontend (Vite + TypeScript)
src-tauri/     # Rust backend + Tauri config
cli/           # tiles-cli sidecar (built separately, copied into src-tauri/binaries/)
docs/          # Project documentation
```
