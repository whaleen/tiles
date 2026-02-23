# tiles

Rust-first toolkit for video processing and tiled renders.

## Status

Python implementation has been removed. The project is now Rust-only.

Current feature status for CLI, TUI, and Tiles Studio: `docs/status.md`.

## Requirements

- Rust (stable)
- `ffmpeg` and `ffprobe`
- Node.js (for Tiles Studio)

macOS:

```bash
brew install ffmpeg
```

## Run

```bash
# TUI (interactive menu)
cargo run -p tiles-tui --bin tiles

# Tiles Studio (web UI + API)
cargo run -p tiles-api
```

## CLI

```bash
# help
cargo run -p tiles-tui --bin tiles -- help

# interactive menu
cargo run -p tiles-tui --bin tiles -- tui

# tiled render
cargo run -p tiles-tui --bin tiles -- tile folder1 folder2 --layout 2x1 -o outputs/tiled/my_tiled.mp4
cargo run -p tiles-tui --bin tiles -- run --render-mode preview --no-overwrite
cargo run -p tiles-tui --bin tiles -- yolo

# concat / trim / clean / detect
cargo run -p tiles-tui --bin tiles -- concat ready couch --transition fade --duration 1.0 -o outputs/concatenated
cargo run -p tiles-tui --bin tiles -- trim ready --start 0.5 --end 0.25 -o outputs/trimmed
cargo run -p tiles-tui --bin tiles -- clean ready -m 3 -n
cargo run -p tiles-tui --bin tiles -- detect ready --threshold 0.27 --list-only

# tools / doctor
cargo run -p tiles-tui --bin tiles -- doctor-reencode ready --fps 30 --no-audio
cargo run -p tiles-tui --bin tiles -- doctor-trim-start ready --seconds 1.0 --no-audio
cargo run -p tiles-tui --bin tiles -- organize-landscape ready
cargo run -p tiles-tui --bin tiles -- slowmo ready --factor 0.5 --no-audio
cargo run -p tiles-tui --bin tiles -- strip-audio ready
```

## Tiles Studio

A React + Vite web UI backed by an axum API server. Provides a visual interface for every action available in the CLI.

- **Library**: Browse projects and videos, select individual clips or whole folders, and run any action on them.
- **Actions**: All CLI commands exposed as forms with clear descriptions and sensible defaults.
- **Tile Builder**: Visual layout picker, folder assignment grid, per-tile settings, and one-click rendering.
- **Output Explorer**: Browse and preview all generated outputs.
- **Log Viewer**: Review command logs for every studio run.

See `apps/tiles-studio/README.md` for details.

## Features

- Native Rust TUI and CLI
- Web-based Tiles Studio with full CLI parity
- Tile layouts: `2x1`, `1x2`, `2x2`, `3x1`, `1x3`, `3x3`, `pip`, `1+2`, `2+1`, `1+3`
- Distribution: `none`, `round-robin`, `sequential`, `random`, `shuffle-round-robin`
- Crop modes: `crop`, `pad`, `stretch`
- Per-tile transitions (`cut`, `fade`, `fadeblack`) and crop positions
- Audio tile mix controls
- Scene detection and splitting (ffmpeg-based)
- Folder tools: clean, trim, concat, landscape organizer, slowmo, CFR doctor
- Menu-run logging to `outputs/tui-logs/`

## Project Layout

```text
.
├── apps/
│   ├── tiles-api/        # Axum REST API for Tiles Studio
│   ├── tiles-studio/     # React + Vite web UI
│   └── tiles-tui/        # Native Rust CLI and TUI
├── configs/              # Saved tile settings JSON
├── docs/                 # Documentation
├── outputs/              # Global output folder
└── src/                  # Source media projects
```

## Notes

- Folder names without `/` are resolved under `src/` when present.
- `VIDEO_TILING_SETTINGS_PATH` can override default settings path.
- `VIDEO_TILING_NO_OVERWRITE=1` enables no-overwrite behavior by default for tile runs.
