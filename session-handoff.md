# Session Handoff — tiles Progress Feature

## Current State

The repo uses pnpm + Vite+ tooling and action progress is implemented end-to-end, including fine-grained ffmpeg progress for long encodes where durations are known.

### Dev Commands

```bash
pnpm install
pnpm build:cli
pnpm dev        # Tauri desktop app + Vite+ dev server
pnpm dev:web    # frontend-only Vite+ dev server
pnpm lint
pnpm exec tsc --noEmit
cargo check -p tiles-cli
cargo check -p tiles-tauri
```

Notes:
- `pnpm dev` is the main human-in-the-loop target.
- `pnpm build:cli` refreshes the Tauri sidecar binaries. In dev, `find_tiles_bin()` prefers the `target/debug/tiles-cli` sidecar next to the Tauri executable, so refresh/copy that sidecar when validating CLI changes through the running app.
- `pnpm check` currently runs Vite+ formatting analysis and may report broad pre-existing formatting drift; do not treat it as a clean required gate unless the task is to format the repo.
- `pnpm lint` passes with warnings only at handoff time.

## Progress Architecture

### CLI → Tauri → UI flow

1. `tiles-cli` emits structured progress lines to stdout:

   ```text
   TILES_PROGRESS {"phase":"Encoding","current":1,"total":4,"percent":25,"message":"Encoding clip.mp4"}
   ```

2. Tauri `src-tauri/src/services/runner.rs` spawns child commands and streams stdout/stderr instead of waiting for `.output()`.
3. `runner.rs` parses `TILES_PROGRESS ` lines into `ActionProgress` and sends updates through an `on_progress` callback.
4. `src-tauri/src/commands/actions.rs` updates the matching `RunningAction.progress` inside `AppState.running_actions`.
5. Frontend `useRunningActions()` polls `list_running_actions`.
6. `src/pages/outputs.tsx` renders active jobs with progress bar, phase badge, output path, message, percent, and current/total.

### Data types

Rust:
- `src-tauri/src/models.rs`
  - `RunningAction.progress: Option<ActionProgress>`
  - `ActionProgress { phase, current, total, percent, message }`

TypeScript:
- `src/types/index.ts`
  - `ActionProgress`
  - `RunningAction.progress?: ActionProgress | null`

## What Is Implemented

Structured per-item/per-stage progress exists for:

- `concat`
- `loop`
- `trim`
- `detect`
- `split-detect`
- `yt-import`
- `strip-audio`
- `doctor-reencode`
- `doctor-trim-start`
- `slowmo`
- `crop`
- `chop`
- `tile`
- `transcribe`

Fine-grained ffmpeg progress is implemented around `FFmpegPipeline` in `cli/src/main.rs`:
- `FFmpegPipeline::with_progress(...)` enables `ffmpeg -progress pipe:2 -nostats` when duration is known.
- Progress parsing supports `out_time_ms`, `out_time_us`, `out_time`, and stderr `time=...` fallback.
- In-file ffmpeg percent is rolled into overall action percent.
- Messages include per-file percent and a short ETA when enough progress has elapsed.
- Tile rendering wires progress through per-tile normalization/prep, per-tile assembly, and final compositing so the Outputs card moves throughout long tile jobs.

Also implemented in this work:
- Editable suggested output file/folder names in action forms.
- Default output mode is project outputs instead of overwrite.
- Run button shows elapsed time and a link to Outputs.
- Outputs page active cards show progress and status.
- Folder thumbnail root/all filter bug fix.
- Folder context menu has Reveal in Finder.
- Docs updated for pnpm/Vite+, progress, and human-in-loop workflow.

## Remaining Follow-Up Ideas

### 1. Cancellation/failure UX

Current behavior:
- Tauri emits final `Complete`/`Failed` from `runner.rs` for sidecar commands.
- Individual CLI action functions emit `Complete` on success.

Still worth verifying/improving:
- Failed actions show a useful failed message in Outputs before disappearing from running list.
- Consider storing recent completed/failed jobs briefly or surfacing toast/log link better.

### 2. UI refinements

Potential refinements:
- Add direct log link/button from active output cards.
- Distinguish indeterminate progress from known percent visually.
- Consider richer ETA display if `ActionProgress` grows a dedicated field later.

Relevant files:
- `src/pages/outputs.tsx`
- `src/hooks/use-running-actions.ts`
- `src/components/actions/action-form-wrapper.tsx`

### 3. Broader manual verification

Run `pnpm dev`, then test actions from Library/Actions/Tile Builder with a small workspace. Confirm:
- Active job appears in Outputs.
- Progress bar moves.
- Message updates.
- Outputs still land where expected.
- Logs still contain full stdout/stderr including `TILES_PROGRESS` lines.

Priority actions to manually test:
- `trim`
- `slowmo`
- `concat`
- `tile`
- `transcribe`
- `yt-import`

## Validation Run

```bash
cargo check -p tiles-cli
cargo check -p tiles-tauri
pnpm exec tsc --noEmit
pnpm lint
pnpm dev
```

Results:
- Cargo checks pass.
- TypeScript passes.
- ESLint passes with warnings only.
- `pnpm dev` starts successfully.
- Local CLI media tests confirmed trim and tile emit moving `TILES_PROGRESS` percent updates through ffmpeg work.

## Known Tooling Notes

- This project uses pnpm and has `pnpm-lock.yaml`; `package-lock.json` was removed.
- Vite config is `vite.config.js` rather than `.ts` because `vp check` had trouble loading the TS config in this environment despite Node reporting a supported version.
- Vite+ currently prints warnings from `@vitejs/plugin-react` about deprecated `esbuild` / `optimizeDeps.esbuildOptions`. Dev still starts.

## Files Most Likely Relevant Next

- `cli/src/main.rs` — CLI action implementations, `FFmpegPipeline`, and `emit_progress`.
- `src-tauri/src/services/runner.rs` — streaming child process output and progress parsing.
- `src-tauri/src/commands/actions.rs` — updates `RunningAction.progress`.
- `src-tauri/src/models.rs` — progress data model.
- `src/pages/outputs.tsx` — active job progress UI.
- `src/components/actions/action-form-wrapper.tsx` — run button, elapsed timer, output naming.
- `src/types/index.ts` — frontend progress types.
