# Plan: Image Actions — Library Filters + Context-Aware Actions + Flux img2img

## Goal

Add first-class image support to the tiles library: filter/sort by media type, make all
actions context-aware (disabled when incompatible with selected media), fill the image
detail view with a real image action panel, and ship the first image action via
ModelsLab Flux img2img.

---

## Current State (read this before touching anything)

### What already exists

- **`VideoEditor`** (`src/components/editor/video-editor.tsx`) already handles both images
  and videos through the same click path. It checks `activeIsImage` and renders `<img>`
  instead of `<video>`. The right-hand panel (line 236–249) already branches on
  `activeIsImage` — but for images it just renders a placeholder:
  `"Actions are only available for videos."` — this is exactly the gap to fill.

- **`EditorActionPanel`** (`src/components/editor/editor-action-panel.tsx`) is the video
  action selector shown in the right panel of `VideoEditor`. It filters actions to
  `folders_or_videos` target type only.

- **`LibraryActionPanel`** (`src/components/library/library-action-panel.tsx`) already
  tracks `videoCount` and `imageCount` from the current selection. It filters actions
  but does not yet disable incompatible ones.

- **`action-capabilities.ts`** (`src/components/actions/action-capabilities.ts`) already
  exists with an `ActionCapability` type (`allowOutput`, `allowOverwrite`,
  `allowAlongside`). This is where we'll add `mediaTypes`.

- **`ActionInfo`** (Rust: `src-tauri/src/models.rs` line 262, Frontend:
  `src/types/index.ts`) currently has `name`, `label`, `description`, `target_type`.
  No `media_types` field yet.

- **`Prefs`** (`src-tauri/src/prefs.rs`) currently only has `workspace: Option<String>`.
  Needs `modelslab_api_key` added.

- **`filteredVideos`** in `library.tsx` (line 172) is currently just `const filteredVideos = videos;`
  — no filter applied at all. Sort is done via folder order only.

- All 17 existing actions are video-only (concat, trim, detect, etc.). None declare
  what media types they support.

### Key files

```
src/pages/library.tsx                         # Main library page — add filter/sort state
src/components/library/library-action-panel.tsx  # Batch action panel — add media-type gating
src/components/library/video-grid.tsx         # Grid component — onVideoClick handles both types
src/components/editor/video-editor.tsx        # Item detail view — image branch needs filling
src/components/editor/editor-action-panel.tsx # Video action panel (right panel)
src/components/editor/image-action-panel.tsx  # NEW — image action panel (right panel)
src/components/actions/action-capabilities.ts # Add mediaTypes field
src/components/actions/flux-img2img-form.tsx  # NEW — Flux img2img action form
src/types/index.ts                            # Add media_types to ActionInfo type
src-tauri/src/models.rs                       # Add media_types to ActionInfo struct
src-tauri/src/commands/actions.rs             # Annotate all 17 actions with media_types
src-tauri/src/commands/image_actions.rs       # NEW — ModelsLab API commands
src-tauri/src/commands/mod.rs                 # Register image_actions module
src-tauri/src/lib.rs                          # Register new Tauri commands
src-tauri/src/prefs.rs                        # Add modelslab_api_key field
```

---

## Phase 1 — Library Media Filter + Sort

**Files touched:** `src/pages/library.tsx` only.

### 1a. Add filter and sort state

Near the other `useState` declarations (around line 83), add:

```tsx
const [mediaFilter, setMediaFilter] = useState<"all" | "video" | "image">("all");
const [sortBy, setSortBy] = useState<"default" | "name" | "name-desc" | "size" | "size-desc">("default");
```

### 1b. Replace the `filteredVideos` assignment

Currently (line 172): `const filteredVideos = videos;`

Replace with:

```tsx
const filteredVideos = useMemo(() => {
  let result = videos;
  if (mediaFilter === "video") result = result.filter((v) => !isImage(v.rel_path));
  if (mediaFilter === "image") result = result.filter((v) => isImage(v.rel_path));
  return result;
}, [videos, mediaFilter]);
```

