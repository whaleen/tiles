# tiles

A work-in-progress macOS desktop app for video tile layouts, timeline-based tiled compositions, and ffmpeg-backed batch video workflows. Built with Tauri + React + Vite+.

> **Status:** tiles is pre-beta / active WIP. It is usable for local workflows, but the product model, editor UX, and feature set are still changing quickly. Expect rough edges, missing polish, and occasional workflow resets.

## Install

```bash
brew install whaleen/tap/tiles
```

### First launch (Gatekeeper)

The app is not yet notarized with Apple. On first launch you may see a security warning. To open it:

```bash
xattr -dr com.apple.quarantine /Applications/tiles.app
```

Then launch tiles normally from your Applications folder.

## Current Feature Surface

- Workspace-based project library (`src/`, `outputs/`, `configs/`) with project cards, thumbnails, search, and view modes
- Browse, preview, import, move, rename, and organize video clips inside projects
- Visual Tile Builder with explicit timeline clip instances, named per-project compositions, trim handles, per-tile layouts, waveform strips, and preview rendering
- Tiled layouts including grids, picture-in-picture, stacked layouts, custom layout editing, vertical/social formats, and canvas settings
- ffmpeg-backed actions from the UI: concat, trim, detect, split-detect, transcribe, strip audio, chop, slowmo/speed-related workflows, loop, crop, clean, re-encode, URL import, and tiled render/export
- Output explorer with thumbnails, logs, active job progress, and backfill tools
- Workspace switching and basic UI state persistence, including returning to the last workspace location
- In-app updates — new versions prompt automatically on launch

See [docs/status.md](docs/status.md) and [SPEC.md](SPEC.md) for the current product contract and feature status.

## Product Direction

tiles is intended to stay a normal visual video app first: users should be able to organize clips, build compositions, preview, and render without leaving the app.

Major planned directions:

- **Editor-first Tile Builder** — converge on explicit, non-destructive timeline compositions rather than legacy/random folder-generation UI.
- **Agent-drivable project model** — the desktop app is one surface on top of structured workspace/project data. Over time, the CLI/API and composition files should become stable enough for agents and scripts to inspect projects, understand edits, create draft compositions, run previews, and report changes without GUI automation.
- **Agent-assisted workflows** — agents can propose draft compositions, run preview renders, and summarize changes while the human remains in control of accepting or modifying the result. See [docs/agent-workflows.md](docs/agent-workflows.md).
- **Audio editing roadmap** — waveform display now; future work may include loudness matching, per-clip gain/mute, and volume automation. Audio library/engine choice is intentionally deferred. See [docs/audio-roadmap.md](docs/audio-roadmap.md).
- **CLI/API substrate** — `tiles-cli` remains the render/action engine and a future safe interface for scripts and agents, while the app remains the primary user-facing editor.

## Requirements

- macOS
- `ffmpeg` installed via Homebrew:

```bash
brew install ffmpeg
```

## Updates

When a new version is available, tiles will show a banner in the top of the app window. Click **Install update** and then **Relaunch** when prompted.

## Project Layout

```text
.
├── src/          # React frontend
├── src-tauri/    # Rust backend + Tauri config
├── cli/          # tiles-cli sidecar (Rust, built separately)
└── docs/         # Project documentation
```

## Development

This repo uses pnpm and Vite+ (`vp`). `tiles-cli` is a Rust sidecar that must be compiled before running the app. The binary is not committed — build it first:

```bash
pnpm install
pnpm build:cli  # compiles cli/ and copies binary to src-tauri/binaries/
pnpm dev        # Tauri desktop app + Vite+ dev server
```

Useful scripts:

```bash
pnpm dev:web    # frontend-only Vite+ dev server
pnpm lint       # ESLint
pnpm check      # Vite+ check/format analysis
pnpm build      # production Tauri app bundle
```

`pnpm dev` uses the local `@tauri-apps/cli` from `node_modules` — not any globally installed Tauri. You don't need Tauri on your PATH.

### Agent / human-in-the-loop iteration workflow

For UI and workflow changes, prefer small reviewable chunks. Ask the human to validate visual behavior in the dev app when it matters; agents should not start or restart `pnpm dev` unless asked.

After an approved chunk, use the lightest validation that fits the change. For release candidates or broad integration changes, build the production bundle and test that directly. Replace `/Applications/tiles.app` only after the built bundle has been approved.

### Build and test a production bundle

**1. Build**

```bash
pnpm build
```

The app bundle lands at `target/release/bundle/macos/tiles.app` (the Cargo workspace puts `target/` at the repo root, not inside `src-tauri/`).

**2. Run the bundle directly (without installing)**

```bash
open target/release/bundle/macos/tiles.app
```

**3. Replace the installed app in /Applications**

Remove the old version first, then copy the new bundle into `/Applications/`:

```bash
rm -rf /Applications/tiles.app
cp -r target/release/bundle/macos/tiles.app /Applications/
xattr -dr com.apple.quarantine /Applications/tiles.app
```

Note: use `/Applications/` as the destination (not `/Applications/tiles.app`) — `cp -r` creates `tiles.app` inside it.

## Release

Push a version tag to trigger the GitHub Actions release pipeline:

```bash
git tag v0.x.x && git push origin v0.x.x
```

This builds a universal macOS DMG, uploads it to GitHub Releases, updates the Homebrew cask, and publishes the in-app updater manifest.
