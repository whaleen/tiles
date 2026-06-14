import { thumbUrl, videoUrl, outVideoUrl } from "@/api/client";
import type {
  TileSettingEntry,
  TileSettings,
  LayoutRect,
  VideoEntry,
} from "@/types";
import type { LayoutNode } from "@/components/tile-builder/tile-grid-preview";

// --- Canvas helpers ---

export function canvasPresetKey(w?: number | null, h?: number | null): string {
  const key = `${w ?? 1920}x${h ?? 1080}`;
  return ["1920x1080", "1080x1920", "1080x1080", "3840x2160"].includes(key) ? key : "custom";
}

// --- Project / path helpers ---

export function getSingleProject(folders: string[]) {
  const set = new Set(
    folders
      .map((f) => f.split("/")[0])
      .filter((p) => p && p.length > 0)
  );
  return set.size === 1 ? Array.from(set)[0] : null;
}

export function extractOutputRel(logOutput?: string | null) {
  if (!logOutput) return null;
  const lines = logOutput.split("\n");
  for (const line of lines) {
    if (line.startsWith("Output: ")) {
      return toRelPath(line.replace("Output: ", "").trim());
    }
    if (line.startsWith("\u2713 Created ")) {
      return toRelPath(line.replace("\u2713 Created ", "").trim());
    }
  }
  return null;
}

export function toRelPath(path: string) {
  if (path.startsWith("src/") || path.startsWith("outputs/")) return path;
  const srcIndex = path.lastIndexOf("/src/");
  if (srcIndex >= 0) {
    return path.slice(srcIndex + 1);
  }
  const outIndex = path.lastIndexOf("/outputs/");
  if (outIndex >= 0) {
    return path.slice(outIndex + 1);
  }
  return path;
}

export function isRepoOutputPath(path: string) {
  return path.startsWith("src/") || path.startsWith("outputs/");
}

