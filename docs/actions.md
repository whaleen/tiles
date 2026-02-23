# Actions

This list describes the video actions available in Tiles. All actions are available across CLI, TUI, and Tiles Studio.

## Concatenate (`concat`)

Join all videos in a folder into a single file, in filename order. Supports transitions between clips: cut (hard cut, default), fade (crossfade), or fade to black.

**Parameters**: transition type, transition duration (seconds).

| Surface | Support |
| --- | --- |
| CLI | `tiles concat <folders> --transition fade --duration 1.0` |
| TUI | Yes |
| Tiles Studio | Yes — folder selection, transition picker, duration input |

## Trim (`trim`)

Cut a percentage off the start and/or end of each video. For example, a 50% start trim on a 10-second clip keeps only the last 5 seconds.

**Parameters**: trim start (0-90%), trim end (0-90%).

| Surface | Support |
| --- | --- |
| CLI | `tiles trim <targets> --start 0.5 --end 0.25` |
| TUI | Yes |
| Tiles Studio | Yes — slider controls for start/end percentages |

## Detect Scenes (`detect`)

Analyze videos for scene changes and split them into separate clips at each cut point. Lower thresholds detect more scenes. Can optionally list scenes without splitting.

**Parameters**: threshold (0.01-1.0), method (content or adaptive), list-only flag.

| Surface | Support |
| --- | --- |
| CLI | `tiles detect <targets> --threshold 0.3 --method content --list-only` |
| TUI | Yes |
| Tiles Studio | Yes — threshold input, method dropdown, list-only toggle |

## Strip Audio (`strip-audio`)

Remove the audio track from videos, producing silent video files. Video quality is preserved.

| Surface | Support |
| --- | --- |
| CLI | `tiles strip-audio <targets>` |
| TUI | Yes |
| Tiles Studio | Yes |

## Transcribe (`transcribe`)

Generate transcripts using FFmpeg's Whisper filter. Requires FFmpeg built with whisper.cpp support. The default model (ggml-base.bin) is auto-downloaded to models/ on first use.

**Parameters**: model path (required), language (optional), output format (text/srt/json), queue seconds (optional), GPU options (optional).

| Surface | Support |
| --- | --- |
| CLI | No (uses FFmpeg directly via Studio/API) |
| TUI | No |
| Tiles Studio | Yes — model path, language, format, queue, GPU toggle |

## Tile (`tile`)

Render a tiled video composition from multiple folders using saved settings. Supports grid layouts, picture-in-picture, and hybrid layouts with per-tile transitions, crop positions, speeds, and audio mixing.

**Parameters**: settings path, render mode (preview/fast-preview/full), no-overwrite flag, force-cfr flag.

| Surface | Support |
| --- | --- |
| CLI | `tiles tile <folders> --layout 2x1 --render-mode preview` |
| TUI | Yes |
| Tiles Studio | Yes — full Tile Builder with visual layout picker, folder assignment, per-tile settings |

## Run Saved Settings (`run`)

Render a tiled composition from saved Tile Builder settings without opening the builder. A quick way to re-render.

**Parameters**: settings path, render mode, no-overwrite flag, force-cfr flag.

| Surface | Support |
| --- | --- |
| CLI | `tiles run --render-mode preview --no-overwrite` |
| TUI | Yes |
| Tiles Studio | Yes |

## YOLO (`yolo`)

Generate a random tile composition. Picks a random layout and assigns folders automatically for a surprise result.

| Surface | Support |
| --- | --- |
| CLI | `tiles yolo` |
| TUI | Yes |
| Tiles Studio | Yes |

## Clean Filenames (`clean`)

Tidy up video filenames in a folder. Three modes: remove duplicates (by content hash), rename files to a clean numbered sequence, or both. Can optionally add a number prefix.

**Parameters**: mode (1=duplicates, 2=rename, 3=both), add-number flag.

| Surface | Support |
| --- | --- |
| CLI | `tiles clean <folders> -m 3 -n` |
| TUI | Yes |
| Tiles Studio | Yes — mode dropdown, number prefix toggle |

## Re-encode / Doctor (`doctor-reencode`)

Re-encode videos to a constant frame rate. Phone recordings and screen captures often use variable frame rates, which causes choppy playback and sync issues when editing.

**Parameters**: FPS (default 30), no-audio flag.

| Surface | Support |
| --- | --- |
| CLI | `tiles doctor-reencode <targets> --fps 30 --no-audio` |
| TUI | Yes |
| Tiles Studio | Yes — FPS input, no-audio toggle |

## Trim Start / Doctor (`doctor-trim-start`)

Remove a set number of seconds from the beginning of each video. Useful for fixing black or corrupted first frames that some cameras produce.

**Parameters**: seconds to trim (default 1.0), no-audio flag.

| Surface | Support |
| --- | --- |
| CLI | `tiles doctor-trim-start <targets> --seconds 1.0 --no-audio` |
| TUI | Yes |
| Tiles Studio | Yes — seconds input, no-audio toggle |

## Slow Motion (`slowmo`)

Create slow-motion versions of videos. A 2x slowdown makes a 10-second clip last 20 seconds. The CLI factor is the inverse: `--factor 0.5` for 2x slower.

**Parameters**: factor (CLI: 0-1 range, Studio: 1.5x-8x slowdown slider), no-audio flag.

| Surface | Support |
| --- | --- |
| CLI | `tiles slowmo <targets> --factor 0.5 --no-audio` |
| TUI | Yes |
| Tiles Studio | Yes — slowdown slider (auto-inverts for CLI), no-audio toggle |

## Organize by Orientation (`organize-landscape`)

Move videos into landscape/ and portrait/ subfolders based on their aspect ratio. Helpful for separating phone footage (portrait) from camera footage (landscape) before tiling.

| Surface | Support |
| --- | --- |
| CLI | `tiles organize-landscape <folders>` |
| TUI | Yes |
| Tiles Studio | Yes |
