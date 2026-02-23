# Action Inventory

Audit of every action, its behavior per context, media compatibility, and recommended UI copy.

## Contexts

| Context | Description | Targets |
|---------|-------------|---------|
| **Library panel** | Folder-level batch operations. Scope is either "selected" or "all displayed" media. Targets derived from the current view. | Folders (for `folders` actions) or individual file paths (for `folders_or_videos`) |
| **Modal editor** | Single-file operations from the video player modal. Target is the currently open file. | Single file path via `targetsOverride` |

## Media Awareness

The library lists **both videos and images** (`is_media_file` = video OR image). But every Rust action internally calls `get_video_files` or checks `is_video_file`, silently skipping images. The frontend has no awareness of this mismatch except in the modal, which disables the action menu entirely for images.

### Three selection states to handle

| State | Description | Current behavior |
|-------|-------------|-----------------|
| **Videos only** | All targets are video files | Everything works as expected |
| **Images only** | All targets are image files | Actions run but process zero files. No error shown. |
| **Mixed** | Selection contains both videos and images | Actions silently skip images. Target count in UI is misleading (shows total including images). |

---

## Action-by-Action Inventory

### Concatenate (`concat`)

| | |
|---|---|
| **Target type** | `folders` |
| **Media** | Videos only (images silently skipped) |
| **Overwrite** | Allowed |
| **Library context** | Joins all videos in selected folders into one file per folder. Makes sense. |
| **Modal context** | Targets the single video's parent folder, not the video itself. Confusing — the user opens one video but the action concatenates the entire folder. |
| **Recommendation** | **Library**: keep as-is. **Modal**: either clarify copy ("Joins all videos in this folder") or remove from modal since it's fundamentally a folder operation. |

**Current UI copy**: "Joins all videos in the selected folders into one continuous file, in filename order. Pick a transition to smooth the cuts between clips."

**Proposed copy (library)**: "Joins all videos in each folder into one continuous file, in filename order. Pick a transition to smooth the cuts between clips."

**Proposed copy (modal)**: "Joins all videos in this video's folder into one continuous file. The current video is included based on its position in filename order."

---

### Trim (`trim`)

| | |
|---|---|
| **Target type** | `folders_or_videos` |
| **Media** | Videos only |
| **Overwrite** | Allowed |
| **Library context** | Trims all selected/displayed videos. Makes sense. |
| **Modal context** | Trims the single open video. Makes sense. |
| **Recommendation** | Works well in both contexts. Copy is accurate. |

**Current UI copy**: "Removes a fixed number of seconds from the beginning and/or end of each video."

**Proposed copy (modal)**: "Removes a fixed number of seconds from the beginning and/or end of this video."

---

### Detect Scenes (`detect`)

| | |
|---|---|
| **Target type** | `folders_or_videos` |
| **Media** | Videos only |
| **Overwrite** | Allowed |
| **Library context** | Splits all selected/displayed videos at scene boundaries. Makes sense. |
| **Modal context** | Splits the single open video. Makes sense and is a common single-video workflow. |
| **Recommendation** | Good in both contexts. |

**Current UI copy**: "Analyzes videos for scene changes and splits them into separate clips at each cut point. Lower thresholds detect more scenes."

**Proposed copy (modal)**: "Analyzes this video for scene changes and splits it into separate clips at each cut point. Lower thresholds detect more scenes."

---

### Detect Split Screens (`split-detect`)

| | |
|---|---|
| **Target type** | `folders_or_videos` |
| **Media** | Videos only |
| **Overwrite** | Not allowed |
| **Library context** | Detects split-screen regions across selected videos. Makes sense. |
| **Modal context** | Detects split-screen regions in the open video. Makes sense. |
| **Recommendation** | Good in both contexts. |

**Current UI copy**: "Detects split-screen regions in each video and exports every split into its own folder."

**Proposed copy (modal)**: "Detects split-screen regions in this video and exports each split into its own folder."

---

### Strip Audio (`strip-audio`)

| | |
|---|---|
| **Target type** | `folders_or_videos` |
| **Media** | Videos only |
| **Overwrite** | Allowed |
| **Library context** | Strips audio from all selected/displayed videos. Makes sense. |
| **Modal context** | Strips audio from the open video. Makes sense, especially with overwrite. |
| **Recommendation** | Good in both contexts. |

