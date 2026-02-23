# Feature Status

This document tracks the current feature surface for the CLI, TUI, and Tiles Studio web UI.

## CLI

- Commands: `tile`, `run`, `yolo`, `concat`, `trim`, `detect`, `strip-audio`, `clean`, `doctor-reencode`, `doctor-trim-start`, `slowmo`, `organize-landscape`.
- Default outputs land under `outputs/<tool>/` unless a custom `--output` is provided. See `docs/file-system.md` for exact paths per action.
- `--overwrite` replaces originals in place (supported by trim and strip-audio; other actions pass through silently).
- Doctor and slowmo actions support `--no-audio` to strip audio during processing.
- Tile/run actions support `--no-overwrite` (skip if output exists) and `--force-cfr`.

## TUI

- Launch: `tiles tui`.
- Folder/video selection from `src/` with interactive prompts.
- Output choices: source outputs (per-folder), global outputs, or custom paths.
- Logs: menu runs write to `outputs/tui-logs/`.

## Tiles Studio (web)

- Launch: `cargo run -p tiles-api` (starts the axum API server which serves the React frontend).
- Note: `tiles web` runs a separate minimal embedded UI in tiles-tui, not the Studio.
- Full CLI parity: every CLI command is available as a studio action with a dedicated form.

### Pages

- **Library**: Browse projects and videos with thumbnail grid, search/filter, multi-select individual videos or folders, then run actions on the selection. Settings-based actions (tile/run/yolo) are not shown here since they don't operate on selections.
- **Actions**: All actions as cards with human-readable labels and descriptions. Click to open a form with folder selection chips, parameters, and output mode picker.
- **Tile Builder**: Visual layout picker, folder assignment via dropdowns, per-tile settings (transitions, crop position, speed, mode), global settings (crop mode, distribution mode, audio controls, duration limits), and render with preview/full modes.
- **Outputs**: Browse and preview all generated outputs. Includes an integrated log viewer for reviewing command stdout/stderr from any studio run.

### Studio Actions

| Action | Label | Target | Description |
| --- | --- | --- | --- |
| `concat` | Concatenate | Folders | Join all videos in a folder into one file with optional transitions (cut, fade, fade to black) |
| `trim` | Trim | Folders or videos | Cut a percentage off the start and/or end of each video |
| `detect` | Detect Scenes | Folders or videos | Find scene boundaries and split videos at each cut point |
| `strip-audio` | Strip Audio | Folders or videos | Remove the audio track, producing silent video files |
| `tile` | Tile | Settings | Render a tiled composition from saved Tile Builder settings |
| `run` | Run Saved Settings | Settings | Quick re-render from saved settings without opening the builder |
| `yolo` | YOLO | Settings | Random layout and folder assignment for a surprise composition |
| `clean` | Clean Filenames | Folders | Remove duplicates (by content hash) and/or rename to numbered sequence |
| `doctor-reencode` | Re-encode (Doctor) | Folders or videos | Re-encode to constant frame rate with configurable FPS |
| `doctor-trim-start` | Trim Start (Doctor) | Folders or videos | Remove N seconds from the beginning of each video |
| `slowmo` | Slow Motion | Folders or videos | Slow videos by a chosen factor (2x, 4x, etc.) |
| `organize-landscape` | Organize by Orientation | Folders | Sort videos into landscape/ and portrait/ subfolders |

## Output Modes

All surfaces support the same four output modes. See `docs/file-system.md` for the full reference.

| Mode | CLI | Studio Label |
| --- | --- | --- |
| Source | `--output __source_outputs__` | Save alongside originals |
| Global | _(default)_ | Save to project outputs folder |
| Custom | `--output <path>` | Custom path |
| Overwrite | `--overwrite` | Overwrite originals |
