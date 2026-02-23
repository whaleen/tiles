# Architecture and Feature Completeness Audit

This audit focuses on architecture and feature completeness with a strong emphasis on tiles-studio UX and documentation accuracy. No code changes are proposed here; this is an assessment of current behavior and documented claims.

## Tiles Studio UX

- Library claims “run any action,” but Library bulk actions filter out settings actions (tile/run/yolo), so those cannot be triggered from selection. This conflicts with README claims.
  - `apps/tiles-studio/src/components/library/library-action-panel.tsx`
  - `README.md`
  - `apps/tiles-studio/README.md`

- Output mode defaults diverge from CLI defaults: Studio defaults non-settings actions to `source`, while CLI defaults to global outputs. This breaks parity expectations between Studio and CLI.
  - `apps/tiles-studio/src/components/actions/action-form-wrapper.tsx`
  - `apps/tiles-tui/src/main.rs`

- Studio exposes “Overwrite originals” for all non-settings actions, but CLI only supports overwrite for some tools (trim/strip-audio/doctor/slowmo). For concat/detect/clean/organize-landscape, the flag is unsupported and will be ignored or error.
  - `apps/tiles-studio/src/components/actions/action-form-wrapper.tsx`
  - `apps/tiles-tui/src/main.rs`

- Tile Builder folder assignment is a select list, not drag-and-drop as documented.
  - `apps/tiles-studio/src/components/tile-builder/folder-assignment.tsx`
  - `docs/status.md`

- “Log Viewer tab” described in docs does not exist as a dedicated tab. Logs are embedded in Outputs instead.
  - `apps/tiles-studio/src/pages/outputs.tsx`
  - `README.md`
  - `apps/tiles-studio/README.md`

## Tiles API and Studio Integration

- Source output token mismatch: API runner sends `--output {source}/outputs`, but CLI expects `__source_outputs__`. This likely creates a literal `{source}` folder or fails to resolve the token in CLI runs.
  - `apps/tiles-api/src/services/runner.rs`
  - `apps/tiles-tui/src/main.rs`
  - `docs/file-system.md`

- Action execution is blocking (`Command::output`), so docs that claim “streaming results” are inaccurate.
  - `apps/tiles-api/src/services/runner.rs`
  - `apps/tiles-studio/README.md`

- Default settings response sets `crop_mode: "center"`, which isn’t a valid Tile Builder option (crop/pad/stretch). This can render invalid state on first load.
  - `apps/tiles-api/src/routes/settings.rs`
  - `apps/tiles-studio/src/pages/tile-builder.tsx`

## Outputs and File System

- Docs specify `outputs/<action>/run_<timestamp>` and `src/<project>/outputs/<action>/run_<timestamp>`, but CLI defaults for several tools are flat folders (no run folder):
  - concat -> `outputs/concatenated`
  - trim -> `outputs/trimmed`
  - detect -> `outputs/scenes`
  - strip-audio -> `outputs/strip-audio`
  - This creates doc drift and makes run-based assumptions in UI/log matching unreliable.
  - `docs/file-system.md`
  - `apps/tiles-tui/src/main.rs`

- Output scanning and log matching key off output folder names, which do not match action names (e.g., `concatenated` vs `concat`, `scenes` vs `detect`). Filters and log matching will be inconsistent.
  - `apps/tiles-api/src/services/fs_scanner.rs`
  - `apps/tiles-tui/src/main.rs`

## Documentation Accuracy

- `docs/status.md` says `tiles web` starts API server + Studio frontend. In reality, `tiles web` is a minimal embedded UI in tiles-tui; Studio is served by tiles-api (`cargo run -p tiles-api`).
  - `docs/status.md`
  - `apps/tiles-tui/src/main.rs`
  - `README.md`

## Summary

The core surfaces (Library, Actions, Tile Builder, Outputs) are present, but multiple user-facing expectations are out of sync with CLI behavior and docs. The largest gaps are CLI parity (output modes and overwrite flags), outputs path conventions, and doc claims about UI capabilities (drag-and-drop assignment, dedicated log viewer, streaming action logs).

If desired, a follow-up can prioritize fixes by impact: (1) source output token mismatch, (2) outputs/run folder conventions, (3) Studio UI alignment with CLI feature flags, (4) doc corrections.