**Current UI copy**: "Strips the audio track from each video, producing silent video files. The video quality is preserved — only the audio is removed."

**Proposed copy (modal)**: "Strips the audio track from this video. The video quality is preserved — only the audio is removed."

---

### Chop (`chop`)

| | |
|---|---|
| **Target type** | `folders_or_videos` |
| **Media** | Videos only |
| **Overwrite** | Allowed |
| **Library context** | Chops all selected/displayed videos into segments. Makes sense. |
| **Modal context** | Chops the open video. Makes sense and is a natural single-video workflow. |
| **Recommendation** | Good in both contexts. |

**Current UI copy**: "Split long videos into smaller segments by duration or count."

**Proposed copy (modal)**: "Split this video into smaller segments by duration or count."

---

### Transcribe (`transcribe`)

| | |
|---|---|
| **Target type** | `folders_or_videos` |
| **Media** | Videos only (extracts audio internally) |
| **Overwrite** | Not allowed |
| **Library context** | Transcribes all selected/displayed videos. Makes sense. |
| **Modal context** | Transcribes the open video. Makes sense. |
| **Recommendation** | Good in both contexts. |

**Current UI copy**: "Uses FFmpeg's whisper filter to generate transcripts. Requires FFmpeg built with whisper.cpp support and a local Whisper model file."

*Copy is the same in both contexts — it describes the tool, not the scope.*

---

### Clean Filenames (`clean`)

| | |
|---|---|
| **Target type** | `folders` |
| **Media** | Videos only (uses `get_video_files` — images are skipped for dedup/rename) |
| **Overwrite** | Allowed |
| **Library context** | Cleans filenames across selected folders. Makes sense. |
| **Modal context** | Targets the parent folder of the open video. Same issue as concat — user opens one video, action affects the whole folder. |
| **Recommendation** | **Library**: keep as-is. **Modal**: clarify copy or consider removing. A single-video rename doesn't exist; this always operates on a folder. |

**Current UI copy**: "Tidies up video filenames in a folder. Can remove duplicate files (by content hash), rename files to a clean numbered sequence, or both."

**Proposed copy (modal)**: "Tidies up video filenames in this video's folder. Can remove duplicate files (by content hash), rename files to a clean numbered sequence, or both. Affects all videos in the folder."

**Note**: Currently only processes video filenames. Images in the folder are untouched. Should it also clean image filenames?

---

### Re-encode / Doctor (`doctor-reencode`)

| | |
|---|---|
| **Target type** | `folders_or_videos` |
| **Media** | Videos only |
| **Overwrite** | Allowed |
| **Library context** | Re-encodes all selected/displayed videos. Makes sense. |
| **Modal context** | Re-encodes the open video. Makes sense, especially with overwrite for fixing VFR in place. |
| **Recommendation** | Good in both contexts. |

**Current UI copy**: "Re-encodes videos to a constant frame rate. Phone recordings and screen captures often use variable frame rates, which causes choppy playback and sync issues when editing. This fixes that."

**Proposed copy (modal)**: "Re-encodes this video to a constant frame rate. Fixes choppy playback caused by variable frame rate recordings."

---

### Trim Start / Doctor (`doctor-trim-start`)

| | |
|---|---|
| **Target type** | `folders_or_videos` |
| **Media** | Videos only |
| **Overwrite** | Allowed |
| **Library context** | Trims the start of all selected/displayed videos. Makes sense. |
| **Modal context** | Trims the start of the open video. Makes sense. |
| **Recommendation** | Good in both contexts. |

**Current UI copy**: "Removes a set number of seconds from the start of each video. Useful for fixing black or corrupted first frames that some cameras produce."

**Proposed copy (modal)**: "Removes a set number of seconds from the start of this video. Useful for fixing black or corrupted first frames."

---

### Slow Motion (`slowmo`)

| | |
|---|---|
| **Target type** | `folders_or_videos` |
| **Media** | Videos only |
| **Overwrite** | Allowed |
| **Library context** | Applies slowmo to all selected/displayed videos. Makes sense. |
| **Modal context** | Applies slowmo to the open video. Makes sense and pairs well with overwrite + video refresh. |
| **Recommendation** | Good in both contexts. |

