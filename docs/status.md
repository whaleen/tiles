# Feature Status

Current feature surface for the tiles desktop app.

## App Pages

### Library

Browse all projects and videos in the workspace `src/` folder. Thumbnail grid with search and filter. Select individual videos or entire folders to run actions. Drag-and-drop folder reordering, timeline strip view, and a full video editor with per-video actions (trim, slowmo, crop, etc.).

### Tile Builder

Visual layout picker — choose a grid (`2x1`, `1x2`, `2x2`, `3x1`, `1x3`, `3x3`) or composition (`pip`, `1+2`, `2+1`, `1+3`). Assign workspace folders to each tile slot. Configure per-tile settings (transitions, crop position, speed, mode) and global settings (crop mode, distribution mode, audio, duration limits). Render in preview or full mode.

Settings are saved to `configs/tile_videos_settings.json` in the workspace.

### Actions

All video actions as cards. Click to open a form with folder/video selection, parameters, and output mode. See [actions.md](actions.md) for the full action list.

### Outputs

Browse all generated outputs in the workspace `outputs/` folder. Includes active action cards with streamed progress/message updates plus a log viewer for reviewing stdout/stderr from any action run.

### Import

Two import modes:

- **URL import** — paste a URL (YouTube, Vimeo, X, or any yt-dlp-supported source), configure quality and tiling settings, download and process via `yt-import`.
- **Local files** — pick video files from the filesystem and copy them into the current project. Also available as "Import files here" on the folder context menu in the Library.

## Actions

See [actions.md](actions.md) for descriptions and parameters.

| Action | Target |
| --- | --- |
| `concat` | Folders |
| `trim` | Folders or videos |
| `detect` | Folders or videos |
| `split-detect` | Folders or videos |
| `yt-import` | URL |
| `strip-audio` | Folders or videos |
| `chop` | Folders or videos |
| `transcribe` | Folders or videos |
| `tile` | Settings (tile builder) |
| `run` | Settings (re-render saved config) |
| `yolo` | Settings (random layout) |
| `clean` | Folders |
| `doctor-reencode` | Folders or videos |
| `slowmo` | Folders or videos |
| `loop` | Folders or videos |
| `crop` | Folders or videos |
| `organize-landscape` | Folders |

## Output Modes

| Mode | Label | Behavior |
| --- | --- | --- |
| `source` | Save to project outputs folder | `src/<project>/outputs/<action>/` |
| `global` | Save to outputs folder | `outputs/<action>/` |
| `alongside` | Save next to originals | Same directory as source files |
| `custom` | Custom path | User-specified relative path |
| `overwrite` | Overwrite originals | Replaces source files in place |

## Action Progress

Actions emit structured progress as stdout lines prefixed with `TILES_PROGRESS `. Tauri streams action stdout/stderr, parses the JSON payload into `RunningAction.progress`, and the frontend polls `list_running_actions` to update the active job cards. Long `FFmpegPipeline` encodes now attach ffmpeg `-progress pipe:2` reporting where durations are known, roll the in-file percent into the overall action percent, and include a short per-file percent/ETA in the progress message. Non-ffmpeg work still reports per input file, URL, tile, or stage.

## In-App Updates

When a new version is published, a banner appears at the top of the app. Click **Install update** to download, then **Relaunch** when ready. The update manifest is hosted at `tiles-latest.json` in the Homebrew tap.