export function mediaUrlForRel(relPath: string) {
  if (relPath.startsWith("src/")) {
    return videoUrl(relPath.replace(/^src\//, ""));
  }
  return outVideoUrl(relPath);
}

export function formatEpoch(epochSeconds: number) {
  if (!epochSeconds) return "";
  return new Date(epochSeconds * 1000).toLocaleString();
}

// --- Folder thumbs ---

export function buildFolderThumbs(videos: { folder: string; rel_path: string }[]) {
  const thumbs: Record<string, string[]> = {};
  for (const video of videos) {
    if (!video.folder) continue;
    const segments = video.folder.split("/");
    let current = "";
    for (const seg of segments) {
      current = current ? `${current}/${seg}` : seg;
      if (current.split("/").includes("outputs")) continue;
      if (!thumbs[current]) thumbs[current] = [];
      if (thumbs[current].length < 4) {
        thumbs[current].push(thumbUrl(video.rel_path));
      }
    }
  }
  return thumbs;
}

// --- Timeline types ---

export type TileTimelineEntry = {
  tileIndex: number;
  folderLabel: string;
  seconds: number;
  percent: number;
  valueLabel: string;
  dropsEarly: boolean;
  shortByLabel?: string;
  hasRenderableInput: boolean;
  unknownDurationCount: number;
};

export type TileTimeline = {
  summary: string;
  entries: TileTimelineEntry[];
  totalSeconds: number;
};

export type TimelineFile = {
  relPath: string;
  duration: number | null;
};

// --- Timeline logic ---

export function buildTileTimeline({
  tileCount,
  folders,
  tileSettings,
  videos,
  renderMode,
  outputLengthPolicy,
  sourceRepeatPolicy,
  distributionMode,
  globalMaxDuration,
  maxTotalDuration,
  folderOrders,
  blankAfterEnd = false,
}: {
  tileCount: number;
  folders: string[];
  tileSettings: TileSettingEntry[];
  videos: VideoEntry[];
  renderMode: string;
  outputLengthPolicy: "shortest" | "longest" | "fixed";
  sourceRepeatPolicy: "allow" | "no_reuse_per_tile" | "no_reuse_global";
  distributionMode?: string | null;
  globalMaxDuration?: number | null;
  maxTotalDuration?: number | null;
  folderOrders?: Record<string, string[]>;
  blankAfterEnd?: boolean;
}): TileTimeline {
  const cappedTotal = asPositiveNumber(maxTotalDuration);
  const previewLimit =
    renderMode === "preview" ? 3 : renderMode === "fast-preview" ? 2 : Number.POSITIVE_INFINITY;
  const distribution = distributionMode ?? "none";
  const normalizedSettings = Array.from({ length: tileCount }, (_, i) =>
    tileSettings[i] ?? defaultTileSetting()
  );
  const entries: TileTimelineEntry[] = [];
  const sameFolder =
    tileCount > 0 &&
    folders.length >= tileCount &&
    folders.slice(0, tileCount).every((f) => f && f === folders[0]);

  let distributedVideoGroups: TimelineFile[][] | null = null;
  let distributedTrimDuration: number | null = null;
  const usedGlobal = new Set<string>();
  let totalUnknownDurations = 0;
  if (distribution !== "none" && sameFolder && folders[0]) {
    const firstTileMax =
      asPositiveNumber(normalizedSettings[0]?.max_duration) ??
      asPositiveNumber(globalMaxDuration);
    const sharedVideoFiles = listFolderFiles(videos, folders[0], "video", folderOrders?.[folders[0]]);
    const filtered = filterVideosWithTrimFallback(sharedVideoFiles, firstTileMax);
    distributedTrimDuration = filtered.trimDuration;
    distributedVideoGroups = distributeFiles(
      filtered.files,
      tileCount,
      distribution,
      `${folders[0]}::shared`
    );
  }

  for (let tileIndex = 0; tileIndex < tileCount; tileIndex += 1) {
    const folder = folders[tileIndex];
    const label = folder || "(unassigned)";
    const setting = normalizedSettings[tileIndex];

    const mode = setting.mode === "image" ? "image" : "video";
    const speed = asPositiveNumber(setting.speed) ?? 1;
    const clipLimit = asPositiveNumber(setting.max_duration) ?? asPositiveNumber(globalMaxDuration);
    const transitionType = setting.trans_type || "none";
    const transition =
      transitionType === "fade"
        ? asPositiveNumber(setting.trans_duration) ?? 0
        : 0;
    let seconds = 0;
    let hasRenderableInput = false;
    let unknownDurationCount = 0;

    if (folder) {
      if (mode === "image") {
        const imageSeconds = asPositiveNumber(setting.image_duration) ?? 5;
        const baseFolder = hasFolderFiles(videos, `${folder}/images`, "image")
          ? `${folder}/images`
          : folder;
        let images = listFolderFiles(videos, baseFolder, "image", folderOrders?.[folder]);
        images = orderFiles(images, distribution, `${folder}::img::${tileIndex}`);
        images = applySourceRepeatPolicy(images, sourceRepeatPolicy, usedGlobal);
        images = limitImagesByDuration(images, cappedTotal, imageSeconds);
        if (previewLimit !== Number.POSITIVE_INFINITY && images.length > previewLimit) {
          if (distribution === "random" || distribution === "shuffle-round-robin") {
            images = orderFiles(images, distribution, `${folder}::img-preview::${tileIndex}`);
          }
          images = images.slice(0, previewLimit);
        }
        hasRenderableInput = images.length > 0;
        seconds = imageSeconds * images.length;
      } else {
        let videoFiles: TimelineFile[] = [];
        let trimDuration: number | null = null;
        if (distributedVideoGroups) {
          videoFiles = distributedVideoGroups[tileIndex] ?? [];
          trimDuration = distributedTrimDuration;
        } else {
          const sourceFolder =
            setting.use_landscape && hasFolderFiles(videos, `${folder}/landscape`, "video")
              ? `${folder}/landscape`
              : folder;
          const filtered = filterVideosWithTrimFallback(
            listFolderFiles(videos, sourceFolder, "video", folderOrders?.[folder]),
            clipLimit
          );
          videoFiles = filtered.files;
          trimDuration = filtered.trimDuration;
          if (distribution !== "none") {
            videoFiles = orderFiles(videoFiles, distribution, `${folder}::vid::${tileIndex}`);
          }
        }
        videoFiles = applySourceRepeatPolicy(videoFiles, sourceRepeatPolicy, usedGlobal);

        const picked = limitVideosByDuration(
          videoFiles,
          cappedTotal,
          transitionType,
          transition,
          speed
        );
        let pickedLimited = picked;
        if (previewLimit !== Number.POSITIVE_INFINITY && pickedLimited.length > previewLimit) {
          if (distribution === "random" || distribution === "shuffle-round-robin") {
            pickedLimited = orderFiles(
              pickedLimited,
              distribution,
              `${folder}::vid-preview::${tileIndex}`
            );
          }
          pickedLimited = pickedLimited.slice(0, previewLimit);
        }
        hasRenderableInput = pickedLimited.length > 0;
        unknownDurationCount = pickedLimited.filter((file) => file.duration === null).length;
        totalUnknownDurations += unknownDurationCount;
        // Missing frontend metadata should not turn a clip-duration cap into an
        // estimated clip length. Use a small fallback; the renderer probes exact
        // durations at render time.
        const unknownDurationHint = asPositiveNumber(setting.image_duration) ?? 5;
        seconds = calculateVideoTimelineDuration(
          pickedLimited,
          speed,
          transitionType,
          transition,
          trimDuration,
          unknownDurationHint
        );
      }
    }

    entries.push({
      tileIndex,
      folderLabel: label,
      seconds,
      percent: 0,
      valueLabel: "100%",
      dropsEarly: false,
      shortByLabel: undefined,
      hasRenderableInput,
      unknownDurationCount,
    });
  }

  if (entries.length === 0) {
    return {
      summary: "Assign folders to see timeline estimates.",
      entries,
      totalSeconds: 0,
    };
  }

  const longest = Math.max(...entries.map((entry) => entry.seconds), 0);
  const shortest = Math.min(...entries.map((entry) => entry.seconds), longest);
  const fixed = asPositiveNumber(maxTotalDuration);
  const loopsEnabled =
    !blankAfterEnd && outputLengthPolicy !== "shortest" && sourceRepeatPolicy === "allow";

  // Mirror the renderer's target-duration math (run_tile in cli/src/main.rs):
  // policy target, capped by max-total, then — when clips can't be looped to
  // fill — clamped to the shortest tile. That clamp is the frozen-tile fix:
  // longer tiles are trimmed to the output length rather than holding their
  // last frame.
  let rendererDuration =
    outputLengthPolicy === "shortest"
      ? shortest
      : outputLengthPolicy === "fixed" && fixed
        ? fixed
        : longest;
  if (outputLengthPolicy !== "fixed" && fixed) {
    rendererDuration = Math.min(rendererDuration, fixed);
  }
  if (!loopsEnabled && !blankAfterEnd) {
    rendererDuration = Math.min(rendererDuration, shortest);
  }

  const likelyFailCount = entries.filter(
    (entry) => entry.folderLabel !== "(unassigned)" && !entry.hasRenderableInput
  ).length;

  const middle = blankAfterEnd
    ? " Shorter tiles go blank after their clips end."
    : loopsEnabled
      ? " Compositor looping is enabled (allow reuse), so all tiles fill the full output."
      : sourceRepeatPolicy !== "allow"
        ? ` No clip reuse, so the output runs to the shortest tile (${formatDurationSeconds(rendererDuration)}); longer tiles are trimmed.`
        : ` Output is trimmed to the shortest tile (${formatDurationSeconds(rendererDuration)}).`;
  const tail = `${likelyFailCount > 0 ? ` Render likely fails: ${likelyFailCount} tile(s) have no source clips after filters/policies.` : ""}${totalUnknownDurations > 0 ? ` Estimate uses fallback duration for ${totalUnknownDurations} clip(s) missing metadata.` : ""}`;
  const summary =
    longest > 0
      ? `Output policy: ${outputLengthPolicy}. Renderer target is ${formatDurationSeconds(rendererDuration)}.${middle}${tail}`
      : "Projected output length is 0:00. Check folder assignment, tile mode, and duration limits.";

  if (blankAfterEnd) {
    return {
      summary,
      totalSeconds: rendererDuration,
      entries: entries.map((entry) => ({
        ...entry,
        percent: rendererDuration > 0 ? Math.min(100, (entry.seconds / rendererDuration) * 100) : 0,
        valueLabel: formatDurationSeconds(entry.seconds),
        dropsEarly: entry.hasRenderableInput && entry.seconds < rendererDuration - 0.05,
        shortByLabel:
          entry.hasRenderableInput && entry.seconds < rendererDuration - 0.05
            ? `blank after ${formatDurationSeconds(entry.seconds)}`
            : undefined,
      })),
    };
  }

  if (loopsEnabled) {
    return {
      summary,
      totalSeconds: rendererDuration,
      entries: entries.map((entry) => ({
        ...entry,
        percent: 100,
        valueLabel: formatDurationSeconds(rendererDuration),
        dropsEarly: false,
        shortByLabel: undefined,
      })),
    };
  }

  // No looping: output ends at `rendererDuration` and every tile is at least
  // that long, so nothing freezes — longer tiles are trimmed. Empty tiles
  // (no clips) still fail the render, so flag those.
  return {
    summary,
    totalSeconds: rendererDuration,
    entries: entries.map((entry) => {
      if (!entry.hasRenderableInput) {
        return {
          ...entry,
          percent: 0,
          valueLabel: "no clips",
          dropsEarly: true,
          shortByLabel: undefined,
        };
      }
      return {
        ...entry,
        percent: 100,
        valueLabel: formatDurationSeconds(rendererDuration),
        dropsEarly: false,
        shortByLabel: undefined,
      };
    }),
  };
}

export function asPositiveNumber(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

function listFolderFiles(
  videos: VideoEntry[],
  folder: string,
  kind: "video" | "image",
  orderArray?: string[]
): TimelineFile[] {
  const items = videos
    .filter(
      (v) => v.folder === folder || v.folder.startsWith(`${folder}/`)
    )
    .filter((v) =>
      kind === "video" ? isVideoPath(v.rel_path) : isImagePath(v.rel_path)
    )
    .map((v) => ({
      relPath: v.rel_path,
      duration: asPositiveNumber(v.duration),
    }));

  if (orderArray && orderArray.length > 0) {
    const orderIndex = new Map(
      orderArray.map((entry, i) => [entry.split("/").pop() ?? entry, i])
    );
    items.sort((a, b) => {
      const aName = a.relPath.split("/").pop() ?? a.relPath;
      const bName = b.relPath.split("/").pop() ?? b.relPath;
      const ai = orderIndex.get(aName);
      const bi = orderIndex.get(bName);
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (ai !== undefined) return -1;
      if (bi !== undefined) return 1;
      return a.relPath.localeCompare(b.relPath);
    });
  } else {
    items.sort((a, b) => a.relPath.localeCompare(b.relPath));
  }

  return items;
}

function hasFolderFiles(
  videos: VideoEntry[],
  folder: string,
  kind: "video" | "image"
) {
  return listFolderFiles(videos, folder, kind).length > 0;
}

function filterVideosWithTrimFallback(
  files: TimelineFile[],
  maxDuration: number | null
) {
  if (!maxDuration) {
    return { files, trimDuration: null as number | null };
  }

  const filtered = files.filter((file) => {
    if (!file.duration) return true;
    return file.duration <= maxDuration;
  });
  if (filtered.length === 0 && files.length > 0) {
    return { files, trimDuration: maxDuration };
  }
  return { files: filtered, trimDuration: null as number | null };
}

function applySourceRepeatPolicy(
  files: TimelineFile[],
  policy: "allow" | "no_reuse_per_tile" | "no_reuse_global",
  usedGlobal: Set<string>
) {
  if (policy === "allow") return files;

  const uniqueTile: TimelineFile[] = [];
  const seenTile = new Set<string>();
  for (const file of files) {
    if (seenTile.has(file.relPath)) continue;
    seenTile.add(file.relPath);
    uniqueTile.push(file);
  }
  if (policy === "no_reuse_per_tile") return uniqueTile;

  const uniqueGlobal: TimelineFile[] = [];
  for (const file of uniqueTile) {
    if (usedGlobal.has(file.relPath)) continue;
    usedGlobal.add(file.relPath);
    uniqueGlobal.push(file);
  }
  return uniqueGlobal;
}

function limitVideosByDuration(
  files: TimelineFile[],
  targetDuration: number | null,
  transitionType: string,
  transitionDuration: number,
  speed: number
) {
  if (!targetDuration || targetDuration <= 0) return files;
  const overlap = transitionType === "fade" ? Math.max(0, transitionDuration) : 0;
  const speedFactor = speed > 0 ? speed : 1;
  const out: TimelineFile[] = [];
  let total = 0;

  for (const file of files) {
    out.push(file);
    if (!file.duration) continue;
    const clip = file.duration / speedFactor;
    total += out.length > 1 ? clip - overlap : clip;
    if (total >= targetDuration) break;
  }

  return out;
}

function calculateVideoTimelineDuration(
  files: TimelineFile[],
  speed: number,
  transitionType: string,
  transitionDuration: number,
  trimDuration: number | null,
  unknownDurationHint: number
) {
  const speedFactor = speed > 0 ? speed : 1;
  const overlap = transitionType === "fade" ? Math.max(0, transitionDuration) : 0;
  let total = 0;
  let clips = 0;

  for (const file of files) {
    const raw = file.duration;
    const source = trimDuration && raw
      ? Math.min(raw, trimDuration)
      : raw ?? trimDuration ?? unknownDurationHint;
    if (!source) continue;
    clips += 1;
    const clip = source / speedFactor;
    total += clips > 1 ? clip - overlap : clip;
  }

  return Math.max(0, total);
}

function limitImagesByDuration(
  files: TimelineFile[],
  targetDuration: number | null,
  imageDuration: number
) {
  if (!targetDuration || targetDuration <= 0 || imageDuration <= 0) {
    return files;
  }
  const maxCount = Math.floor(targetDuration / imageDuration);
  if (maxCount <= 0) {
    return files.slice(0, 1);
  }
  return files.slice(0, maxCount);
}

function orderFiles(files: TimelineFile[], mode: string, seedKey: string) {
  if (mode !== "random" && mode !== "shuffle-round-robin") {
    return files;
  }
  return deterministicShuffle(files, seedKey);
}

function distributeFiles(
  files: TimelineFile[],
  numTiles: number,
  mode: string,
  seedKey: string
) {
  const out = Array.from({ length: numTiles }, () => [] as TimelineFile[]);
  if (numTiles <= 0 || files.length === 0) return out;

  if (mode === "sequential" || mode === "random") {
    const working = mode === "random" ? deterministicShuffle(files, `${seedKey}::rand`) : files;
    const total = working.length;
    const perTile = Math.floor(total / numTiles);
    const remainder = total % numTiles;
    let start = 0;
    for (let i = 0; i < numTiles; i += 1) {
      const size = perTile + (i < remainder ? 1 : 0);
      const end = Math.min(total, start + size);
      out[i] = working.slice(start, end);
      start = end;
    }
    return out;
  }

  if (mode === "shuffle-round-robin") {
    const working = deterministicShuffle(files, `${seedKey}::srr`);
    for (let i = 0; i < working.length; i += 1) {
      out[i % numTiles].push(working[i]);
    }
    return out;
  }

  for (let i = 0; i < files.length; i += 1) {
    out[i % numTiles].push(files[i]);
  }
  return out;
}

function deterministicShuffle(files: TimelineFile[], seedKey: string) {
  const out = [...files];
  if (out.length < 2) return out;
  let seed = hashString(seedKey) ^ out.length;
  for (let i = out.length - 1; i > 0; i -= 1) {
    seed ^= seed << 13;
    seed ^= seed >> 7;
    seed ^= seed << 17;
    const j = Math.abs(seed) % (i + 1);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

function hashString(input: string) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash | 0;
}

function isVideoPath(path: string) {
  const lower = path.toLowerCase();
  return (
    lower.endsWith(".mp4") ||
    lower.endsWith(".mov") ||
    lower.endsWith(".avi") ||
    lower.endsWith(".mkv") ||
    lower.endsWith(".flv") ||
    lower.endsWith(".wmv") ||
    lower.endsWith(".m4v") ||
    lower.endsWith(".webm")
  );
}

function isImagePath(path: string) {
  const lower = path.toLowerCase();
  return (
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".png") ||
    lower.endsWith(".gif") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".bmp") ||
    lower.endsWith(".tif") ||
    lower.endsWith(".tiff")
  );
}

/**
 * The ordered video clips for a tile's folder, matching how the renderer
 * sequences them: saved order first (by file name), then any unlisted clips
 * alphabetically. Used by the tile-builder timeline strip so what you drag
 * matches what renders.
 */
export function orderedFolderVideos(
  videos: VideoEntry[],
  folder: string,
  orderArray?: string[]
): VideoEntry[] {
  const items = videos.filter(
    (v) =>
      (v.folder === folder || v.folder.startsWith(`${folder}/`)) &&
      isVideoPath(v.rel_path)
  );
  if (orderArray && orderArray.length > 0) {
    const orderIndex = new Map(
      orderArray.map((entry, i) => [entry.split("/").pop() ?? entry, i])
    );
    return [...items].sort((a, b) => {
      const ai = orderIndex.get(a.name);
      const bi = orderIndex.get(b.name);
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (ai !== undefined) return -1;
      if (bi !== undefined) return 1;
      return a.name.localeCompare(b.name);
    });
  }
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

export function formatDurationSeconds(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// --- Default tile setting ---

export function defaultTileSetting(): TileSettingEntry {
  return {
    trans_type: "none",
    trans_duration: 0,
    crop_position: "center",
    speed: 1.0,
    mode: "video",
    image_duration: 5.0,
    use_landscape: false,
    max_duration: null,
  };
}

/** A fresh, empty composition — mirrors the backend `default_tile_settings()`. */
export function defaultTileSettings(): TileSettings {
  return {
    layout_code: "2x1",
    crop_mode: "crop",
    layout_mode: null,
    layout_rects: [],
    layout_tree: null,
    render_mode: null,
    output_mode: null,
    no_overwrite: true,
    tile_folders: [],
    audio_enabled: false,
    audio_tiles: [],
    audio_tile: null,
    max_total_duration: null,
    max_duration: null,
    distribution_mode: null,
    tile_settings: [],
    timeline_clips: [],
    sizing_mode: null,
    canvas_width: 1920,
    canvas_height: 1080,
    padding: 0,
    bg_color: "000000",
    no_repeat: false,
    output_length_policy: "longest",
    source_repeat_policy: "allow",
    mode: "edit",
  };
}

/**
 * A composition's mode: the explicit `mode` flag, or — for comps saved before
 * the flag existed — inferred from whether any generative setting is active.
 * Must mirror `resolve_composition_mode` in cli/src/main.rs.
 */
export function resolveCompositionMode(
  s: TileSettings
): "edit" | "randomized" {
  if (s.mode === "edit" || s.mode === "randomized") return s.mode;
  const generative =
    (!!s.distribution_mode && s.distribution_mode !== "none") ||
    (!!s.source_repeat_policy && s.source_repeat_policy !== "allow") ||
    (!!s.output_length_policy && s.output_length_policy !== "longest");
  return generative ? "randomized" : "edit";
}

// --- Layout tree ---

let layoutIdSeed = 0;

export function nextLayoutId() {
  layoutIdSeed += 1;
  return `layout_${layoutIdSeed}`;
}

export function buildPresetLayoutTree(layoutCode: string, tileCount: number): LayoutNode {
  const leaves = Array.from({ length: tileCount }, (_, i) => ({
    id: nextLayoutId(),
    type: "leaf" as const,
    tileIndex: i,
  }));

  const split = (
    direction: "row" | "column",
    ratio: number,
    left: LayoutNode,
    right: LayoutNode
  ): LayoutNode => ({
    id: nextLayoutId(),
    type: "split",
    direction,
    ratio,
    children: [left, right],
  });

  const linearSplit = (direction: "row" | "column", nodes: LayoutNode[]): LayoutNode => {
    if (nodes.length === 1) return nodes[0];
    const ratio = 1 / nodes.length;
    const head = nodes[0];
    const tail = linearSplit(direction, nodes.slice(1));
    return split(direction, ratio, head, tail);
  };

  if (layoutCode === "2x1" || layoutCode === "3x1" || layoutCode === "4x1") {
    return linearSplit("row", leaves);
  }
  if (layoutCode === "1x2" || layoutCode === "1x3" || layoutCode === "1x4") {
    return linearSplit("column", leaves);
  }
  if (layoutCode === "2x2" || layoutCode === "2x3" || layoutCode === "3x2" || layoutCode === "3x3") {
    const [rows, cols] =
      layoutCode === "2x2"
        ? [2, 2]
        : layoutCode === "2x3"
        ? [3, 2]
        : layoutCode === "3x2"
        ? [2, 3]
        : [3, 3];
    const rowNodes: LayoutNode[] = [];
    let idx = 0;
    for (let r = 0; r < rows; r += 1) {
      const rowLeaves = leaves.slice(idx, idx + cols);
      idx += cols;
      rowNodes.push(linearSplit("row", rowLeaves));
    }
    return linearSplit("column", rowNodes);
  }
  if (layoutCode === "1+2" || layoutCode === "left-big-right-stack") {
    const right = split("column", 0.5, leaves[1], leaves[2]);
    return split("row", 0.5, leaves[0], right);
  }
  if (layoutCode === "2+1") {
    const left = split("column", 0.5, leaves[0], leaves[1]);
    return split("row", 0.5, left, leaves[2]);
  }
  if (layoutCode === "1+3") {
    const right = split(
      "column",
      1 / 3,
      leaves[1],
      split("column", 0.5, leaves[2], leaves[3])
    );
    return split("row", 0.5, leaves[0], right);
  }
  if (layoutCode === "2x2-focus" || layoutCode === "top-big-bottom-stack") {
    const bottom = split("row", 0.5, leaves[1], leaves[2]);
    return split("column", 2 / 3, leaves[0], bottom);
  }
  if (layoutCode === "3x3-focus") {
    const topRight = split("column", 0.5, leaves[1], leaves[2]);
    const topGroup = split("row", 2 / 3, leaves[0], topRight);
    const bottomRow = linearSplit("row", [leaves[3], leaves[4], leaves[5]]);
    return split("column", 2 / 3, topGroup, bottomRow);
  }

  return linearSplit("row", leaves);
}

export function countLayoutLeaves(node: LayoutNode): number {
  if (node.type === "leaf") return 1;
  return countLayoutLeaves(node.children[0]) + countLayoutLeaves(node.children[1]);
}

export function maxLayoutTileIndex(node: LayoutNode): number {
  if (node.type === "leaf") return node.tileIndex;
  return Math.max(
    maxLayoutTileIndex(node.children[0]),
    maxLayoutTileIndex(node.children[1])
  );
}

export function splitLayoutLeaf(
  node: LayoutNode,
  tileIndex: number,
  direction: "row" | "column",
  place: "before" | "after",
  newTileIndex: number
): LayoutNode | null {
  if (node.type === "leaf") {
    if (node.tileIndex !== tileIndex) return null;
    const newLeaf: LayoutNode = {
      id: nextLayoutId(),
      type: "leaf",
      tileIndex: newTileIndex,
    };
    const first = place === "before" ? newLeaf : node;
    const second = place === "before" ? node : newLeaf;
    return {
      id: nextLayoutId(),
      type: "split",
      direction,
      ratio: 0.5,
      children: [first, second],
    };
  }

  const left = splitLayoutLeaf(node.children[0], tileIndex, direction, place, newTileIndex);
  if (left) {
    return { ...node, children: [left, node.children[1]] };
  }
  const right = splitLayoutLeaf(node.children[1], tileIndex, direction, place, newTileIndex);
  if (right) {
    return { ...node, children: [node.children[0], right] };
  }
  return null;
}

export function updateLayoutRatio(node: LayoutNode, nodeId: string, ratio: number): LayoutNode {
  if (node.type === "split") {
    if (node.id === nodeId) {
      return { ...node, ratio: Math.min(0.9, Math.max(0.1, ratio)) };
    }
    return {
      ...node,
      children: [
        updateLayoutRatio(node.children[0], nodeId, ratio),
        updateLayoutRatio(node.children[1], nodeId, ratio),
      ],
    };
  }
  return node;
}

export function findLayoutRatio(node: LayoutNode, nodeId: string): number | null {
  if (node.type === "split") {
    if (node.id === nodeId) return node.ratio;
    return (
      findLayoutRatio(node.children[0], nodeId) ??
      findLayoutRatio(node.children[1], nodeId)
    );
  }
  return null;
}

export function computeLayoutRects(root: LayoutNode): LayoutRect[] {
  const rects: LayoutRect[] = [];
  const walk = (node: LayoutNode, x: number, y: number, w: number, h: number) => {
    if (node.type === "leaf") {
      rects[node.tileIndex] = { x, y, w, h };
      return;
    }
    const ratio = Math.min(0.95, Math.max(0.05, node.ratio));
    if (node.direction === "row") {
      const leftW = w * ratio;
      const rightW = w - leftW;
      walk(node.children[0], x, y, leftW, h);
      walk(node.children[1], x + leftW, y, rightW, h);
    } else {
      const topH = h * ratio;
      const bottomH = h - topH;
      walk(node.children[0], x, y, w, topH);
      walk(node.children[1], x, y + topH, w, bottomH);
    }
  };

  walk(root, 0, 0, 1, 1);
  return rects.filter(Boolean);
}

export function removeLayoutLeaf(node: LayoutNode, tileIndex: number): LayoutNode | null {
  if (node.type === "leaf") {
    return node.tileIndex === tileIndex ? null : node;
  }

  const left = removeLayoutLeaf(node.children[0], tileIndex);
  const right = removeLayoutLeaf(node.children[1], tileIndex);

  if (!left && !right) return null;
  if (!left) return right;
  if (!right) return left;
  return { ...node, children: [left, right] };
}

export function normalizeLayoutIndices(node: LayoutNode, removedIndex: number) {
  const reindex = (n: LayoutNode): LayoutNode => {
    if (n.type === "leaf") {
      const nextIndex = n.tileIndex > removedIndex ? n.tileIndex - 1 : n.tileIndex;
      return { ...n, tileIndex: nextIndex };
    }
    return { ...n, children: [reindex(n.children[0]), reindex(n.children[1])] };
  };

  return { tree: reindex(node), removedIndex };
}

export function removeTileSettings(settings: TileSettings, index: number) {
  const folders = [...settings.tile_folders];
  const tileSettings = [...settings.tile_settings];
  const audioTiles = [...settings.audio_tiles];

  folders.splice(index, 1);
  tileSettings.splice(index, 1);

  const nextAudioTiles = audioTiles
    .filter((v) => v !== index)
    .map((v) => (v > index ? v - 1 : v));
  return {
    tile_folders: folders,
    tile_settings: tileSettings,
    audio_tiles: nextAudioTiles,
    audio_tile: null,
  };
}

export function resizeTileSettings(settings: TileSettings, newCount: number) {
  const folders = [...settings.tile_folders];
  const tileSettings = [...settings.tile_settings];
  const audioTiles = [...settings.audio_tiles];

  while (folders.length < newCount) folders.push("");
  while (tileSettings.length < newCount) tileSettings.push(defaultTileSetting());

  const nextAudioTiles = audioTiles.filter((index) => index < newCount);
  return {
    tile_folders: folders.slice(0, newCount),
    tile_settings: tileSettings.slice(0, newCount),
    audio_tiles: nextAudioTiles,
    audio_tile: null,
  };
}