The existing sort logic (line 175–185) operates on `filteredVideos` already, but it only
sorts by the saved folder order. Add sort-by controls that layer on top:

```tsx
const orderedVideos = useMemo(() => {
  // existing order-from-saved-order logic first...
  let base = /* existing sorted result */;
  if (sortBy === "name") base = [...base].sort((a, b) => a.name.localeCompare(b.name));
  if (sortBy === "name-desc") base = [...base].sort((a, b) => b.name.localeCompare(a.name));
  if (sortBy === "size") base = [...base].sort((a, b) => (a.size ?? 0) - (b.size ?? 0));
  if (sortBy === "size-desc") base = [...base].sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
  return base;
}, [/* existing deps */, sortBy]);
```

Note: `VideoEntry` has a `size` field — check `src/types/index.ts` to confirm field name.

### 1c. Add filter + sort UI

Place this toolbar just above the `VideoGrid` (before line 860 approximately). Keep it
compact — one row:

```tsx
<div className="flex items-center gap-2 px-1">
  {/* Media type filter */}
  <div className="flex rounded-md border overflow-hidden text-xs">
    {(["all", "video", "image"] as const).map((f) => (
      <button
        key={f}
        onClick={() => setMediaFilter(f)}
        className={cn(
          "px-2.5 py-1 capitalize",
          mediaFilter === f ? "bg-primary text-primary-foreground" : "hover:bg-accent"
        )}
      >
        {f === "all" ? `All (${videos.length})` : f === "video" ? `Videos (${videos.filter(v => !isImage(v.rel_path)).length})` : `Images (${videos.filter(v => isImage(v.rel_path)).length})`}
      </button>
    ))}
  </div>

  {/* Sort */}
  <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
    <SelectTrigger className="h-7 text-xs w-36">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="default">Default order</SelectItem>
      <SelectItem value="name">Name A–Z</SelectItem>
      <SelectItem value="name-desc">Name Z–A</SelectItem>
      <SelectItem value="size">Size (small first)</SelectItem>
      <SelectItem value="size-desc">Size (large first)</SelectItem>
    </SelectContent>
  </Select>
</div>
```

Reset `selectedPaths` when `mediaFilter` changes (add a `useEffect` that calls
`setSelectedPaths(new Set())`).

---

## Phase 2 — Context-Aware Action Gating

### 2a. Add `media_types` to Rust `ActionInfo`

**File:** `src-tauri/src/models.rs` (line 262)

```rust
#[derive(Debug, Serialize, Clone)]
pub struct ActionInfo {
    pub name: String,
    pub label: String,
    pub description: String,
    pub target_type: String,
    pub media_types: Vec<String>,  // "video", "image", or "any"
}
```

### 2b. Annotate all 17 actions in `list_actions()`

**File:** `src-tauri/src/commands/actions.rs`

Every existing action gets `media_types: vec!["video".to_string()]` except where noted.
Full mapping:

| Action name          | media_types         | Reason |
|----------------------|---------------------|--------|
| concat               | `["video"]`         | ffmpeg video join |
| trim                 | `["video"]`         | ffmpeg trim |
| detect               | `["video"]`         | scene detection |
| split-detect         | `["video"]`         | video split |
| yt-import            | `["any"]`           | not file-based |
| strip-audio          | `["video"]`         | audio track |
| chop                 | `["video"]`         | duration-based split |
| transcribe           | `["video"]`         | audio extraction |
| tile                 | `["any"]`           | settings-based |
| clean                | `["any"]`           | filename cleanup |
| doctor-reencode      | `["video"]`         | re-encode |
| slowmo               | `["video"]`         | frame rate |
| loop                 | `["video"]`         | video loop |
| crop                 | `["video"]`         | ffmpeg crop |
| organize-landscape   | `["video"]`         | aspect ratio |
| run                  | `["any"]`           | settings-based |
| yolo                 | `["any"]`           | settings-based |

Add the field to every `ActionInfo { ... }` block in the vec.

### 2c. Add `media_types` to the TypeScript type

**File:** `src/types/index.ts`

Find the `ActionInfo` interface and add:

