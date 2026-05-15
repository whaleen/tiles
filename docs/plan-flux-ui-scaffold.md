# Plan: Flux Image Actions UI Scaffold + ModelsLab API Discovery

## Goal

Build a comprehensive, API-shaped UI scaffold for Flux image actions before making real ModelsLab calls. The goal is to let us explore what controls matter, compare our payload against ModelsLab docs, and be ready to wire/test API calls later without losing context.

This is a continuation of `docs/plan-image-actions.md`.

---

## Current Implementation Snapshot

As of the initial image actions pass:

### Library UI

- `src/pages/library.tsx`
  - Adds media filter buttons: `All`, `Videos`, `Images`.
  - Adds sort dropdown: default order, name A-Z/Z-A, size small/large.
  - Clears selection when media filter changes.

### Action metadata/gating

- Rust `ActionInfo` now has `media_types: Vec<String>`.
- TS `ActionInfo` now has `media_types?: string[]`.
- Existing actions are annotated as `video`, `image`, or `any`.
- `flux-img2img` exists as an image action.
- `src/components/actions/action-capabilities.ts`
  - Adds `mediaTypes` to action capabilities.
  - Exports `actionSupportsMedia()`.
- `LibraryActionPanel` disables incompatible actions based on selected/displayed media.
- `EditorActionPanel` filters actions by active item media type.

### Image editor UI

- `src/components/editor/image-action-panel.tsx`
  - New image action selector.
  - Currently supports `flux-img2img`.
- `src/components/editor/video-editor.tsx`
  - Image detail mode now renders `ImageActionPanel` instead of the old placeholder.
  - `currentProject` is threaded from `library.tsx`.

### Flux frontend form

- `src/components/actions/flux-img2img-form.tsx`
  - Current minimal form:
    - Prompt
    - Strength slider
    - Run button
  - Calls Tauri command `flux_img2img`.

### ModelsLab API key

- `src-tauri/src/prefs.rs`
  - Adds `modelslab_api_key: Option<String>`.
- `src-tauri/src/commands/settings.rs`
  - Adds `get_modelslab_key` and `set_modelslab_key`.
- `src/pages/dashboard.tsx`
  - Adds a simple ModelsLab API key input/save UI.

### Rust command

- `src-tauri/src/commands/image_actions.rs`
  - New `flux_img2img` command.
  - Reads image from workspace.
  - Base64-encodes it into a data URI.
  - Posts to `https://modelslab.com/api/v6/realtime/img2img` using `reqwest`.
  - Polls `fetch_result` if provided.
  - Downloads output URLs into `outputFolder`.

### Validation already run

- `pnpm exec tsc --noEmit` passes.
- `cargo check` passes.
- `pnpm lint` passes with pre-existing warnings only.

---

## Key Product Question

We are not ready to test real calls yet. Before burning credits or debugging API behavior, we want to scaffold a richer Flux UI that mirrors the ModelsLab API as closely as possible.

The scaffold should let us:

1. See every likely API parameter in the UI.
2. Preview the exact JSON payload we would send.
3. Save/edit settings without running the API.
4. Decide which controls belong in the simple UI vs advanced UI.
5. Quickly compare UI state to ModelsLab docs.
6. Later wire a real call with minimal frontend churn.

---

## Primary Source of Truth

Use ModelsLab API docs as the source of truth for exact fields and constraints.

Things to verify from docs before real calls:

- Correct endpoint for Flux img2img.
- Whether Flux img2img is realtime or async-only.
- Whether `init_image` supports:
  - base64 data URI
  - raw base64 string
  - public URL only
- Required payload fields.
- Optional payload fields.
- Exact field names:
  - `model_id` vs `model`
  - `init_image` vs `image`
  - `strength` vs `prompt_strength`
  - `guidance_scale` vs `guidance`
  - `num_inference_steps` vs `steps`
- Supported model IDs.
- Supported dimensions/aspect ratios.
- Max image size.
- Max prompt length.
- Samples/count limits.
- Seed behavior.
- Output format controls.
- Safety/filtering controls.
- Webhook options.
- Polling response shape.
- Error response shape.
- Whether returned output URLs expire.

---

## Proposed UI Direction

### Simple controls, always visible

These are likely to matter for normal use:

- Prompt
- Strength / denoise
- Output size preset
- Run button
- Dry run / Preview payload button or panel

### Advanced controls, collapsible

These should exist in the scaffold but remain tucked away:

