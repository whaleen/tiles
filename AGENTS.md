# Project Agent Context

## What This Project Is

tiles is a macOS desktop app for video tile layouts and batch video processing. It lets users browse video projects, build tiled compositions from multiple folders (2x1, 2x2, pip, etc.), and run ffmpeg-backed actions like concat, trim, slowmo, and more. The app is distributed via Homebrew and updates itself in-app.

## Stack

- **Frontend**: React + TypeScript + Vite+ + Tailwind CSS + shadcn/ui
- **Backend**: Rust (Tauri v2 commands, Axum-based embedded media server)
- **Desktop shell**: Tauri v2
- **Package manager**: pnpm (frontend), Cargo (Rust)
- **Frontend tooling**: Vite+ (`vp`) scripts
- **Build**: Tauri CLI via pnpm scripts
- **Release**: GitHub Actions → GitHub Releases → Homebrew tap → in-app updater

## Repo Layout

```text
src/                        # React frontend
  components/               # UI components
  hooks/                    # React hooks (use-updater, use-workspace, etc.)
  pages/                    # Page-level components
src-tauri/
  src/
    commands/               # Tauri command handlers (one file per domain)
      actions.rs            # run_action, list_actions, list_running_actions
      feedback.rs           # agent inbox / feedback records
      folders.rs            # create/rename/move/delete folders, video moves
      health.rs             # get_health
      logs.rs               # list_logs, get_log
      outputs.rs            # list_outputs, list_output_tree, delete_output
      projects.rs           # list/get/create projects, project meta, compositions
      providers.rs          # AI provider config
      settings.rs           # get/put settings, list layouts
      url_import.rs         # import video from URL
      videos.rs             # list_videos, get_video_info, delete_video,
                            #   get_video_durations, get_filmstrip
      workspace.rs          # get/set/pick workspace, default path
      mod.rs                # command module re-exports
    services/               # Non-command backend services
      ffprobe.rs            # ffprobe duration/metadata probing
      filmstrip.rs          # ensure_filmstrip() — sprite-sheet generation
      fs_scanner.rs         # workspace filesystem scanning
      runner.rs             # spawn tiles-cli, stream stdout/stderr, parse progress
      thumbnail.rs          # ensure_thumbnail / ensure_frame_thumbnail
    media.rs                # Embedded Axum media server (thumbs, frames, filmstrips)
    models.rs               # Shared data models
    prefs.rs                # Persist workspace path to app data dir
    protocol.rs             # Custom streamfile:// URI scheme (video serving)
    state.rs                # AppState (root path, tiles bin, video + duration caches)
    lib.rs                  # Tauri app entry, plugin registration, command list
  Cargo.toml
  tauri.conf.json           # Bundle config, updater pubkey, endpoints
  capabilities/
    default.json            # Tauri capability permissions
docs/                       # Project documentation
SPEC.md                     # Feature spec
AGENTS.md                   # This file
```

## Running Locally

```bash
# Install frontend deps
pnpm install

# Build/copy the tiles-cli sidecar used by Tauri
pnpm build:cli

# Run dev (Tauri + Vite+ hot reload)
pnpm dev

# Frontend-only Vite+ dev server
pnpm dev:web

# Typecheck / Vite+ checks
pnpm check

# Lint
pnpm lint

# Build production app
pnpm build
```

## Agent / Human-in-the-loop Iteration

For UI and workflow changes, prefer small reviewable chunks. Ask the human to validate visual behavior in the dev app when it matters; do not start or restart `pnpm dev` unless asked.

After an approved chunk, use the lightest validation that fits the change. For release candidates or broad integration changes, run `pnpm build` and have the human test `target/release/bundle/macos/tiles.app` directly.

Only replace `/Applications/tiles.app` after the built bundle has been approved:

```bash
rm -rf /Applications/tiles.app
cp -r target/release/bundle/macos/tiles.app /Applications/
xattr -dr com.apple.quarantine /Applications/tiles.app
```

> `tiles-cli` is bundled as a Tauri sidecar — no PATH setup needed.
> ffmpeg must be installed separately: `brew install ffmpeg`

## Workspace

On first launch the user picks a workspace folder (defaults to `~/Movies/tiles`). The workspace contains:

```text
~/Movies/tiles/          # or user-chosen path
  src/                   # Source video projects (each subfolder = one project)
    project-a/
    project-b/
  outputs/               # All rendered outputs
  configs/               # Saved tile builder settings
```