```typescript
export interface ActionInfo {
  name: string;
  label: string;
  description: string;
  target_type: string;
  media_types: string[];   // "video" | "image" | "any"
}
```

### 2d. Extend `action-capabilities.ts` with `mediaTypes`

**File:** `src/components/actions/action-capabilities.ts`

```typescript
type ActionCapability = {
  allowOutput: boolean;
  allowOverwrite: boolean;
  allowAlongside: boolean;
  mediaTypes: ("video" | "image" | "any")[];  // ADD THIS
};
```

Update every entry in `ACTION_CAPS` to include `mediaTypes`. All existing entries get
`mediaTypes: ["video"]` except the settings/url actions which get `["any"]`. This
mirrors what the Rust backend declares.

Export a helper:

```typescript
export function actionSupportsMedia(
  actionName: string | undefined,
  presentTypes: Set<"video" | "image">
): boolean {
  const caps = actionCapabilities(actionName);
  if (caps.mediaTypes.includes("any")) return true;
  return [...presentTypes].some((t) => caps.mediaTypes.includes(t));
}
```

### 2e. Gate actions in `LibraryActionPanel`

**File:** `src/components/library/library-action-panel.tsx`

The component already computes `videoCount` and `imageCount`. Derive `presentTypes`:

```tsx
const presentTypes = useMemo(() => {
  const types = new Set<"video" | "image">();
  if (videoCount > 0) types.add("video");
  if (imageCount > 0) types.add("image");
  return types;
}, [videoCount, imageCount]);
```

When rendering the action `<Select>`, mark incompatible options disabled and show a
tooltip reason. Use `actionSupportsMedia(action.name, presentTypes)` to decide.
Incompatible actions should render as disabled `SelectItem`s (shadcn supports
`disabled` prop) with a small note like "Requires video".

If the currently selected action becomes incompatible when the selection changes (e.g.,
user changes selection from video to image), clear `selectedAction`.

### 2f. Gate actions in `EditorActionPanel`

**File:** `src/components/editor/editor-action-panel.tsx`

The panel receives a `video: VideoEntry` prop. Add `activeIsImage` check:

```tsx
const isImg = /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(video.rel_path);
const actions = useMemo(
  () =>
    allActions.filter((a) => {
      if (a.target_type === "settings" || a.target_type === "url" || a.target_type === "folders") return false;
      const caps = actionCapabilities(a.name);
      if (isImg) return caps.mediaTypes.includes("image") || caps.mediaTypes.includes("any");
      return caps.mediaTypes.includes("video") || caps.mediaTypes.includes("any");
    }),
  [allActions, isImg]
);
```

This ensures the video editor action dropdown only shows video-compatible actions for
videos, and image-compatible actions for images (once they exist).

---

## Phase 3 — Image Action Panel in the Editor

**Context:** `VideoEditor` line 236–249 currently has:

```tsx
{activeIsImage ? (
  <div className="text-xs text-muted-foreground">
    Actions are only available for videos.
  </div>
) : (
  <EditorActionPanel ... />
)}
```

Replace the placeholder branch with `<ImageActionPanel>`.

### 3a. Create `ImageActionPanel`

**New file:** `src/components/editor/image-action-panel.tsx`

Mirror the structure of `EditorActionPanel`:
- `useActions()` → filter to `media_types` containing `"image"`
- A `<Select>` to pick the active image action
- A render switch that shows the appropriate form component based on `selectedAction`
- For now, the only action is `flux-img2img` — add more here as they're built

```tsx
import { useMemo, useState } from "react";
import { useActions } from "@/hooks/use-actions";
import { actionCapabilities } from "@/components/actions/action-capabilities";
import { FluxImg2ImgForm } from "@/components/actions/flux-img2img-form";
import type { VideoEntry } from "@/types";
// ... shadcn Select imports

interface ImageActionPanelProps {
  image: VideoEntry;
  currentProject?: string;
}

export function ImageActionPanel({ image, currentProject }: ImageActionPanelProps) {
  const { actions: allActions } = useActions();
  const [selectedAction, setSelectedAction] = useState<string | null>(null);

  const actions = useMemo(
    () => allActions.filter((a) => {
      const caps = actionCapabilities(a.name);
      return caps.mediaTypes.includes("image");
    }),
    [allActions]
  );

  return (
    <div className="space-y-3">
      <Select value={selectedAction ?? ""} onValueChange={(v) => setSelectedAction(v || null)}>
        {/* render image actions */}
      </Select>
      {selectedAction === "flux-img2img" && (
        <FluxImg2ImgForm image={image} currentProject={currentProject} />
      )}
    </div>
  );
}
```

