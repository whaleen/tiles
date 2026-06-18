import { describe, it, expect } from "vitest";
import {
  resolveTileBuilderTimeline,
  clipPixelWidth,
  findActiveTimelineClip,
} from "@/pages/tile-builder-timeline";
import { defaultTileSetting } from "@/pages/tile-builder-utils";
import type { TimelineClipEntry, VideoEntry } from "@/types";

function video(rel: string, duration: number | null): VideoEntry {
  return { folder: "f", name: rel, rel_path: rel, duration };
}

function clip(rel: string, extra: Partial<TimelineClipEntry> = {}): TimelineClipEntry {
  return { id: `id-${rel}-${JSON.stringify(extra)}`, rel_path: rel, ...extra };
}

// Resolve a single tile from explicit timeline clips, with sensible defaults.
function resolveOne(
  videos: VideoEntry[],
  clips: TimelineClipEntry[],
  opts: { editMode?: boolean; maxTotalDuration?: number | null } = {}
) {
  const t = resolveTileBuilderTimeline({
    tileCount: 1,
    folders: ["f"],
    timelineClips: [clips],
    tileSettings: [defaultTileSetting()],
    videos,
    folderOrders: {},
    globalMaxDuration: null,
    maxTotalDuration: opts.maxTotalDuration ?? null,
    editMode: opts.editMode ?? true,
  });
  return t.tracks[0];
}

describe("resolveTileBuilderTimeline — duration math", () => {
  it("uses the full source duration for an untrimmed clip", () => {
    const track = resolveOne([video("a", 10)], [clip("a")]);
    expect(track.clips).toHaveLength(1);
    const c = track.clips[0];
    expect(c.start).toBe(0);
    expect(c.end).toBeCloseTo(10);
    expect(c.duration).toBeCloseTo(10);
    expect(c.seconds).toBeCloseTo(10);
    expect(track.duration).toBeCloseTo(10);
  });

  it("accumulates start/end across multiple clips", () => {
    const track = resolveOne([video("a", 10), video("b", 5)], [clip("a"), clip("b")]);
    expect(track.clips.map((c) => [c.start, c.end])).toEqual([
      [0, 10],
      [10, 15],
    ]);
    expect(track.duration).toBeCloseTo(15);
  });

  it("falls back to a default duration when the source duration is missing", () => {
    const track = resolveOne([video("a", null)], [clip("a")]);
    expect(track.clips[0].duration).toBeCloseTo(5);
  });
});

describe("resolveTileBuilderTimeline — trim in/out", () => {
  it("shows only the trimmed source window", () => {
    const track = resolveOne([video("a", 10)], [clip("a", { trim_in: 2, trim_out: 8 })]);
    const c = track.clips[0];
    expect(c.trimIn).toBeCloseTo(2);
    expect(c.trimOut).toBeCloseTo(8);
    expect(c.sourceStart).toBeCloseTo(2);
    expect(c.sourceEnd).toBeCloseTo(8);
    expect(c.duration).toBeCloseTo(6);
  });

  it("clamps trim_out past the source end", () => {
    const track = resolveOne([video("a", 10)], [clip("a", { trim_out: 999 })]);
    const c = track.clips[0];
    expect(c.trimOut).toBeCloseTo(10);
    expect(c.duration).toBeCloseTo(10);
  });

  it("clamps trim_in near the source end and keeps a minimum window", () => {
    const track = resolveOne([video("a", 10)], [clip("a", { trim_in: 999 })]);
    const c = track.clips[0];
    expect(c.trimIn).toBeCloseTo(9.75);
    expect(c.duration).toBeCloseTo(0.25);
  });
});

describe("resolveTileBuilderTimeline — longest-track + short tracks", () => {
  it("reports overall duration as the longest track; shorter tracks stay short", () => {
    const t = resolveTileBuilderTimeline({
      tileCount: 2,
      folders: ["f", "f"],
      timelineClips: [[clip("a")], [clip("b")]],
      tileSettings: [defaultTileSetting(), defaultTileSetting()],
      videos: [video("a", 10), video("b", 15)],
      folderOrders: {},
      globalMaxDuration: null,
      maxTotalDuration: null,
      editMode: true,
    });
    expect(t.tracks[0].duration).toBeCloseTo(10);
    expect(t.tracks[1].duration).toBeCloseTo(15);
    expect(t.duration).toBeCloseTo(15);
  });

  it("edit mode ignores maxTotalDuration; non-edit mode caps the track", () => {
    const videos = [video("a", 10), video("b", 10), video("c", 10)];
    const clips = [clip("a"), clip("b"), clip("c")];
    const edit = resolveOne(videos, clips, { editMode: true, maxTotalDuration: 12 });
    const capped = resolveOne(videos, clips, { editMode: false, maxTotalDuration: 12 });
    expect(edit.clips).toHaveLength(3);
    expect(capped.clips.length).toBeLessThan(3);
  });
});

describe("clipPixelWidth", () => {
  it("scales seconds by the pixels-per-second", () => {
    expect(clipPixelWidth({ seconds: 10 }, 16)).toBe(160);
    expect(clipPixelWidth({ seconds: 2.5 }, 8)).toBe(20);
  });

  it("enforces a 3px minimum for tiny clips", () => {
    expect(clipPixelWidth({ seconds: 0.1 }, 16)).toBe(3);
    expect(clipPixelWidth({ seconds: 0 }, 16)).toBe(3);
  });
});

describe("findActiveTimelineClip", () => {
  const track = resolveOne([video("a", 10), video("b", 10)], [clip("a"), clip("b")]);

  it("finds the clip whose [start, end) window contains the time", () => {
    expect(findActiveTimelineClip(track, 5)?.relPath).toBe("a");
    expect(findActiveTimelineClip(track, 10)?.relPath).toBe("b"); // boundary is inclusive of start
    expect(findActiveTimelineClip(track, 15)?.relPath).toBe("b");
  });

  it("returns null outside the timeline", () => {
    expect(findActiveTimelineClip(track, -1)).toBeNull();
    expect(findActiveTimelineClip(track, 999)).toBeNull();
  });
});
