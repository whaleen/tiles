# tiles-tui

Primary Rust TUI/CLI crate for `tiles`.

## Run

```bash
# from repo root
cargo run -p tiles-tui --bin tiles

# or from this crate directory
cd apps/tiles-tui
cargo run --bin tiles
```

## Commands

```bash
# default launches native interactive menu
cargo run --bin tiles

# explicit native menu
cargo run --bin tiles -- tui

# tool CLIs
# concat + trim + clean + detect are native Rust now:
cargo run --bin tiles -- concat ready couch -o outputs/concatenated --transition fade --duration 1.0
cargo run --bin tiles -- trim ready --start 0.5 --end 0.25 -o outputs/trimmed
cargo run --bin tiles -- clean ready -m 3 -n
cargo run --bin tiles -- detect ready --threshold 0.27 --list-only

# native tiler
cargo run --bin tiles -- tile folder1 folder2 --layout 2x1 -o outputs/tiled/my_tiled.mp4
cargo run --bin tiles -- tile folder1 --layout 2x2 --distribution-mode shuffle-round-robin --max-duration 12 --no-overwrite
cargo run --bin tiles -- tile folder1 --layout 2x2 --distribution-mode round-robin --force-cfr
cargo run --bin tiles -- run --render-mode preview --no-overwrite
cargo run --bin tiles -- doctor-reencode ready --fps 30
cargo run --bin tiles -- doctor-trim-start ready --seconds 1.0
cargo run --bin tiles -- organize-landscape ready
cargo run --bin tiles -- slowmo ready --factor 0.5

# load existing settings JSON
cargo run --bin tiles -- tile --settings configs/tile_videos_settings.json
```

## Interactive Notes

- The native menu now supports folder pickers from `src/` for `concat`, `trim`, `detect`, `clean`, and `tile`.
- Picker mode supports recursive subdirectory selection and index ranges like `1,3-5`.
- In tile wizard picker mode, selection is validated against layout tile count (either `1` folder or exactly the number of tiles).
- Tile menu now includes:
  - quick run
  - run default saved settings (`configs/tile_videos_settings.json` or `VIDEO_TILING_SETTINGS_PATH`)
  - run from settings file
  - create/update settings JSON with per-tile options
  - edit existing settings JSON (prefilled from file)
  - YOLO random run from available `src/` folders
- Tile menu runs now write logs to `outputs/tui-logs/tui_run_*.log`.
- `VIDEO_TILING_NO_OVERWRITE=1` is honored by Rust tile runs.
- Main menu now includes:
  - run saved settings
  - tile workflows
  - concat / trim / detect / clean
  - tools and doctor
  - help
- Tools and Doctor (native Rust):
  - Doctor re-encode CFR
  - Doctor trim start
  - Organize landscape split
  - Slow motion
  - each writes logs to `outputs/tui-logs/tui_*.log`
- `tiles run` and menu runs now log as `outputs/tui-logs/tui_<subcommand>_run_*.log`.