- Negative prompt
- Model ID
- Width
- Height
- Samples
- Guidance scale
- Inference steps
- Seed
- Scheduler, if supported
- Output format, if supported
- Safety checker, if supported
- Enhance prompt, if supported
- Webhook URL, if supported
- Track ID / metadata, if supported

### Debug/discovery panel

Add a collapsible section titled something like **API Payload Preview**.

It should show:

- The exact request object, excluding the API key.
- A placeholder for `init_image`, e.g. `"data:image/jpeg;base64,<current image>"`.
- The Tauri command payload separately from the ModelsLab payload if they differ.
- A note that this is a scaffold until verified against ModelsLab docs.

Example preview:

```json
{
  "model_id": "flux",
  "prompt": "...",
  "negative_prompt": "...",
  "init_image": "data:image/jpeg;base64,<image bytes>",
  "strength": 0.75,
  "width": 1024,
  "height": 1024,
  "num_inference_steps": 20,
  "guidance_scale": 7.5,
  "samples": 1,
  "seed": null,
  "output_format": "jpg"
}
```

---

## Proposed Frontend State Shape

Update `FluxImg2ImgForm` to use one options object rather than many separate ad hoc args.

Suggested TypeScript type:

```ts
type FluxImg2ImgOptions = {
  prompt: string;
  negativePrompt: string;
  modelId: string;
  strength: number;
  width: number;
  height: number;
  samples: number;
  guidanceScale: number;
  steps: number;
  seed: string;
  outputFormat: "jpg" | "png" | "webp";
  scheduler: string;
  safetyChecker: boolean;
  enhancePrompt: boolean;
};
```

Notes:

- Keep `seed` as a string in the UI so blank is easy. Convert to number/null before sending.
- Keep enum values loose until confirmed by docs.
- Do not hardcode unsupported ModelsLab options once docs are verified.

---

## Proposed Rust Command Shape

Instead of passing many top-level arguments to `flux_img2img`, switch to an options struct.

Suggested command input:

```rust
#[derive(Debug, Deserialize)]
pub struct FluxImg2ImgOptions {
    pub prompt: String,
    pub negative_prompt: Option<String>,
    pub model_id: String,
    pub strength: f32,
    pub width: u32,
    pub height: u32,
    pub samples: u32,
    pub guidance_scale: f32,
    pub num_inference_steps: u32,
    pub seed: Option<u64>,
    pub output_format: Option<String>,
    pub scheduler: Option<String>,
    pub safety_checker: Option<bool>,
    pub enhance_prompt: Option<bool>,
}

#[tauri::command]
pub async fn flux_img2img(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    image_rel_path: String,
    output_folder: String,
    options: FluxImg2ImgOptions,
) -> Result<FluxImg2ImgResponse, String> {
    // ...
}
```

Then map `FluxImg2ImgOptions` into a ModelsLab request struct.

Important: The internal request struct should follow ModelsLab field names exactly once docs are confirmed. The Tauri command struct can use Rust-friendly names, but `serde(rename = "...")` may be useful if needed.

---

## Suggested Form Layout

### `FluxImg2ImgForm`

File: `src/components/actions/flux-img2img-form.tsx`

Structure:

1. Header/summary
   - Current image name
   - Output folder path
2. Prompt textarea
3. Strength slider
4. Size preset row
   - Presets: `512x512`, `768x768`, `1024x1024`, `1024x768`, `768x1024`, `Custom`
5. Run controls
   - `Preview Payload`
   - `Run Flux Edit`
6. Advanced collapsible
   - Negative prompt
   - Model ID select/input
   - Samples
   - Guidance scale
   - Steps
   - Seed
   - Output format
   - Scheduler
   - Safety checker
   - Enhance prompt
7. Payload preview collapsible

### UX details

- Keep defaults conservative:
  - `modelId: "flux"`
  - `strength: 0.75`
  - `width/height: 1024`
  - `samples: 1`
  - `guidanceScale: 7.5`
  - `steps: 20`
- Disable run when prompt is empty.
- Consider a temporary `dryRunOnly` flag if we want to prevent accidental real API calls.
- Make payload preview copyable.
- API key should never appear in payload preview.

---

## Candidate Models / Presets To Verify

Do not assume these are valid until checked against ModelsLab docs.

Possible model IDs to investigate:

- `flux`
- `flux-dev`
- `flux-schnell`
- `flux-pro`
- any ModelsLab-specific aliases

Possible schedulers to investigate:

