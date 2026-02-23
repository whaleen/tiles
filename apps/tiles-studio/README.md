# Tiles Studio

Web-based UI for the Tiles video processing toolkit. Built with React, Vite, Tailwind CSS, and shadcn/ui, backed by an axum API server.

## Run

The API server serves both the REST API and the built frontend.

```bash
# from repo root
cargo run -p tiles-api
```

For frontend development:

```bash
cd apps/tiles-studio
npm install
npm run dev
```

## Architecture

- **Frontend**: React + TypeScript + Vite, styled with Tailwind CSS and shadcn/ui components.
- **API**: Rust axum server (`apps/tiles-api/`) that wraps the `tiles` CLI binary, manages projects, serves media, and streams action results.

## Pages

### Library

Browse projects and their videos in a thumbnail grid. Search and filter by name. Select individual videos or entire folders, then run any action on the selection via the action panel that appears below.

### Actions

All CLI commands exposed as cards with human-readable labels and descriptions. Click a card to open its form. Each form shows:

- A description of what the action does and when to use it
- Target selection (clickable folder chips for the Actions page; pre-populated from Library selections)
- Action-specific parameters with sensible defaults
- Output mode selector with contextual help text

### Tile Builder

Visual editor for tiled video compositions:

- **Layout picker**: Choose from grid, PiP, and hybrid layouts
- **Grid preview**: See tile arrangement with assigned folder names
- **Folder assignment**: Assign project folders to each tile position
- **Global settings**: Crop mode (crop/pad/stretch), distribution mode (none/round-robin/sequential/random/shuffle-round-robin), audio controls, duration limits
- **Per-tile settings**: Transitions (none/cut/fade/fade to black), crop position, speed, video/image mode, landscape toggle
- **Render controls**: Preview/fast-preview/full mode, skip-existing and force-CFR toggles

### Output Explorer

Browse outputs from all runs. Merges project-level outputs (`src/*/outputs/`) and global outputs (`outputs/`).

### Log Viewer

Review the full stdout/stderr log for every action run from the studio.

## Output Modes

| Mode | Behavior |
| --- | --- |
| Save alongside originals | Creates an `outputs/` subfolder next to source files |
| Save to project outputs folder | Writes to the shared `outputs/` folder at the project root |
| Custom path | User specifies a relative path |
| Overwrite originals | Replaces original files in place (irreversible) |

## Targeting Videos

- **Whole folders**: Select folders on the Actions page by clicking the folder chips.
- **Individual videos**: Select specific videos in the Library tab, then pick an action from the panel that appears. The selected videos are passed directly as targets.
- No manual path typing required for normal workflows.
