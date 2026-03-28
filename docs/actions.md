# Actions

Video actions available in tiles. All actions are invoked via Tauri commands that shell out to the `tiles` CLI binary.

## Concatenate (`concat`)

Join all videos in a folder into a single file, in filename order. Supports transitions between clips: cut (hard cut, default), fade (crossfade), or fade to black.

**Parameters**: transition type, transition duration (seconds).

## Trim (`trim`)

Cut a percentage off the start and/or end of each video. For example, a 50% start trim on a 10-second clip keeps only the last 5 seconds.

**Parameters**: trim start (0–90%), trim end (0–90%), no-audio flag.

## Detect Scenes (`detect`)

Analyze videos for scene changes and split them into separate clips at each cut point. Lower thresholds detect more scenes. Can optionally list scenes without splitting.

**Parameters**: threshold (0.01–1.0), method (content or adaptive), list-only flag.

## Detect Split Screens (`split-detect`)

Detect split-screen regions in each video and export every detected split to its own folder. Useful for extracting side-by-side or reaction-cam footage.

**Parameters**: force 2x1 flag, quality, clip seconds, fast-preview flag.

## Import YouTube Video (`yt-import`)

Download a YouTube video, fetch its transcript, and split the result into tiles. Requires `yt-dlp` on PATH.

**Parameters**: force 2x1 flag, quality, clip seconds, fast-preview flag, cookies-from-browser, cookies file.

## Strip Audio (`strip-audio`)

Remove the audio track from videos, producing silent video files. Video quality is preserved.

## Chop (`chop`)

Split long videos into smaller segments by duration or count.

**Parameters**: duration (seconds per segment), count (number of segments). One or the other.

## Transcribe (`transcribe`)

Generate transcripts using FFmpeg's Whisper filter. Requires FFmpeg built with whisper.cpp support. The default model (`ggml-base.bin`) is auto-downloaded to `models/` in the workspace on first use.

**Parameters**: model path, language (optional), output format (text/srt/json), queue seconds, GPU options, VAD settings.

## Tile (`tile`)

Render a tiled video composition from multiple folders using saved settings. Supports grid layouts, picture-in-picture, and hybrid layouts with per-tile transitions, crop positions, speeds, and audio mixing.

**Parameters**: settings path, render mode (preview/fast-preview/full), no-overwrite flag, force-cfr flag.

## Run Saved Settings (`run`)

Render a tiled composition from saved Tile Builder settings without opening the builder. A quick way to re-render with the last saved config.

**Parameters**: settings path, render mode, no-overwrite flag, force-cfr flag.

## YOLO (`yolo`)

Generate a random tile composition. Picks a random layout and assigns folders automatically.

## Clean Filenames (`clean`)

Tidy up video filenames in a folder. Three modes: remove duplicates (by content hash), rename files to a clean numbered sequence, or both. Can optionally add a number prefix.

**Parameters**: mode (duplicates/rename/both), add-number flag.

## Re-encode / Doctor (`doctor-reencode`)

Re-encode videos to a constant frame rate. Phone recordings and screen captures often use variable frame rates, which causes choppy playback and sync issues when editing.

**Parameters**: FPS (default 30).

## Slow Motion (`slowmo`)

Create slow-motion versions of videos. A 2x slowdown makes a 10-second clip last 20 seconds.

**Parameters**: slowdown factor (1.5x–8x).

## Loop (`loop`)

Loop a video a set number of times. Transitions apply between each loop iteration.

**Parameters**: count (number of loops), transition type, transition duration.

## Crop (`crop`)

Crop videos to a specific rectangular region.

**Parameters**: x, y, width, height (pixel values).

## Organize by Orientation (`organize-landscape`)

Move videos into `landscape/` and `portrait/` subfolders based on their aspect ratio. Helpful for separating phone footage (portrait) from camera footage (landscape) before tiling.