- `Euler`
- `Euler a`
- `DPM++ 2M`
- `DDIM`
- Flux-specific scheduler names, if any

Possible output formats:

- `jpg`
- `png`
- `webp`

Possible size constraints:

- Square: `512`, `768`, `1024`
- Portrait/landscape: `768x1024`, `1024x768`
- Any multiples of 8/16/64 depending on backend

---

## Safety / Privacy Notes

- Keep ModelsLab API key in Rust prefs, not frontend local storage.
- Do not show API key in payload preview.
- Image data should be read and encoded in Rust.
- UI preview should show a placeholder for image bytes, not actual base64.
- Validate paths in Rust:
  - no `..`
  - no absolute paths
  - source must exist under workspace `src/`
  - output must stay inside workspace

---

## Open Questions

### API behavior

- Does ModelsLab require `init_image` to be publicly accessible, or is base64 accepted?
- Does the endpoint immediately return output, or always return `fetch_result`?
- Does `fetch_result` require the API key again?
- Does polling use GET or POST?
- Are output URLs temporary?
- Does ModelsLab support multiple samples for Flux img2img?
- Does ModelsLab support `negative_prompt` for Flux?
- Does ModelsLab support seed for Flux?
- What is the max request image size?

### Product behavior

- Should image outputs be saved into the project source tree (`src/{project}/outputs/...`) or global workspace outputs (`outputs/...`)?
  - Current minimal form uses `src/{project}/outputs/flux-img2img` when project is known.
- Should Flux outputs automatically appear in the library grid?
- Should generated images be added to a new folder beside the original image instead?
- Should batch image generation be supported from `LibraryActionPanel`, or should Flux remain editor-only for now?
- Should there be saved presets per project?
- Should prompt history be stored?

---

## Recommended Next Implementation Pass

### Phase A — UI scaffold only

No real API behavior changes required.

- Expand `FluxImg2ImgForm` controls.
- Add advanced collapsible.
- Add payload preview.
- Add copy-to-clipboard for payload preview if easy.
- Keep existing `invoke("flux_img2img")` behind the Run button, but do not test it yet.
- Optionally add a temporary warning before running: “This will call ModelsLab and may use credits.”

### Phase B — Rust options struct

- Replace top-level command args with `options` struct.
- Keep backwards compatibility only if needed; this is internal frontend/backend code, so not critical.
- Build ModelsLab request from options.
- Make request serialization skip unset optional fields.

### Phase C — Docs verification

Read ModelsLab docs and update:

- endpoint URL
- payload struct
- response struct
- polling implementation
- model presets
- size presets
- advanced fields

### Phase D — Dry-run command

Optional but useful:

- Add `flux_img2img_preview_payload` command or compute preview frontend-side.
- If Rust-side, it can validate paths and show the exact request shape without key/image bytes.

### Phase E — Real API test

When ready:

1. Save a ModelsLab API key in Dashboard.
2. Select a small test image.
3. Use a conservative payload:
   - 512x512
   - 1 sample
   - 10–20 steps
4. Confirm no-key error works.
5. Confirm API error messages are displayed.
6. Confirm success output downloads.
7. Confirm generated output appears where expected.

---

## Files To Revisit

Frontend:

- `src/components/actions/flux-img2img-form.tsx`
- `src/components/editor/image-action-panel.tsx`
- `src/components/library/library-action-panel.tsx`
- `src/pages/dashboard.tsx`
- `src/types/index.ts`

Rust:

- `src-tauri/src/commands/image_actions.rs`
- `src-tauri/src/commands/settings.rs`
- `src-tauri/src/prefs.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/Cargo.toml`

Docs:

- `docs/plan-image-actions.md`
- `docs/plan-flux-ui-scaffold.md` (this file)

---

## Testing Checklist For UI Scaffold

- [ ] Click image in library opens image detail editor.
- [ ] Image action dropdown shows Flux Edit.
- [ ] Flux form includes simple controls.
- [ ] Advanced section expands/collapses.
- [ ] Size presets update width/height.
- [ ] Custom size allows manual width/height.
- [ ] Prompt required validation works.
- [ ] Payload preview updates live as controls change.
- [ ] Payload preview excludes API key.
- [ ] Payload preview excludes actual base64 image bytes.
- [ ] Dashboard API key save still works.
- [ ] TypeScript check passes.
- [ ] Cargo check passes after Rust struct changes.

---

## Reminder

Do not run `pnpm dev` from the agent. Ask the user to test in the running dev app.
