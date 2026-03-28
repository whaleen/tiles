# Action Inventory

Audit of every action — behavior per UI context, media compatibility, and recommended copy.

## UI Contexts

| Context | Description | Targets |
|---------|-------------|---------|
| **Library panel** | Folder-level batch operations. Scope is either "selected" or "all displayed" media. | Folders (for `folders` actions) or individual file paths (for `folders_or_videos`) |
| **Video editor** | Single-file operations from the per-video editor panel. Target is the currently open file. | Single file path via `targetsOverride` |

## Media Awareness

The library lists **both videos and images** (`is_media_file` = video OR image). But every action internally calls `get_video_files` or checks `is_video_file`, silently skipping images. The frontend has no awareness of this mismatch except in the video editor, which disables the action menu entirely for images.

### Three selection states to handle

| State | Description | Current behavior |
|-------|-------------|-----------------|
| **Videos only** | All targets are video files | Everything works as expected |
| **Images only** | All targets are image files | Actions run but process zero files. No error shown. |
| **Mixed** | Selection contains both videos and images | Actions silently skip images. Target count in UI is misleading. |

---

## Action-by-Action Inventory

### Concatenate (`concat`)

| | |
|---|---|
| **Target type** | `folders` |
| **Media** | Videos only (images silently skipped) |
| **Overwrite** | Not allowed |
| **Library context** | Joins all videos in selected folders into one file per folder. Makes sense. |
| **Editor context** | Targets the single video's parent folder, not the video itself. Confusing — the user opens one video but the action concatenates the entire folder. |
| **Recommendation** | **Library**: keep as-is. **Editor**: clarify copy ("Joins all videos in this folder") or remove since it's fundamentally a folder operation. |

---

### Trim (`trim`)

| | |
|---|---|
| **Target type** | `folders_or_videos` |
| **Media** | Videos only |
| **Overwrite** | Allowed |
| **Library context** | Trims all selected/displayed videos. Makes sense. |
| **Editor context** | Trims the single open video. Makes sense. Has visual trim tool. |
| **Recommendation** | Works well in both contexts. |

---

### Detect Scenes (`detect`)

| | |
|---|---|
| **Target type** | `folders_or_videos` |
| **Media** | Videos only |
| **Overwrite** | Not allowed |
| **Library context** | Splits all selected/displayed videos at scene boundaries. Makes sense. |
| **Editor context** | Splits the single open video. Makes sense and is a common single-video workflow. |
| **Recommendation** | Good in both contexts. |

---

### Detect Split Screens (`split-detect`)

| | |
|---|---|
| **Target type** | `folders_or_videos` |
| **Media** | Videos only |
| **Overwrite** | Not allowed |
| **Library context** | Detects split-screen regions across selected videos. Makes sense. |
| **Editor context** | Detects split-screen regions in the open video. Makes sense. |
| **Recommendation** | Good in both contexts. |

---

### Import YouTube Video (`yt-import`)

| | |
|---|---|
| **Target type** | `url` |
| **Media** | N/A — downloads from the internet |
| **Overwrite** | Not applicable |
| **Library context** | Not shown in library panel (URL input lives in the Import page). |
| **Editor context** | Not applicable. |
| **Recommendation** | Import page only — not a per-file or per-folder action. |

---

### Strip Audio (`strip-audio`)

| | |
|---|---|
| **Target type** | `folders_or_videos` |
| **Media** | Videos only |
| **Overwrite** | Allowed |
| **Library context** | Strips audio from all selected/displayed videos. Makes sense. |
| **Editor context** | Strips audio from the open video. Makes sense, especially with overwrite. |
| **Recommendation** | Good in both contexts. |

---

### Chop (`chop`)

| | |
|---|---|
| **Target type** | `folders_or_videos` |
| **Media** | Videos only |
| **Overwrite** | Allowed |
| **Library context** | Chops all selected/displayed videos into segments. Makes sense. |
| **Editor context** | Chops the open video. Makes sense and is a natural single-video workflow. |
| **Recommendation** | Good in both contexts. |

---

### Transcribe (`transcribe`)

| | |
|---|---|
| **Target type** | `folders_or_videos` |
| **Media** | Videos only (extracts audio internally) |
| **Overwrite** | Not allowed |
| **Library context** | Transcribes all selected/displayed videos. Makes sense. |
| **Editor context** | Transcribes the open video. Makes sense. |
| **Recommendation** | Good in both contexts. |

---

### Tile (`tile`) / Run (`run`) / YOLO (`yolo`)

