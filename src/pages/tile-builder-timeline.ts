import { videoUrl, thumbUrl, frameUrl } from "@/api/client";
import type { TileSettingEntry, TimelineClipEntry, VideoEntry } from "@/types";
import { defaultTileSetting, orderedFolderVideos } from "./tile-builder-utils";

export type ResolvedTimelineClip = {
  id: string;
  relPath: string;
  video: VideoEntry;
  trackIndex: number;
  start: number;
  end: number;
  duration: number;
  /** Back-compat alias used by the timeline strip component. */
  seconds: number;
  sourceDuration: number;
  /** Back-compat alias used by the timeline strip component. */
  sourceSeconds: number;
  trimIn: number;
  trimOut: number;
  sourceStart: number;
  sourceEnd: number;
  speed: number;
  src: string;
  poster: string;
  frame: string;
};

export type ResolvedTimelineTrack = {
  tileIndex: number;
  folder?: string;
  folderLabel: string;
  setting: TileSettingEntry;
  entries: TimelineClipEntry[];
  clips: ResolvedTimelineClip[];
  duration: number;
  /** Back-compat alias for page labels. */
  trackSeconds: number;
};

export type ResolvedTimeline = {
  tracks: ResolvedTimelineTrack[];
  duration: number;
};

export function resolveTileBuilderTimeline({
  tileCount,
  folders,
  timelineClips,
  tileSettings,
  videos,
  folderOrders,
  globalMaxDuration,
  maxTotalDuration,
  editMode,
}: {
  tileCount: number;
  folders: string[];
  timelineClips?: TimelineClipEntry[][] | null;
  tileSettings: TileSettingEntry[];
  videos: VideoEntry[];
  folderOrders?: Record<string, string[]>;
  globalMaxDuration?: number | null;
  maxTotalDuration?: number | null;
  editMode: boolean;
}): ResolvedTimeline {
  const videoByRelPath = new Map(videos.map((video) => [video.rel_path, video]));
  const totalLimit = editMode ? null : positiveNumber(maxTotalDuration);

  const tracks = Array.from({ length: tileCount }, (_, tileIndex) => {
    const folder = folders[tileIndex];
    const setting = tileSettings[tileIndex] ?? defaultTileSetting();
    const entries = entriesForTile({
      tileIndex,
      folder,
      timelineClips,
      videos,
      folderOrders,
    });
    const clips = resolveTrackClips({
      tileIndex,
      entries,
      setting,
      videoByRelPath,
      globalMaxDuration,
      totalLimit,
    });
    const duration = clips.at(-1)?.end ?? 0;
    return {
      tileIndex,
      folder,
      folderLabel: folder || "(unassigned)",
      setting,
      entries,
      clips,
      duration,
      trackSeconds: duration,
    } satisfies ResolvedTimelineTrack;
  });

  return {
    tracks,
    duration: tracks.reduce((max, track) => Math.max(max, track.duration), 0),
  };
}

function entriesForTile({
  tileIndex,
  folder,
  timelineClips,
  videos,
  folderOrders,
}: {
  tileIndex: number;
  folder?: string;
  timelineClips?: TimelineClipEntry[][] | null;
  videos: VideoEntry[];
  folderOrders?: Record<string, string[]>;
}): TimelineClipEntry[] {
  if (timelineClips && tileIndex < timelineClips.length) {
    return timelineClips[tileIndex] ?? [];
  }
  if (!folder) return [];
  return orderedFolderVideos(videos, folder, folderOrders?.[folder]).map((video, index) => ({
    id: `source_${tileIndex}_${index}_${video.rel_path}`,
    rel_path: video.rel_path,
  }));
}

function resolveTrackClips({
  tileIndex,
  entries,
  setting,
  videoByRelPath,
  globalMaxDuration,
  totalLimit,
}: {
  tileIndex: number;
  entries: TimelineClipEntry[];
  setting: TileSettingEntry;
  videoByRelPath: Map<string, VideoEntry>;
  globalMaxDuration?: number | null;
  totalLimit?: number | null;
}): ResolvedTimelineClip[] {
  const speed = positiveNumber(setting.speed) ?? 1;
  const clipLimit = positiveNumber(setting.max_duration) ?? positiveNumber(globalMaxDuration);
  const overlap = setting.trans_type === "fade" ? positiveNumber(setting.trans_duration) ?? 0 : 0;
  const clips: ResolvedTimelineClip[] = [];
  let cursor = 0;

  for (const entry of entries) {
    const video = videoByRelPath.get(entry.rel_path);
    if (!video) continue;
    const sourceDuration =
      video.duration && Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 5;
    const trimIn = Math.max(0, Math.min(sourceDuration - 0.25, positiveNumber(entry.trim_in) ?? 0));
    const rawTrimOut = positiveNumber(entry.trim_out) ?? sourceDuration;
    const trimOut = Math.max(trimIn + 0.25, Math.min(sourceDuration, rawTrimOut));
    const trimmedSourceDuration = Math.max(0.25, trimOut - trimIn);
    const cappedSourceDuration = clipLimit
      ? Math.min(trimmedSourceDuration, clipLimit)
      : trimmedSourceDuration;
    const transitionOverlap = clips.length > 0 ? Math.min(overlap, cappedSourceDuration / speed - 0.25) : 0;
    const duration = Math.max(0.25, cappedSourceDuration / speed - Math.max(0, transitionOverlap));
    const start = cursor;
    const end = start + duration;

    clips.push({
      id: entry.id,
      relPath: entry.rel_path,
      video,
      trackIndex: tileIndex,
      start,
      end,
      duration,
      seconds: duration,
      sourceDuration,
      sourceSeconds: sourceDuration,
      trimIn,
      trimOut,
      sourceStart: trimIn,
      sourceEnd: trimIn + cappedSourceDuration,
      speed,
      src: videoUrl(video.rel_path),
      poster: thumbUrl(video.rel_path),
      frame: frameUrl(video.rel_path, trimIn),
    });
    cursor = end;
    if (totalLimit && cursor >= totalLimit) break;
  }

  return clips;
}

export function findActiveTimelineClip(track: ResolvedTimelineTrack, time: number) {
  return track.clips.find((clip) => time >= clip.start && time < clip.end) ?? null;
}

/**
 * On-screen width (px) of a resolved clip at the given time scale. The single
 * source of truth for clip block width across the video and audio tracks —
 * `seconds` is the resolver's speed-adjusted timeline duration, so this stays
 * correct for trims, per-clip max-duration capping, and speed.
 */
export function clipPixelWidth(clip: { seconds: number }, pxPerSecond: number): number {
  return Math.max(3, clip.seconds * pxPerSecond);
}

function positiveNumber(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}
