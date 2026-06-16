# Agent-Assisted Workflows

Product direction for tiles: keep the human editor in control while making projects structured enough for agents to safely help.

This is not primarily a promise that tiles will "make videos for you." The core value is a human-in-the-loop workflow where a person edits visually in the app, and an agent can inspect the same project, propose changes, run previews, and leave reviewable drafts.

## Product Thesis

Most video editors are GUI-first with opaque project state. tiles is different because projects are workspace-based, compositions are data-driven, actions are deterministic, and renders already run through `tiles-cli`/ffmpeg. That makes tiles a good environment for agent collaboration without requiring agents to click around the UI.

The intended user experience is:

1. The user works normally in the visual app.
2. The user asks an agent for a bounded assist: rough cut, variant, cleanup, trim pass, organization, preview render, etc.
3. The agent reads project state through stable files/APIs/CLI commands.
4. The agent creates or updates a reviewable draft, usually as a separate named composition.
5. The app shows what changed, generated previews/logs, and any risks.
6. The user accepts, edits, duplicates, rejects, or asks for another pass.

## Design Principles

- **Human approval first** — agent work should produce drafts/proposals, not silently replace the user's active edit.
- **Reviewable artifacts** — changes should be visible as named compositions, output previews, logs, summaries, or diffs.
- **Non-destructive by default** — source media should not be overwritten or deleted unless the user explicitly chooses a destructive action.
- **App remains primary** — the CLI/API exists so agents and power users can operate safely, but the user should not need to leave the app.
- **Deterministic operations** — prefer structured inputs, dry-runs, previews, and reproducible action logs over opaque magic.
- **Scoped assists** — emphasize rough cuts, variants, organization, batch cleanup, and repetitive edits before claiming taste-perfect creative direction.

## Future Capability Shape

The existing `tiles-cli` is already useful for render/action execution. To fully support agent collaboration, future CLI/API work should move toward a safe project API:

- list projects, folders, clips, durations, outputs, and compositions
- read the active composition and project metadata
- create/duplicate/rename/delete draft compositions
- apply timeline/layout/folder-assignment edits to a draft composition
- validate edits and run dry-runs without rendering
- run fast preview renders and full renders
- report changed files, changed composition fields, logs, warnings, and residual risks
- require explicit opt-in for overwrite/destructive source-media operations

## Example Workflows

- "Make a fast 2x2 draft from these folders and render a preview."
- "Create three alternate tile layouts using the same source clips."
- "Trim obvious dead starts, but leave the originals untouched."
- "Organize landscape clips into a subfolder and show me what moved."
- "Find long clips, split likely scenes, and make a review composition."
- "Render a low-res preview of the active composition, then summarize any failures."

## Relationship to the CLI

The CLI should be treated as the agent-facing substrate, not as the product surface users must learn. The visible product feature is collaborative editing with approval checkpoints. The implementation can use CLI commands, local project files, Tauri commands, and logs as needed.
