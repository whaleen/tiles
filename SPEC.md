# Project Spec

Feature source of truth for the tiles Tauri desktop app. Update as features ship, change, or get cut.

## Core Flows

- [x] First launch: workspace picker — user chooses folder (default `~/Movies/tiles`), persisted to prefs
- [x] Library: browse projects and videos with thumbnail grid, folder tree, search/filter
- [x] Tile Builder: visual layout picker, per-tile folder assignment, settings, render
- [x] Actions: run batch video operations (concat, trim, slowmo, etc.) on selected folders/videos
- [x] Outputs: browse rendered files, view logs
- [x] In-app updates: banner on launch when new version available, one-click install + relaunch
- [ ] Workspace settings: change workspace folder from within the app (currently requires manual prefs edit)

## Functional Requirements

- [x] Workspace root is mutable at runtime — all commands read from `Arc<RwLock<PathBuf>>`
- [x] Workspace subdirs (`src/`, `outputs/`, `configs/`) are created automatically on workspace set
- [x] Video thumbnails served by embedded Axum media server on a random port
- [x] Running actions tracked in `AppState` — can list in-progress jobs
- [x] Project metadata stored as JSON alongside project folder
- [x] Folder ordering persisted per-project (timeline ordering, drag-and-drop)
- [x] Tile builder settings saved to `configs/tile_videos_settings.json` in workspace
- [x] Output tree browsable with per-run log access
- [ ] Tile builder: per-tile transition preview
- [ ] Multiple saved tile configs (currently single settings file)
- [x] Video preview / playback — per-video editor with inline player and visual action tools (trim, slowmo, crop, loop)
- [ ] Workspace history — quick-switch between recent workspaces

## Non-Functional Requirements

- macOS only (Apple Silicon + Intel universal binary)
- ffmpeg must be installed separately (`brew install ffmpeg`)
- App distributed via Homebrew: `brew install whaleen/tap/tiles`
- In-app updater via Tauri updater plugin + `tiles-latest.json` manifest in homebrew tap
- App is not notarized — first-launch Gatekeeper bypass required

## Nice To Have

- App notarization (removes Gatekeeper friction)
- Drag-and-drop video import into workspace
- Progress bar for long-running ffmpeg actions
- Multiple tile settings configs
- Workspace change UI (no manual prefs delete required)

## Known Issues

- App not notarized — requires `xattr -dr com.apple.quarantine /Applications/tiles.app` on first launch
- Single tile settings config (`configs/tile_videos_settings.json`) — no multi-config support yet
- Images in library are listed alongside videos but most actions silently skip them