**Current UI copy**: "Creates slow-motion versions of your videos. A 2x slowdown makes a 10-second clip last 20 seconds."

**Proposed copy (modal)**: "Creates a slow-motion version of this video. A 2x slowdown makes a 10-second clip last 20 seconds."

---

### Loop (`loop`)

| | |
|---|---|
| **Target type** | `folders_or_videos` |
| **Media** | Videos only |
| **Overwrite** | Allowed |
| **Library context** | Loops all selected/displayed videos. Makes sense. |
| **Modal context** | Loops the open video. Makes sense — extending a short clip is a common single-video workflow. |
| **Recommendation** | Good in both contexts. Note: loop form copy says "the original is never overwritten" but overwrite IS allowed via ActionFormWrapper. The copy should reflect that overwrite is an option. |

**Current UI copy**: "Loop each video a set number of times. The output is a new file — the original is never overwritten. Transitions apply between each loop iteration."

**Proposed copy (library)**: "Loop each video a set number of times. Transitions apply between each loop iteration."

**Proposed copy (modal)**: "Loop this video a set number of times. Transitions apply between each loop iteration."

---

### Organize by Orientation (`organize-landscape`)

| | |
|---|---|
| **Target type** | `folders` |
| **Media** | Videos only (uses `is_video_file` — images skipped) |
| **Overwrite** | Allowed (moves files) |
| **Library context** | Organizes selected folders into landscape/portrait subfolders. Makes sense. |
| **Modal context** | Targets the parent folder. Same folder-scope issue as concat and clean. |
| **Recommendation** | **Library**: keep as-is. **Modal**: this is a folder reorganization tool. Running it from a single video's modal is confusing. Consider removing from modal or adding prominent copy: "Sorts all videos in this folder by orientation." |

**Current UI copy**: "Moves videos into landscape/ and portrait/ subfolders based on their aspect ratio. Helpful for separating phone footage (portrait) from camera footage (landscape) before tiling."

**Proposed copy (modal)**: "Sorts all videos in this video's folder into landscape/ and portrait/ subfolders based on aspect ratio. This moves files, including the video you're currently viewing."

**Note**: Could also sort images by orientation. Currently doesn't.

---

## Summary: Context Fit

### Actions that work well in both contexts
| Action | Notes |
|--------|-------|
| trim | Natural single-file and batch operation |
| detect | Common single-file workflow |
| split-detect | Works on individual videos |
| strip-audio | Simple per-file operation |
| chop | Natural single-file workflow |
| transcribe | Works on individual videos |
| doctor-reencode | Common single-file fix |
| doctor-trim-start | Common single-file fix |
| slowmo | Natural single-file creative tool |
| loop | Natural single-file creative tool |

### Actions that are awkward in the modal
| Action | Issue | Recommendation |
|--------|-------|----------------|
| concat | Operates on the whole folder, not the open video | Remove from modal, or add explicit "whole folder" warning |
| clean | Operates on the whole folder | Remove from modal, or add explicit "whole folder" warning |
| organize-landscape | Operates on the whole folder, moves files around | Remove from modal |

---

## Summary: Media Compatibility

### Image handling gaps

1. **Library target count is misleading** — shows "12 videos from selection" even when 3 of them are images. Those 3 will be silently skipped.

2. **No feedback when images are skipped** — user selects 5 items (3 videos + 2 images), runs trim, gets "trim completed" but only 3 files were processed.

3. **Some actions could support images** — clean filenames and organize by orientation are file-management operations that don't require video processing.

### Recommended changes

**Short term (copy/UX):**
- Library panel: show "N videos, M images" in scope badge when mixed
- Library panel: show a warning note when running a video-only action with images in the selection ("N images in selection will be skipped")
- Modal: already handles this correctly (disables actions for images)

**Medium term (functionality):**
- `clean`: extend to also process image filenames
- `organize-landscape`: extend to also sort images by aspect ratio (images have width/height too)

**Long term (new actions):**
- Image-specific actions: resize, convert format, strip EXIF, etc.
- Mixed-media actions: slideshow from images (image sequence to video)