### 3b. Wire `ImageActionPanel` into `VideoEditor`

**File:** `src/components/editor/video-editor.tsx` line 236–249

```tsx
{activeIsImage ? (
  <ImageActionPanel image={video} currentProject={/* pass project prop */} />
) : (
  <EditorActionPanel ... />
)}
```

Note: `VideoEditor` currently does not receive `currentProject` as a prop. You'll need
to thread it through from `library.tsx` where `VideoEditor` is rendered (line 827).
In `library.tsx` the `project` variable is already in scope. Add it to `VideoEditorProps`
and pass `currentProject={project}`.

---

## Phase 4 — ModelsLab Flux img2img

### 4a. Extend `Prefs` with API key

**File:** `src-tauri/src/prefs.rs`

```rust
#[derive(Serialize, Deserialize, Default)]
pub struct Prefs {
    pub workspace: Option<String>,
    pub modelslab_api_key: Option<String>,
}
```

### 4b. Add settings commands for the API key

**File:** `src-tauri/src/commands/settings.rs` (or create `image_actions.rs` and put them there)

Add two lightweight commands:

```rust
#[tauri::command]
pub async fn get_modelslab_key(app: tauri::AppHandle) -> Option<String> {
    crate::prefs::read_prefs(&app).modelslab_api_key
}

#[tauri::command]
pub async fn set_modelslab_key(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let mut prefs = crate::prefs::read_prefs(&app);
    prefs.modelslab_api_key = if key.is_empty() { None } else { Some(key) };
    crate::prefs::write_prefs(&app, &prefs)
}
```

### 4c. Create `image_actions.rs`

**New file:** `src-tauri/src/commands/image_actions.rs`

This module makes direct HTTP calls to ModelsLab using `reqwest` (already in
`Cargo.toml`). Do NOT go through the tiles-cli runner — API calls are handled
entirely in Rust.

```rust
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::State;
use crate::state::AppState;
use crate::prefs::read_prefs;

#[derive(Serialize)]
struct FluxImg2ImgRequest {
    key: String,
    model_id: String,
    prompt: String,
    init_image: String,       // publicly accessible URL or base64
    strength: f32,            // 0.0–1.0
    width: u32,
    height: u32,
    num_inference_steps: u32,
    guidance_scale: f32,
    samples: u32,
}

#[derive(Deserialize, Serialize)]
pub struct FluxImg2ImgResponse {
    pub status: String,
    pub output: Option<Vec<String>>,  // URLs of generated images
    pub message: Option<String>,
    pub fetch_result: Option<String>, // polling URL if async
}

#[tauri::command]
pub async fn flux_img2img(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    image_rel_path: String,   // relative path in workspace
    prompt: String,
    strength: f32,
    width: u32,
    height: u32,
    output_folder: String,    // relative path for saving result
) -> Result<FluxImg2ImgResponse, String> {
    let prefs = read_prefs(&app);
    let key = prefs.modelslab_api_key
        .ok_or("ModelsLab API key not set. Go to Settings to add it.")?;

    let root = state.root.read().unwrap().clone();
    let image_path = root.join(&image_rel_path);

    // Read image, base64-encode, build data URI
    let image_bytes = std::fs::read(&image_path).map_err(|e| e.to_string())?;
    let b64 = base64_encode(&image_bytes);
    let ext = image_path.extension().and_then(|e| e.to_str()).unwrap_or("jpeg");
    let mime = match ext.to_lowercase().as_str() {
        "png" => "image/png",
        "webp" => "image/webp",
        _ => "image/jpeg",
    };
    let data_uri = format!("data:{mime};base64,{b64}");

    let client = Client::new();
    let resp = client
        .post("https://modelslab.com/api/v6/realtime/img2img")
        .json(&FluxImg2ImgRequest {
            key,
            model_id: "flux".to_string(),
            prompt,
            init_image: data_uri,
            strength,
            width,
            height,
            num_inference_steps: 20,
            guidance_scale: 7.5,
            samples: 1,
        })
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<FluxImg2ImgResponse>()
        .await
        .map_err(|e| e.to_string())?;

    // If the API returned output URLs, download and save them to output_folder
    if let Some(urls) = &resp.output {
        let dest = root.join(&output_folder);
        std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
        for (i, url) in urls.iter().enumerate() {
            let bytes = client.get(url).send().await.map_err(|e| e.to_string())?
                .bytes().await.map_err(|e| e.to_string())?;
            let fname = format!("flux-img2img-{i}.jpg");
            std::fs::write(dest.join(&fname), &bytes).map_err(|e| e.to_string())?;
        }
    }

    Ok(resp)
}

fn base64_encode(bytes: &[u8]) -> String {
    use std::fmt::Write;
    // Use the `base64` crate if available, else implement or use a simple approach.
    // Add base64 = "0.22" to Cargo.toml if not present.
    base64::engine::general_purpose::STANDARD.encode(bytes)
}
```

