# Project Spec

Feature source of truth for the tiles Tauri desktop app. Update as features ship, change, or get cut.

## Core Flows

- [x] First launch: workspace picker — user chooses folder (default `~/Movies/tiles`), persisted to prefs
- [x] Library: browse projects and videos with thumbnail grid, folder tree, search/filter
- [x] Tile Builder: visual layout picker, per-tile folder assignment, timeline ordering, settings, render
- [x] Actions: run batch video operations (concat, trim, slowmo, etc.) on selected folders/videos
- [x] Outputs: browse rendered files, view logs
- [x] In-app updates: banner on launch when new version available, one-click install + relaunch
- [x] Workspace settings: change workspace folder from within the app (sidebar menu → Change workspace)

## Functional Requirements

- [x] Workspace root is mutable at runtime — all commands read from `Arc<RwLock<PathBuf>>`
- [x] Workspace subdirs (`src/`, `outputs/`, `configs/`) are created automatically on workspace set
- [x] Video thumbnails served by embedded Axum media server on a random port
- [x] Running actions tracked in `AppState` — can list in-progress jobs
- [x] Running action progress streamed from `tiles-cli`/Tauri into the Outputs page (`TILES_PROGRESS` JSON lines; includes ffmpeg in-file percent for long encodes where duration is known)
- [x] Project metadata stored as JSON alongside project folder
- [x] Folder ordering persisted per-project (timeline ordering, drag-and-drop)
- [x] Tile Builder edit mode is deterministic: arranged clips play once in order; shorter tile strips go blank instead of auto-looping
- [x] Tile builder settings saved to `configs/tile_videos_settings.json` in workspace for global/legacy flows, and per-project named compositions under `src/<project>/.tiles/comps/`
- [x] Output tree browsable with per-run log access
- [ ] Tile builder: per-tile transition preview
- [x] Multiple saved tile configs as per-project named compositions (new, save-as, rename, delete, active composition)
- [x] Video preview / playback — per-video editor with inline player and visual action tools (trim, slowmo, crop, loop)
- [x] Local file import — copy videos from the filesystem into any project folder via the Import page or the folder context menu ("Import files here")
- [x] URL import — download videos via yt-dlp (YouTube, Vimeo, X, etc.) from the Import page
- [ ] Workspace history — quick-switch between recent workspaces

## Non-Functional Requirements

- macOS only (Apple Silicon + Intel universal binary)
- ffmpeg must be installed separately (`brew install ffmpeg`)
- App distributed via Homebrew: `brew install whaleen/tap/tiles`
- In-app updater via Tauri updater plugin + `tiles-latest.json` manifest in homebrew tap
- App is not notarized — first-launch Gatekeeper bypass required

## Nice To Have

- App notarization (removes Gatekeeper friction)
- Drag-and-drop video import into workspace (file picker import exists; drag-and-drop is not implemented)
- Composition thumbnails / richer config browser
- Workspace change UI (no manual prefs delete required)

## Known Issues

- App not notarized — requires `xattr -dr com.apple.quarantine /Applications/tiles.app` on first launch
- Legacy global tile-builder flow still uses single `configs/tile_videos_settings.json`; named compositions are project-scoped
- Images in library are listed alongside videos but most actions silently skip them
- Progress remains per action item/stage for non-ffmpeg work and for ffmpeg calls that do not yet provide a known duration to `FFmpegPipeline`
