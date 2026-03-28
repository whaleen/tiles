# Project Agent Context

## What This Project Is

tiles is a macOS desktop app for video tile layouts and batch video processing. It lets users browse video projects, build tiled compositions from multiple folders (2x1, 2x2, pip, etc.), and run ffmpeg-backed actions like concat, trim, slowmo, and more. The app is distributed via Homebrew and updates itself in-app.

## Stack

- **Frontend**: React + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **Backend**: Rust (Tauri v2 commands, Axum-based embedded media server)
- **Desktop shell**: Tauri v2
- **Package manager**: npm (frontend), Cargo (Rust)
- **Build**: Tauri CLI via `npm run tauri`
- **Release**: GitHub Actions → GitHub Releases → Homebrew tap → in-app updater

## Repo Layout

```text
apps/
  tiles-tauri/
    src/                    # React frontend
      components/           # UI components
      hooks/                # React hooks (use-updater, use-workspace, etc.)
      pages/                # Page-level components
    src-tauri/
      src/
        commands/           # Tauri command handlers (one file per domain)
          actions.rs        # run_action, list_actions, list_running_actions
          folders.rs        # create/rename/move/delete folders, video moves
          health.rs         # get_health
          logs.rs           # list_logs, get_log
          outputs.rs        # list_outputs, list_output_tree, delete_output
          projects.rs       # list/get/create projects, project meta
          settings.rs       # get/put settings, list layouts
          videos.rs         # list_videos, get_video_info, delete_video
          workspace.rs      # get/set/pick workspace, default path
        media.rs            # Embedded Axum media server (serves video files)
        models.rs           # Shared data models
        prefs.rs            # Persist workspace path to app data dir
        state.rs            # AppState (shared root path, tiles bin, video cache)
        lib.rs              # Tauri app entry, plugin registration, command list
      Cargo.toml
      tauri.conf.json       # Bundle config, updater pubkey, endpoints
      capabilities/
        default.json        # Tauri capability permissions
docs/                       # Project documentation
SPEC.md                     # Feature spec
AGENT.md                    # This file
```

## Running Locally

```bash
# Install frontend deps
cd apps/tiles-tauri
npm install

# Run dev (Tauri + Vite hot reload)
npm run dev

# Typecheck
npm run typecheck

# Lint
npm run lint

# Build production app
npm run build
```

> The `tiles` binary (ffmpeg wrapper) must be on PATH for actions to work.
> Install ffmpeg first: `brew install ffmpeg`

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
- `video_cache` — cached video metadata

All command handlers read `state.root.read().unwrap()` at the top of the function to get the current workspace path.

## Release Process

```bash
git tag v0.x.x
git push origin v0.x.x
```

GitHub Actions builds a universal macOS app bundle + DMG, uploads to GitHub Releases, updates the Homebrew cask in `whaleen/homebrew-tap`, and publishes `tiles-latest.json` for the in-app updater.

## Gotchas

- **Workspace root is a `RwLock`** — always read it at the top of a handler; never store a reference across an await point.
- **Cargo workspace** — `target/` is at the repo root, not inside `apps/tiles-tauri/src-tauri/`.
- **Media server** — runs on a random port chosen at startup (`media::pick_port()`). The port is shared via `MediaPort` state and exposed as the `media_port` Tauri command.
- **Video thumbnails** — served by the embedded media server, not the Tauri asset protocol.
- **App is not notarized** — users need `xattr -dr com.apple.quarantine /Applications/tiles.app` on first launch.
- **`GH_PAT`** secret (not `GITHUB_TOKEN`) is required for the release workflow to push to the homebrew tap repo.

## Spec

See [SPEC.md](SPEC.md) for the current feature checklist.
