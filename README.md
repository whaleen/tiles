# tiles

A macOS desktop app for video tile layouts and tiled renders. Built with Tauri + React.

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

## Features

- Browse video projects and clips
- Visual tile layout builder (`2x1`, `1x2`, `2x2`, `3x1`, `1x3`, `3x3`, `pip`, `1+2`, `2+1`, `1+3`)
- Folder management with drag-and-drop ordering
- Run tiled renders and other actions directly from the UI
- Output explorer and log viewer
- In-app updates — new versions prompt automatically on launch

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

`tiles-cli` is a Rust sidecar that must be compiled before running the app. The binary is not committed — build it first:

```bash
npm install
npm run build:cli  # compiles cli/ and copies binary to src-tauri/binaries/
npm run dev
```

`npm run dev` uses the local `@tauri-apps/cli` from `node_modules` — not any globally installed Tauri. You don't need Tauri on your PATH.

### Build and test a production bundle

**1. Build**

```bash
npm run build
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