| | |
|---|---|
| **Target type** | `settings` |
| **Media** | Operates on whole folders via settings file |
| **Overwrite** | Not applicable |
| **Library context** | Tile/Run are accessible from the Tile Builder page or Actions page. |
| **Editor context** | Not applicable — operates on folder sets, not individual videos. |
| **Recommendation** | Actions/Tile Builder pages only. |

---

### Clean Filenames (`clean`)

| | |
|---|---|
| **Target type** | `folders` |
| **Media** | Videos only (images are skipped for dedup/rename) |
| **Overwrite** | Allowed |
| **Library context** | Cleans filenames across selected folders. Makes sense. |
| **Editor context** | Targets the parent folder of the open video. User opens one video but the action affects the whole folder. |
| **Recommendation** | **Library**: keep as-is. **Editor**: clarify copy or consider removing. |

---

### Re-encode / Doctor (`doctor-reencode`)

| | |
|---|---|
| **Target type** | `folders_or_videos` |
| **Media** | Videos only |
| **Overwrite** | Allowed |
| **Library context** | Re-encodes all selected/displayed videos. Makes sense. |
| **Editor context** | Re-encodes the open video. Makes sense, especially with overwrite for fixing VFR in place. |
| **Recommendation** | Good in both contexts. |

---

### Slow Motion (`slowmo`)

| | |
|---|---|
| **Target type** | `folders_or_videos` |
| **Media** | Videos only |
| **Overwrite** | Allowed |
| **Library context** | Applies slowmo to all selected/displayed videos. Makes sense. |
| **Editor context** | Applies slowmo to the open video. Makes sense and pairs well with overwrite + video refresh. Has visual tool. |
| **Recommendation** | Good in both contexts. |

---

### Loop (`loop`)

| | |
|---|---|
| **Target type** | `folders_or_videos` |
| **Media** | Videos only |
| **Overwrite** | Allowed |
| **Library context** | Loops all selected/displayed videos. Makes sense. |
| **Editor context** | Loops the open video. Makes sense — extending a short clip is a common single-video workflow. Has visual tool. |
| **Recommendation** | Good in both contexts. |

---

### Crop (`crop`)

| | |
|---|---|
| **Target type** | `folders_or_videos` |
| **Media** | Videos only |
| **Overwrite** | Allowed |
| **Library context** | Crops all selected/displayed videos to a fixed region. Makes sense for batch. |
| **Editor context** | Crops the open video. Makes sense. Has interactive crop overlay tool. |
| **Recommendation** | Good in both contexts. The editor's visual crop tool is the primary UX. |

---

### Organize by Orientation (`organize-landscape`)

| | |
|---|---|
| **Target type** | `folders` |
| **Media** | Videos only (images skipped) |
| **Overwrite** | Allowed (moves files) |
| **Library context** | Organizes selected folders into landscape/portrait subfolders. Makes sense. |
| **Editor context** | Targets the parent folder. This is a folder reorganization tool — running it from a single video's editor is confusing. |
| **Recommendation** | **Library**: keep as-is. **Editor**: add prominent copy or remove. |

---

## Summary: Context Fit

### Actions that work well in both contexts
| Action | Notes |
|--------|-------|
| trim | Natural single-file and batch operation, has visual tool |
| detect | Common single-file workflow |
| split-detect | Works on individual videos |
| strip-audio | Simple per-file operation |
| chop | Natural single-file workflow |
| transcribe | Works on individual videos |
| doctor-reencode | Common single-file fix |
| slowmo | Natural single-file creative tool, has visual tool |
| loop | Natural single-file creative tool, has visual tool |
| crop | Natural single-file operation, has visual overlay tool |

### Actions that are awkward in the editor
| Action | Issue | Recommendation |
|--------|-------|----------------|
| concat | Operates on the whole folder, not the open video | Remove from editor, or add explicit "whole folder" warning |
| clean | Operates on the whole folder | Remove from editor, or add explicit "whole folder" warning |
| organize-landscape | Operates on the whole folder, moves files around | Remove from editor |

---

## Summary: Media Compatibility

### Image handling gaps

1. **Library target count is misleading** — shows "12 videos from selection" even when 3 are images that will be silently skipped.
2. **No feedback when images are skipped** — user selects 5 items (3 videos + 2 images), runs trim, gets "trim completed" but only 3 files were processed.
3. **Some actions could support images** — clean filenames and organize by orientation are file-management operations that don't require video processing.

### Recommended changes

**Short term (copy/UX):**
- Library panel: show "N videos, M images" in scope badge when mixed
- Library panel: warn when running a video-only action with images in the selection ("N images in selection will be skipped")
- Editor: already handles this correctly (disables actions for images)

**Medium term (functionality):**
- `clean`: extend to also process image filenames
- `organize-landscape`: extend to also sort images by aspect ratio