**Note:** Add `base64 = "0.22"` to `src-tauri/Cargo.toml` `[dependencies]`.

Check the ModelsLab API docs for the exact endpoint and payload shape. The endpoint
above (`/api/v6/realtime/img2img`) is the Flux realtime img2img endpoint. Their API
may return a `fetch_result` URL for async polling — handle that case by polling until
`status == "success"` (with a timeout).

### 4d. Register the new module and commands

**File:** `src-tauri/src/commands/mod.rs` — add:
```rust
pub mod image_actions;
```

**File:** `src-tauri/src/lib.rs` — in the `tauri::generate_handler![]` macro add:
```rust
commands::image_actions::flux_img2img,
commands::settings::get_modelslab_key,
commands::settings::set_modelslab_key,
```

### 4e. Add `flux-img2img` to `list_actions()`

**File:** `src-tauri/src/commands/actions.rs`

```rust
ActionInfo {
    name: "flux-img2img".to_string(),
    label: "Flux Edit (img2img)".to_string(),
    description: "Edit an image using a text prompt via ModelsLab Flux. Requires a ModelsLab API key in Settings.".to_string(),
    target_type: "folders_or_videos".to_string(),
    media_types: vec!["image".to_string()],
},
```

### 4f. Add `flux-img2img` to `action-capabilities.ts`

```typescript
"flux-img2img": {
  allowOutput: true,
  allowOverwrite: false,
  allowAlongside: true,
  mediaTypes: ["image"],
},
```

### 4g. Create `FluxImg2ImgForm`

**New file:** `src/components/actions/flux-img2img-form.tsx`

This form is used from `ImageActionPanel` in the editor. It operates on a single image
(not through `ActionFormWrapper`, which is batch-oriented). Keep it simple:

```tsx
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { VideoEntry } from "@/types";

interface Props {
  image: VideoEntry;
  currentProject?: string;
}

export function FluxImg2ImgForm({ image, currentProject }: Props) {
  const [prompt, setPrompt] = useState("");
  const [strength, setStrength] = useState(0.75);
  const [running, setRunning] = useState(false);

  const outputFolder = currentProject
    ? `src/${currentProject}/outputs/flux-img2img`
    : "outputs/flux-img2img";

  const run = async () => {
    if (!prompt.trim()) { toast.error("Enter a prompt"); return; }
    setRunning(true);
    try {
      const result = await invoke<{ status: string; output?: string[] }>(
        "flux_img2img",
        {
          imageRelPath: image.rel_path,
          prompt: prompt.trim(),
          strength,
          width: 1024,
          height: 1024,
          outputFolder,
        }
      );
      if (result.status === "success") {
        toast.success(`Flux edit saved to ${outputFolder}`);
      } else {
        toast.error(`Flux returned: ${result.status}`);
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-sm">Prompt</Label>
        <Textarea
          className="mt-1 text-sm"
          rows={3}
          placeholder="Describe the edit you want to make…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </div>
      <div>
        <Label className="text-sm">Strength — {strength.toFixed(2)}</Label>
        <p className="text-xs text-muted-foreground mb-1.5">
          How much the prompt overrides the original. Low = subtle edit, High = strong transformation.
        </p>
        <Slider
          min={0.1} max={1.0} step={0.05}
          value={[strength]}
          onValueChange={([v]) => setStrength(v)}
        />
      </div>
      <Button onClick={run} disabled={running} className="w-full">
        {running ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Running…</> : "Run Flux Edit"}
      </Button>
    </div>
  );
}
```

