# Session Handoff — tiles v0.1.5 / Editor + Agent-Ready Direction

## Repo State

- Branch: `main`
- Working tree: clean at handoff
- Remote: `origin/main` is up to date
- Latest release: `v0.1.5` shipped successfully via GitHub Actions
- Release assets and Homebrew updater manifest were published successfully

## Current Product Direction

See:

- `SPEC.md`
- `README.md`
- `docs/status.md`
- `docs/agent-workflows.md`
- `docs/audio-roadmap.md`

Key direction:

- tiles is a visual macOS video workspace first.
- Tile Builder is now editor-first: explicit, non-destructive timeline clip instances are the normal model.
- Legacy/random/shuffle generation is no longer surfaced in the frontend Tile Builder. CLI legacy support remains for scripts/backward compatibility.
- The app is becoming agent-drivable: desktop UI is one surface over structured workspace/project/composition data; CLI/API/composition files should become stable enough for agents/scripts to inspect, propose drafts, render previews, and report changes without GUI automation.
- Agent work should produce reviewable artifacts/draft compositions, not silently mutate active edits or source media.

## Major Work Landed This Session

### Release / docs

- Released `v0.1.5` successfully.
- Refreshed `README.md` to mark tiles as pre-beta / active WIP.
- Added/updated product direction docs:
  - agent-drivable project model
  - human-in-the-loop agent workflows
  - audio editing roadmap

### Workspace/project UI

- Workspace Home project list now has view modes: list / small cards / large cards.
- App UI state persistence added:
  - restores last workspace location / selected project / active tab
  - preserves Workspace Home view mode
- Tile Builder editor workspace state persistence added:
  - timeline zoom
  - playhead
  - audio waveform strip open/closed
  - preview-hidden tiles
  - tile-info overlay visibility

### Tile Builder editor model

- Legacy Edit/Shuffle toggle removed from Tile Builder UI.
- Frontend Tile Builder now behaves as edit-mode-only.
- Explicit timeline model is the source of truth.
- Selected clip source-window inspector added:
  - edits existing `TimelineClipEntry.trim_in` / `trim_out`
  - no `start_offset` per-tile model was added
  - source media remains untouched
- Preview overlays/guides cleanup:
  - safe-zone overlay support
  - tile info/footer toggle
  - footer now hover-revealed to reduce content obstruction on padded/small tiles
- Safe zones added as composition metadata:
  - `show_safe_zones`
  - `safe_zone_type`
  - preview-only; no render/export change
- Per-boundary transitions are still open as GitHub issue `#9` and should be treated as medium-risk model + renderer work.

### Audio / waveform

- Cached waveform strips added under Tile Builder tracks.
- Waveforms are source-owned cached media assets, not composition data.
- Audio strip display uses the shared timeline resolver and clip source windows.
- No mute/gain/audio editing yet.
- Audio roadmap documented in `docs/audio-roadmap.md`.

### Actions / outputs / UX fixes

- Outputs delete now uses a confirmation dialog instead of immediate/window confirm behavior.
- Shared Input defaults disable autocapitalize/autocorrect/spellcheck; callers can override.
- Slow Motion action was reframed as Speed:
  - UI supports slowdown and speed-up factors
  - CLI/action id compatibility preserved (`slowmo` remains internally)

### Transcript support

- Transcript action now recommends JSON by default while preserving txt/srt/vtt options.
- Single-video editor now has a transcript viewer:
  - supports whisper.cpp JSON shape: `{ transcription: [{ offsets: { from, to }, text }] }`
  - also supports generic `{ segments: [{ start, end, text }] }`
  - supports VTT/SRT cues and txt fallback
  - search/filter
  - click timestamped segment to seek video
- No transcript-to-timeline creation yet.
- No agent automation yet.

### Test foundation

- Vitest added with pure-logic tests only.
- Current coverage includes:
  - timeline resolver / trim math / clip width / active clip lookup
  - UI persistence key helpers / read fallback behavior
  - transcript parsing
- GitHub issue `#2` remains open for broader test suite expansion.

## GitHub Issue Triage

Open/important:

- `#9` — Tile Builder per-boundary transitions between timeline clips
  - Keep open.
  - Do after stabilization/testing.
  - Data model + frontend + CLI render work; not tiny UI polish.

- `#4` — AI actions epic
  - Keep open as umbrella.
  - Scaffold phases A-D are complete in dry-run form.
  - Future work should be provider-specific live execution issues.

- `#2` — Vitest suite
  - Keep open.
  - First foundation landed, but broader suite remains.
  - Next high-value tests: more resolver/render assumptions, transition-related logic, hook behavior if a React test harness is added.

Closed:

- `#5` — AI actions A scaffold closed as complete.

## Agent Inbox Triage

The actual inbox data lives in `.agent/inbox/feedback.jsonl` and is gitignored. Read `.agent/inbox/README.md` first before working inbox items.

Recently completed from inbox:

- Confirm before deleting outputs
- Disable autocapitalize/autocorrect in text inputs
- Rename Slow Motion to Speed / allow speed-up
- Vertical safe zones first pass
- Per-Tile Start Offset reframed as selected-clip source-window inspector
- Unified Transcript Support Phase 1+2

Remaining relevant follow-ups / not yet designed:

- Transcript segment → Tile Builder clip/draft composition creation
  - Do not implement silently.
  - Should create reviewable clip instances/drafts.

- Per-boundary transitions
  - Prefer GitHub issue `#9` as source.

- Vertical/reaction layout presets
  - Deferred from safe-zone work.
  - Needs layout-tree/preset planning.

- Audio editing
  - Roadmap only; do not pick audio library yet.
  - Likely future: normalization, gain/mute, volume automation.

## Suggested Next Session Path

Recommended safe sequence:

1. Push/verify current state if needed (`git status -sb`, `git log origin/main..HEAD`).
2. Run quick validation if starting implementation:
   ```bash
   pnpm exec tsc --noEmit --pretty false
   pnpm test -- --run
   cargo check
   ```
3. Decide between:
   - small polish: transcript active highlight / next search match / viewer UX
   - test hardening: more Vitest around resolver transition assumptions
   - model work: per-boundary transitions (`#9`), but only with a clear plan
4. Avoid implementing transcript-to-timeline or agent draft creation without a focused design step.

## Common Commands

```bash
pnpm install
pnpm dev        # Tauri app + Vite dev server; do not start unless user asks
pnpm dev:web
pnpm exec tsc --noEmit --pretty false
pnpm test -- --run
pnpm lint       # currently 0 errors, 10 known warnings
cargo check
pnpm build
```

## Important Constraints / Gotchas

- Do not reintroduce frontend Shuffle/randomized Tile Builder UI.
- Do not modify/delete source media for timeline operations.
- Composition state affects render/export and belongs in composition JSON.
- Editor UI state belongs in frontend UI persistence/localStorage.
- Safe zones are composition metadata but preview-only for now.
- Tile info/footer visibility is editor UI state, not composition metadata.
- Transcript-derived edits must be reviewable draft/clip-instance changes later.
- App is not notarized; first launch may require clearing quarantine.