The workspace path is persisted to `~/Library/Application Support/com.whaleen.tiles/prefs.json`. Changing it: delete that file and relaunch, or use the settings UI (if implemented).

## Shared State

`AppState` in `state.rs` holds:
- `root: Arc<RwLock<PathBuf>>` — workspace root, shared with the media server
- `tiles_bin: PathBuf` — path to the `tiles` binary
- `running_actions` — currently running ffmpeg jobs
- `video_cache` — cached video-list scans, keyed by (project, search, folder, recursive)
- `duration_cache` — per-file ffprobe durations, keyed by src-relative path → (mtime, seconds); read via `state.get_durations(&rel_paths)`

All command handlers read `state.root.read().unwrap()` at the top of the function to get the current workspace path.

Filmstrip sprite sheets and playhead frame thumbnails are cached **on disk** (not in `AppState`) under `outputs/tui-thumbs/filmstrips/` and `outputs/tui-thumbs/frames/`, keyed by source mtime.

## Release Process

```bash
git tag v0.x.x
git push origin v0.x.x
```

GitHub Actions builds a universal macOS app bundle + DMG, uploads to GitHub Releases, updates the Homebrew cask in `whaleen/homebrew-tap`, and publishes `tiles-latest.json` for the in-app updater.

## Gotchas

- **Workspace root is a `RwLock`** — always read it at the top of a handler; never store a reference across an await point.
- **Cargo workspace** — `target/` is at the repo root, not inside `src-tauri/`.
- **`tiles-cli` sidecar** — bundled in `src-tauri/binaries/`, resolved at startup by `find_tiles_bin()` in `lib.rs`. Dev prefers `target/debug/tiles-cli` next to the Tauri executable when present, so run `pnpm build:cli`/copy a fresh sidecar after CLI changes before validating through `pnpm dev`. Falls back to PATH if not found next to the executable.
- **Media server** — runs on a random port chosen at startup (`media::pick_port()`). The port is shared via `MediaPort` state and exposed as the `media_port` Tauri command.
- **Action progress** — `tiles-cli` emits `TILES_PROGRESS {json}` lines; Tauri streams stdout/stderr in `services/runner.rs`, parses those lines into `RunningAction.progress`, and the Outputs page renders progress bars/messages. Long `FFmpegPipeline` encodes use ffmpeg `-progress pipe:2` when duration is known and roll in-file percent/ETA into the overall action percent.
- **Vite+ check** — `pnpm check` includes Vite+ formatting analysis and may report broad pre-existing formatting drift. Use `pnpm lint`, `pnpm exec tsc --noEmit`, and Cargo checks for targeted validation unless the task is explicitly to format the whole repo.
- **Video thumbnails** — served by the embedded media server (HTTP, fine for images). Source video files are served via the `streamfile://` custom URI scheme to avoid WKWebView mixed-content blocking.
- **Filmstrip scrub** — WKWebView won't repaint a *paused* `<video>` after a `currentTime` seek, so the tile-builder preview never scrubs by seeking. Playback blits decoded frames onto a canvas (`drawImage(video)`); scrubbing the playhead blits a cell from a backend sprite sheet (`get_filmstrip` → `/filmstrips/`). Source time → cell index → `drawImage`, instant and decode-free.
- **`Image` is shadowed in `tile-grid-preview.tsx`** — the `lucide-react` `Image` icon import shadows the browser `Image` constructor. Use `document.createElement("img")`, never `new Image()`, in that file (the latter `new`s a React component and throws during effect mount).
- **Imperative playhead** — the timeline playhead is a `MutableRefObject<number>` read by a rAF loop, not React state; state only commits at clip boundaries to avoid 60fps re-renders of the heavy preview tree.
- **Compositions** — named save/load of the full `TileSettings` + timeline clip ordering/trims, persisted in project meta (`active_composition`, `timeline_clips`). CRUD commands live in `commands/projects.rs` and are registered in `lib.rs`.
- **App is not notarized** — users need `xattr -dr com.apple.quarantine /Applications/tiles.app` on first launch.
- **`GH_PAT`** secret (not `GITHUB_TOKEN`) is required for the release workflow to push to the homebrew tap repo.

## Spec

See [SPEC.md](SPEC.md) for the current feature checklist.