### 4h. Settings UI for the API key

In the Dashboard or a Settings page, add an API key input. Find where the app currently
exposes settings (`src/pages/dashboard.tsx` or equivalent). Add:

```tsx
// Hook to read/write the key
const [apiKey, setApiKey] = useState("");
useEffect(() => {
  invoke<string | null>("get_modelslab_key").then((k) => setApiKey(k ?? ""));
}, []);
const saveKey = () => invoke("set_modelslab_key", { key: apiKey })
  .then(() => toast.success("API key saved"))
  .catch((e) => toast.error(String(e)));

// UI
<div>
  <Label>ModelsLab API Key</Label>
  <div className="flex gap-2 mt-1">
    <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="ml-…" />
    <Button onClick={saveKey}>Save</Button>
  </div>
</div>
```

---

## Build order within a session

1. Phase 1 (library filter/sort) — isolated, no Rust changes, verify in dev app
2. Phase 2a–2c (media_types in Rust + TypeScript types) — Rust compile required
3. Phase 2d–2f (action gating in UI) — verify existing video actions still work, image
   actions are gated
4. Phase 3 (ImageActionPanel wired into VideoEditor) — verify by clicking an image
5. Phase 4a–4d (Rust image_actions.rs + commands) — Rust compile required
6. Phase 4e–4h (FluxImg2ImgForm + Settings key UI) — verify end-to-end with a real
   ModelsLab key

---

## Testing checklist

- [ ] Library with no filter: images and videos both visible
- [ ] Library filter "Videos": only video files shown, count updates
- [ ] Library filter "Images": only image files shown, count updates
- [ ] Sort by name: alphabetical order applied on top of filter
- [ ] Select only videos → video actions enabled, "Flux Edit" disabled/absent
- [ ] Select only images → "Flux Edit" enabled, video actions disabled
- [ ] Select mixed → actions that support "any" remain available, typed ones disabled
- [ ] Click a video → VideoEditor opens, EditorActionPanel shows video actions only
- [ ] Click an image → VideoEditor opens, ImageActionPanel shows, "Flux Edit" option present
- [ ] No API key set → running Flux img2img shows "API key not set" error via toast
- [ ] API key set in Settings → persists across app restarts
- [ ] Valid Flux run → output image saved to `src/{project}/outputs/flux-img2img/`
- [ ] Output appears in Outputs page

---

## Notes

- The ModelsLab Flux img2img endpoint may be async (returns `fetch_result` polling URL
  instead of immediate output). If so, poll `fetch_result` every 2s until
  `status == "success"` or `"failed"`, with a 60s timeout. Implement this in the Rust
  command, not the frontend.
- `reqwest` is already in `Cargo.toml`. Enable the `json` feature if not already present:
  `reqwest = { version = "0.12", features = ["blocking", "rustls-tls", "json"] }`.
- Check `blocking` feature — the `flux_img2img` command is async (`async fn`) so use
  the non-blocking reqwest client, not blocking. Remove `blocking` feature if it causes
  compile issues with the async runtime.
- The base64 encoding requires adding `base64 = "0.22"` to `src-tauri/Cargo.toml`.
- Do not run `pnpm dev` — ask the user to test in the running dev app.
- Do not modify `CLAUDE.md`.
