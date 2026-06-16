import { Fragment, useState, useEffect, useMemo, useRef, useCallback } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { frameUrl, thumbUrl } from "@/api/client";
import { useSettings } from "@/hooks/use-settings";
import { useCompositions } from "@/hooks/use-compositions";
import { useVideos } from "@/hooks/use-videos";
import { useVideoDurations } from "@/hooks/use-video-durations";
import { useFilmstrips } from "@/hooks/use-filmstrips";
import { useWaveforms } from "@/hooks/use-waveforms";
import { useFolderOrders } from "@/hooks/use-folder-orders";
import { useProjects } from "@/hooks/use-projects";
import { useProjectDetailsMap } from "@/hooks/use-project-details-map";
import { CompositionSwitcher } from "@/components/tile-builder/composition-switcher";
import { TileTimelineTrack } from "@/components/tile-builder/tile-timeline-track";
import { TileAudioTrack } from "@/components/tile-builder/tile-audio-track";
import { useActionRunner } from "@/hooks/use-action-runner";
import {
  TileGridPreview,
  type LayoutNode,
  type TilePlayback,
} from "@/components/tile-builder/tile-grid-preview";
import { FolderAssignment } from "@/components/tile-builder/folder-assignment";
import { TileBuilderSidebar } from "@/components/tile-builder/tile-builder-sidebar";
import { ExportDialog } from "@/components/tile-builder/export-dialog";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AudioLines, Eye, EyeOff, Loader2, Pause, Play, Settings2 } from "lucide-react";
import { toast } from "sonner";
import type {
  TileSettings,
  TileSettingEntry,
  LayoutTreeNode,
  TimelineClipEntry,
} from "@/types";
import {
  getSingleProject,
  extractOutputRel,
  buildFolderThumbs,
  formatDurationSeconds,
  orderedFolderVideos,
  resolveCompositionMode,
  defaultTileSetting,
  defaultTileSettings,
  buildPresetLayoutTree,
  countLayoutLeaves,
  maxLayoutTileIndex,
  splitLayoutLeaf,
  updateLayoutRatio,
  findLayoutRatio,
  computeLayoutRects,
  removeLayoutLeaf,
  normalizeLayoutIndices,
  removeTileSettings,
  resizeTileSettings,
} from "./tile-builder-utils";
import { findActiveTimelineClip, resolveTileBuilderTimeline } from "./tile-builder-timeline";

export function TileBuilderPage({ project }: { project?: string }) {
  const {
    compositions,
    activeName: activeComposition,
    setActive: switchComposition,
    saveAs: saveCompositionAs,
    rename: renameComposition,
    remove: removeComposition,
  } = useCompositions(project);
  const { settings, layouts, loading, saveSettings } = useSettings(
    project,
    activeComposition
  );
  const { videos, loading: videosLoading } = useVideos(project);
  const runnerScope = project ?? "__all-projects__";
  const { running, runAction } = useActionRunner(runnerScope);
  const [renderMode, setRenderMode] = useState("preview");
  const [outputMode, setOutputMode] = useState("project");
  const [pickerTileIndex, setPickerTileIndex] = useState<number | null>(null);
  const [layoutTree, setLayoutTree] = useState<LayoutNode | null>(null);
  const [presetOpen, setPresetOpen] = useState(false);
  const [timelineZoom, setTimelineZoom] = useState(16);
  const [timelinePlayhead, setTimelinePlayhead] = useState(0);
  const [timelinePlaying, setTimelinePlaying] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [addClipTileIndex, setAddClipTileIndex] = useState<number | null>(null);
  // Preview-only: tiles temporarily hidden while editing. Not persisted, not
  // part of settings/export — resets on reload/project switch.
  const [hiddenTiles, setHiddenTiles] = useState<Set<number>>(new Set());
  const toggleTileHidden = (tileIndex: number) => {
    setHiddenTiles((prev) => {
      const next = new Set(prev);
      if (next.has(tileIndex)) next.delete(tileIndex);
      else next.add(tileIndex);
      return next;
    });
  };
  // Per-tile audio sub-strip (waveform lane) expand state. Edit-only, ephemeral.
  const [audioOpenTiles, setAudioOpenTiles] = useState<Set<number>>(new Set());
  const toggleTileAudioStrip = (tileIndex: number) => {
    setAudioOpenTiles((prev) => {
      const next = new Set(prev);
      if (next.has(tileIndex)) next.delete(tileIndex);
      else next.add(tileIndex);
      return next;
    });
  };
  const [selectedClip, setSelectedClip] = useState<{ tileIndex: number; clipId: string } | null>(null);
  const timelineScrubbing = useRef(false);
  const playheadRef = useRef(0);
  const playheadLineRef = useRef<HTMLDivElement>(null);
  const lastSigRef = useRef("");

  const safeSettings: TileSettings = settings ?? {
    layout_code: null,
    crop_mode: null,
    layout_mode: null,
    layout_rects: null,
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
    canvas_width: null,
    canvas_height: null,
    padding: null,
    bg_color: null,
    no_repeat: null,
    output_length_policy: null,
    source_repeat_policy: null,
    mode: null,
  };

  const { orders: folderOrders } = useFolderOrders(safeSettings.tile_folders);

  // How many tiles each folder is assigned to (for the "shared scene" badge).
  const folderUsage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of safeSettings.tile_folders) {
      if (f) counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    return counts;
  }, [safeSettings.tile_folders]);

  // --- Sync settings to local state ---

  useEffect(() => {
    setLayoutTree(null);
    setPickerTileIndex(null);
  }, [project, activeComposition]);

  useEffect(() => {
    if (!settings) return;
    if (settings.crop_mode !== "crop") {
      saveSettings({ ...settings, crop_mode: "crop" });
    }
  }, [settings?.crop_mode]);

  useEffect(() => {
    if (!settings) return;
    setRenderMode(settings.render_mode ?? "preview");
    setOutputMode(
      settings.output_mode && settings.output_mode !== "custom"
        ? settings.output_mode
        : "project"
    );
  }, [
    settings?.render_mode,
    settings?.output_mode,
  ]);

  // --- Layout calculations ---

  const currentLayout = layouts.find(
    (l) => l.code === (safeSettings.layout_code || "2x1")
  );
  const tileCount = currentLayout?.tile_count || 2;
  const customLayout = safeSettings.layout_mode === "custom";
  const layoutLeafCount = layoutTree ? countLayoutLeaves(layoutTree) : tileCount;
  const effectiveTileCount = customLayout
    ? layoutLeafCount || safeSettings.layout_rects?.length || tileCount
    : tileCount;

  const updateSettings = (partial: Partial<TileSettings>) => {
    if (!settings) return;
    const next = { ...settings, ...partial };
    const projectForSave =
      project || getSingleProject(next.tile_folders) || undefined;
    saveSettings(next, projectForSave);
  };

  const updateTileCount = (code: string) => {
    if (!settings) return;
    const layout = layouts.find((l) => l.code === code);
    if (!layout) return;
    const newCount = layout.tile_count;

    const resized = resizeTileSettings(settings, newCount);
    saveSettings({
      ...settings,
      layout_code: code,
      ...resized,
    });
  };

  // --- Layout tree effects ---

  useEffect(() => {
    if (customLayout) {
      if (safeSettings.layout_tree) {
        setLayoutTree(safeSettings.layout_tree as LayoutNode);
        return;
      }
      if (layoutTree) return;
      setLayoutTree(buildPresetLayoutTree(safeSettings.layout_code || "2x1", effectiveTileCount));
      return;
    }

    if (!layoutTree || countLayoutLeaves(layoutTree) !== tileCount) {
      setLayoutTree(buildPresetLayoutTree(safeSettings.layout_code || "2x1", tileCount));
    }
  }, [
    tileCount,
    customLayout,
    safeSettings.layout_tree,
    safeSettings.layout_code,
    layoutTree,
    effectiveTileCount,
  ]);

  useEffect(() => {
    if (!settings || !customLayout || !layoutTree) return;
    if (safeSettings.layout_rects && safeSettings.layout_rects.length > 0) return;
    const rects = computeLayoutRects(layoutTree);
    updateSettings({
      layout_mode: "custom",
      layout_rects: rects,
      layout_tree: layoutTree as unknown as LayoutTreeNode,
    });
  }, [settings, customLayout, layoutTree, safeSettings.layout_rects]);

  // --- Run handler ---

  const handleRun = async () => {
    if (!settings) return;
    const layoutPayload = layoutTree
      ? {
          layout_mode: "custom" as const,
          layout_rects: computeLayoutRects(layoutTree),
          layout_tree: layoutTree as unknown as LayoutTreeNode,
          sizing_mode: null,
          crop_mode: "crop" as const,
        }
      : {};
    const derivedProject = getSingleProject(settings.tile_folders);
    const projectName = project || derivedProject;
    if (outputMode === "project" && !projectName) {
      toast.error("Select a project output folder");
      return;
    }
    if (projectName) {
      try {
        await saveSettings({ ...settings, ...layoutPayload }, projectName);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to save settings";
        toast.error(message);
        return;
      }
    }
    const projectOutputFile =
      outputMode === "project" && projectName
        ? `src/${projectName}/outputs/tile/tile_${Date.now()}.mp4`
        : null;
    const res = await runAction({
      action: "tile",
      targets: [],
      target_type: "settings",
      output_mode: outputMode,
      params: {
        // Render from the active composition when one is in play; otherwise the
        // legacy per-project / global settings file.
        settings_path:
          project && activeComposition
            ? `src/${project}/.tiles/comps/${activeComposition}.json`
            : projectName
              ? `src/${projectName}/tile_videos_settings.json`
              : "configs/tile_videos_settings.json",
        render_mode: renderMode,
        no_overwrite: true,
        force_cfr: false,
        ...(projectOutputFile ? { output: projectOutputFile } : {}),
      },
    });
    if (res) {
      const outputRel = projectOutputFile || extractOutputRel(res.output);
      if (res.exit_code === 0) {
        setExportOpen(false);
        const projectLabel = projectName ?? "global";
        toast.success("Tile render complete", {
          description: `${projectLabel}${outputRel ? ` \u00b7 ${outputRel}` : ""}`,
        });
      } else {
        toast.error("Tile render failed", {
          description: `${res.output.slice(0, 180)}${res.log_file ? ` \u00b7 log: ${res.log_file}` : ""}`,
        });
      }
    }
  };

  // --- Layout tree handlers ---

  const handleSplitTile = (
    tileIndex: number,
    direction: "row" | "column",
    place: "before" | "after"
  ) => {
    if (!layoutTree || !settings) return;
    const nextIndex = maxLayoutTileIndex(layoutTree) + 1;
    const nextTree = splitLayoutLeaf(layoutTree, tileIndex, direction, place, nextIndex);
    if (!nextTree) return;
    setLayoutTree(nextTree);
    const rects = computeLayoutRects(nextTree);
    const resized = resizeTileSettings(settings, nextIndex + 1);
    saveSettings({
      ...settings,
      ...resized,
      layout_mode: "custom",
      layout_rects: rects,
      layout_tree: nextTree as unknown as LayoutTreeNode,
      sizing_mode: null,
    });
  };

  const handleResizeSplit = (nodeId: string, ratio: number) => {
    if (!layoutTree) return;
    const current = findLayoutRatio(layoutTree, nodeId);
    if (current !== null && Math.abs(current - ratio) < 0.002) {
      return;
    }
    const nextTree = updateLayoutRatio(layoutTree, nodeId, ratio);
    setLayoutTree(nextTree);
    if (!settings) return;
    const rects = computeLayoutRects(nextTree);
    saveSettings({
      ...settings,
      layout_mode: "custom",
      layout_rects: rects,
      layout_tree: nextTree as unknown as LayoutTreeNode,
      sizing_mode: null,
    });
  };

  const handleRemoveTile = (tileIndex: number) => {
    if (!layoutTree || !settings) return;
    if (effectiveTileCount <= 1) {
      toast.error("Can't remove the last tile");
      return;
    }
    const nextTree = removeLayoutLeaf(layoutTree, tileIndex);
    if (!nextTree) return;
    const { tree: normalizedTree, removedIndex } = normalizeLayoutIndices(nextTree, tileIndex);
    const rects = computeLayoutRects(normalizedTree);
    const resized = removeTileSettings(settings, removedIndex);
    setLayoutTree(normalizedTree);
    saveSettings({
      ...settings,
      ...resized,
      layout_mode: "custom",
      layout_rects: rects,
      layout_tree: normalizedTree as unknown as LayoutTreeNode,
      sizing_mode: null,
    });
  };

  const handleCropPosition = (tileIndex: number, position: string) => {
    if (!settings) return;
    const next = [...settings.tile_settings];
    if (!next[tileIndex]) return;
    next[tileIndex] = { ...next[tileIndex], crop_position: position };
    saveSettings({ ...settings, tile_settings: next });
  };

  const handleUpdateTileSetting = (
    tileIndex: number,
    partial: Partial<TileSettingEntry>
  ) => {
    if (!settings) return;
    const next = [...settings.tile_settings];
    while (next.length < effectiveTileCount) {
      next.push(defaultTileSetting());
    }
    next[tileIndex] = { ...next[tileIndex], ...partial };
    saveSettings({ ...settings, tile_settings: next });
  };

  const handleToggleTileAudio = (tileIndex: number, enabled: boolean) => {
    if (!settings) return;
    const next = new Set(settings.audio_tiles);
    if (enabled) {
      next.add(tileIndex);
    } else {
      next.delete(tileIndex);
    }
    saveSettings({
      ...settings,
      audio_tiles: Array.from(next).sort((a, b) => a - b),
      audio_tile: null,
    });
  };

  const handlePresetSelect = (code: string) => {
    const layout = layouts.find((l) => l.code === code);
    const newCount = layout?.tile_count || tileCount;
    const tree = buildPresetLayoutTree(code, newCount);
    const rects = computeLayoutRects(tree);
    const resized = settings ? resizeTileSettings(settings, newCount) : null;
    if (settings && resized) {
      saveSettings({
        ...settings,
        layout_code: code,
        ...resized,
        layout_mode: "custom",
        layout_rects: rects,
        layout_tree: tree as unknown as LayoutTreeNode,
        sizing_mode: null,
      });
    } else {
      updateTileCount(code);
      updateSettings({
        layout_mode: "custom",
        layout_rects: rects,
        layout_tree: tree as unknown as LayoutTreeNode,
      });
    }
    setLayoutTree(tree);
    setPresetOpen(false);
  };

  // --- Folder data ---

  // Full folder tree (incl. empty/structural folders) so the picker can drill
  // past folders that hold no videos. Video-derived folders supply thumbnails.
  const { projects } = useProjects();
  const projectNames = useMemo(
    () => (project ? [project] : projects.map((p) => p.name)),
    [project, projects]
  );
  const { map: projectDetails } = useProjectDetailsMap(projectNames);

  const folderThumbs = useMemo(() => buildFolderThumbs(videos), [videos]);
  const folderOptions = useMemo(() => {
    const set = new Set<string>(Object.keys(folderThumbs));
    for (const [name, detail] of Object.entries(projectDetails)) {
      set.add(name);
      for (const sub of detail.subfolders) {
        const full = `${name}/${sub}`;
        if (full.split("/").includes("outputs")) continue;
        set.add(full);
      }
    }
    return Array.from(set).sort();
  }, [folderThumbs, projectDetails]);
  const folderThumbsSingle = folderOptions.reduce((acc, folder) => {
    const thumbs = folderThumbs[folder];
    if (thumbs && thumbs.length > 0) {
      acc[folder] = thumbs[0];
    }
    return acc;
  }, {} as Record<string, string>);

  // --- Outputs ---

  // The export destination project; renders are viewed on the Outputs page.
  const derivedProject = getSingleProject(safeSettings.tile_folders);
  const outputProject = project || derivedProject || null;

  // --- Timeline ---

  const compositionMode = resolveCompositionMode(safeSettings);
  const isEditMode = compositionMode === "edit";

  const outputLengthPolicy =
    safeSettings.output_length_policy ??
    ((safeSettings.no_repeat ?? false) ? "shortest" : "longest");
  const sourceRepeatPolicy = safeSettings.source_repeat_policy ?? "allow";


  const timelineEntriesForTile = useCallback(
    (tileIndex: number, folder?: string): TimelineClipEntry[] => {
      if (safeSettings.timeline_clips && tileIndex < safeSettings.timeline_clips.length) {
        return safeSettings.timeline_clips[tileIndex] ?? [];
      }
      if (!folder) return [];
      return orderedFolderVideos(videos, folder, folderOrders[folder]).map((video) => ({
        id: makeTimelineClipId(),
        rel_path: video.rel_path,
      }));
    },
    [folderOrders, safeSettings.timeline_clips, videos]
  );

  const saveTileTimelineEntries = useCallback(
    (tileIndex: number, entries: TimelineClipEntry[]) => {
      if (!settings) return;
      const next = [...(safeSettings.timeline_clips ?? [])];
      while (next.length <= tileIndex) next.push([]);
      next[tileIndex] = entries;
      saveSettings({ ...settings, timeline_clips: next });
    },
    [safeSettings.timeline_clips, saveSettings, settings]
  );

  useEffect(() => {
    if (!settings || videos.length === 0) return;
    if ((safeSettings.timeline_clips?.length ?? 0) >= effectiveTileCount) return;
    const next = [...(safeSettings.timeline_clips ?? [])];
    for (let i = next.length; i < effectiveTileCount; i += 1) {
      const folder = safeSettings.tile_folders[i];
      next[i] = timelineEntriesForTile(i, folder);
    }
    saveSettings({ ...settings, timeline_clips: next });
  }, [
    effectiveTileCount,
    folderOrders,
    safeSettings.tile_folders,
    safeSettings.timeline_clips,
    saveSettings,
    settings,
    timelineEntriesForTile,
    videos,
  ]);

  // `list_videos` doesn't probe durations, so fetch real ones (ffprobe, cached)
  // for the clips in the assigned tile folders and fold them into the videos the
  // timeline reads — otherwise every clip falls back to a 5s guess.
  const clipRelPaths = useMemo(() => {
    const set = new Set<string>();
    for (const folder of safeSettings.tile_folders) {
      if (!folder) continue;
      for (const v of orderedFolderVideos(videos, folder, folderOrders[folder])) {
        set.add(v.rel_path);
      }
    }
    return [...set];
  }, [safeSettings.tile_folders, videos, folderOrders]);

  const clipDurations = useVideoDurations(clipRelPaths);
  const filmstrips = useFilmstrips(clipRelPaths);
  const waveforms = useWaveforms(clipRelPaths);

  const videosWithDurations = useMemo(
    () =>
      videos.map((v) =>
        clipDurations[v.rel_path]
          ? { ...v, duration: clipDurations[v.rel_path] }
          : v
      ),
    [videos, clipDurations]
  );

  // Single source of truth for Edit mode timing: every consumer below reads the
  // same resolved tracks/clips, so preview, strip widths, playhead activity,
  // blank regions, and output length cannot drift apart.
  const resolvedTimeline = useMemo(
    () =>
      resolveTileBuilderTimeline({
        tileCount: effectiveTileCount,
        folders: safeSettings.tile_folders,
        timelineClips: safeSettings.timeline_clips,
        tileSettings: safeSettings.tile_settings,
        videos: videosWithDurations,
        folderOrders,
        globalMaxDuration: safeSettings.max_duration,
        maxTotalDuration: safeSettings.max_total_duration,
        editMode: isEditMode,
      }),
    [
      effectiveTileCount,
      safeSettings.tile_folders,
      safeSettings.timeline_clips,
      safeSettings.tile_settings,
      safeSettings.max_duration,
      safeSettings.max_total_duration,
      videosWithDurations,
      folderOrders,
      isEditMode,
    ]
  );

  const tileClips = resolvedTimeline.tracks;
  const timelineTotalSeconds = resolvedTimeline.duration;

  const duplicateTimelineClip = useCallback(
    (tileIndex: number, clipId: string) => {
      const tile = tileClips.find((item) => item.tileIndex === tileIndex);
      if (!tile) return;
      const index = tile.entries.findIndex((clip) => clip.id === clipId);
      if (index === -1) return;
      const source = tile.entries[index];
      const next = [...tile.entries];
      next.splice(index + 1, 0, { ...source, id: makeTimelineClipId() });
      saveTileTimelineEntries(tileIndex, next);
    },
    [saveTileTimelineEntries, tileClips]
  );

  const duplicateTimelineClipAt = useCallback(
    (tileIndex: number, clipId: string, index: number) => {
      const tile = tileClips.find((item) => item.tileIndex === tileIndex);
      if (!tile) return;
      const source = tile.entries.find((clip) => clip.id === clipId);
      if (!source) return;
      const next = [...tile.entries];
      next.splice(Math.max(0, Math.min(index, next.length)), 0, {
        ...source,
        id: makeTimelineClipId(),
      });
      saveTileTimelineEntries(tileIndex, next);
    },
    [saveTileTimelineEntries, tileClips]
  );

  const removeTimelineClip = useCallback(
    (tileIndex: number, clipId: string) => {
      const tile = tileClips.find((item) => item.tileIndex === tileIndex);
      if (!tile) return;
      saveTileTimelineEntries(
        tileIndex,
        tile.entries.filter((clip) => clip.id !== clipId)
      );
      setSelectedClip((current) =>
        current?.tileIndex === tileIndex && current.clipId === clipId ? null : current
      );
    },
    [saveTileTimelineEntries, tileClips]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      if (!selectedClip) return;
      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        removeTimelineClip(selectedClip.tileIndex, selectedClip.clipId);
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateTimelineClip(selectedClip.tileIndex, selectedClip.clipId);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [duplicateTimelineClip, removeTimelineClip, selectedClip]);

  const addClipTile = addClipTileIndex !== null
    ? tileClips.find((tile) => tile.tileIndex === addClipTileIndex) ?? null
    : null;
  const addClipCandidates = useMemo(() => {
    if (!addClipTile?.folder) return [];
    const usedCounts = new Map<string, number>();
    for (const clip of addClipTile.entries) {
      usedCounts.set(clip.rel_path, (usedCounts.get(clip.rel_path) ?? 0) + 1);
    }
    return orderedFolderVideos(videos, addClipTile.folder, folderOrders[addClipTile.folder]).map(
      (video) => ({ video, usedCount: usedCounts.get(video.rel_path) ?? 0 })
    );
  }, [addClipTile, folderOrders, videos]);

  useEffect(() => {
    setTimelinePlayhead((current) => Math.min(current, timelineTotalSeconds));
  }, [timelineTotalSeconds]);

  // State is the playhead source of truth at rest / on scrub; the rAF loop
  // advances `playheadRef` directly during play (see movePlayhead).
  playheadRef.current = timelinePlayhead;

  // Per-tile active clip index at time t — used to detect clip boundaries so we
  // commit to React state (and re-render) only then, not every frame.
  const computeSignature = useCallback(
    (t: number) =>
      tileClips
        .map((tile) => {
          for (let i = 0; i < tile.clips.length; i += 1) {
            const clip = tile.clips[i];
            if (t >= clip.start && t < clip.end) return i;
          }
          return -1;
        })
        .join("|"),
    [tileClips]
  );

  // Move the playhead imperatively — update the ref and slide the strip line via
  // DOM. During playback, only commit React state at clip boundaries; during
  // manual scrubbing, commit every move so the preview video seeks immediately.
  const movePlayhead = useCallback(
    (t: number) => {
      const clamped = Math.min(timelineTotalSeconds, Math.max(0, t));
      playheadRef.current = clamped;
      if (playheadLineRef.current) {
        playheadLineRef.current.style.left = `${clamped * timelineZoom}px`;
      }
      // Commit to React state only at clip boundaries (to swap the preview
      // clip). The preview canvases read playheadRef directly each frame, so a
      // scrub doesn't need a re-render per move; the exact position is settled
      // to state on pointer-up.
      const sig = computeSignature(clamped);
      if (sig !== lastSigRef.current) {
        lastSigRef.current = sig;
        setTimelinePlayhead(clamped);
      }
    },
    [timelineTotalSeconds, timelineZoom, computeSignature]
  );

  useEffect(() => {
    if (!timelinePlaying) return;
    if (timelineTotalSeconds <= 0) {
      setTimelinePlaying(false);
      return;
    }
    let raf = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const delta = (now - previous) / 1000;
      previous = now;
      const next = playheadRef.current + delta;
      if (next >= timelineTotalSeconds) {
        setTimelinePlaying(false);
        setTimelinePlayhead(timelineTotalSeconds);
        return;
      }
      movePlayhead(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [timelinePlaying, timelineTotalSeconds, movePlayhead]);

  const activeSignature = computeSignature(timelinePlayhead);

  // Per-tile live video: the active clip's source + the clip's start time. Keyed
  // on the active-clip signature, so the object (and the <video> src) is stable
  // between clip boundaries; each tile video reads `playheadRef` to seek itself,
  // so this doesn't churn during playback.
  const tilePlayback = useMemo(() => {
    const indices = activeSignature.split("|").map(Number);
    const out: Record<number, TilePlayback | null> = {};
    tileClips.forEach((tile, i) => {
      if (!tile.folder || tile.clips.length === 0) return;
      const idx = indices[i];
      if (idx < 0 || idx >= tile.clips.length) {
        out[tile.tileIndex] = null; // playhead past this tile's clips → blank
        return;
      }
      const clip = findActiveTimelineClip(tile, timelinePlayhead) ?? tile.clips[idx];
      const start = clip.start;
      const rate = clip.speed;
      const sourceTime = clip.sourceStart + Math.max(0, timelinePlayhead - clip.start) * rate;
      out[tile.tileIndex] = {
        src: clip.src,
        clipStart: start,
        sourceStart: clip.sourceStart,
        sourceTime,
        frameSrc: frameUrl(clip.relPath, sourceTime),
        rate,
        poster: clip.poster,
        filmstrip: filmstrips[clip.relPath],
      };
    });
    return out;
  }, [tileClips, activeSignature, timelinePlayhead, filmstrips]);

  // --- Render ---

  if (loading || videosLoading || !settings) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
    <div className="mb-3 flex shrink-0 items-center gap-2">
      {project && (
        <CompositionSwitcher
          compositions={compositions}
          activeName={activeComposition}
          onSwitch={switchComposition}
          onNew={(name) => saveCompositionAs(name, defaultTileSettings())}
          onSaveAs={(name) => settings && saveCompositionAs(name, settings)}
          onRename={renameComposition}
          onDelete={removeComposition}
        />
      )}
      <div
        className="flex h-8 items-center rounded-md border p-0.5 text-xs"
        title="Edit: clips play once in order. Shuffle: legacy randomized generation."
      >
        {(["edit", "randomized"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => updateSettings({ mode: m })}
            className={`flex h-7 items-center rounded px-2.5 transition-colors ${
              compositionMode === m
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {m === "edit" ? "Edit" : "Shuffle"}
          </button>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2 className="h-4 w-4" />
          Settings
        </Button>
        <Button size="sm" className="h-8 gap-1.5" onClick={() => setExportOpen(true)}>
          <Play className="h-4 w-4 fill-current" />
          Export
        </Button>
      </div>
    </div>
    <div className="flex-1 min-h-0 overflow-hidden">
      {/* Main area: tabs */}
      <div className="flex h-full min-h-0 flex-col gap-3">
        {/* Composited preview */}
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
          <div
            className="h-full max-w-full"
            style={{
              aspectRatio: `${safeSettings.canvas_width ?? 1920} / ${safeSettings.canvas_height ?? 1080}`,
            }}
          >
            <TileGridPreview
              layoutCode={safeSettings.layout_code || "2x1"}
              tileCount={effectiveTileCount}
              folders={safeSettings.tile_folders}
              folderThumbs={folderThumbsSingle}
              tileVideos={tilePlayback}
              playing={timelinePlaying}
              playheadRef={playheadRef}
              cropMode="crop"
              tileSettings={safeSettings.tile_settings}
              onPickTile={setPickerTileIndex}
              layoutTree={layoutTree}
              onSplit={handleSplitTile}
              onResizeSplit={handleResizeSplit}
              onRemoveTile={handleRemoveTile}
              onSetCropPosition={handleCropPosition}
              onUpdateTileSetting={handleUpdateTileSetting}
              onToggleTileAudio={handleToggleTileAudio}
              audioTiles={safeSettings.audio_tiles}
              hiddenTiles={hiddenTiles}
              selectedTileIndex={pickerTileIndex}
              canvasWidth={safeSettings.canvas_width ?? 1920}
              canvasHeight={safeSettings.canvas_height ?? 1080}
              padding={safeSettings.padding ?? 0}
              bgColor={safeSettings.bg_color ?? "000000"}
            />
          </div>
        </div>

        {/* Transport — between the preview and the strips */}
        <div className="flex shrink-0 items-center gap-3 px-1">
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-xs hover:bg-accent disabled:opacity-50"
            disabled={timelineTotalSeconds <= 0}
            onClick={() => {
              if (timelinePlaying) {
                // Pause — settle state to the exact (ref) playhead.
                setTimelinePlaying(false);
                lastSigRef.current = computeSignature(playheadRef.current);
                setTimelinePlayhead(playheadRef.current);
              } else {
                if (playheadRef.current >= timelineTotalSeconds - 0.01) {
                  playheadRef.current = 0;
                  lastSigRef.current = computeSignature(0);
                  setTimelinePlayhead(0);
                }
                setTimelinePlaying(true);
              }
            }}
          >
            {timelinePlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {timelinePlaying ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            className="h-8 rounded-md border bg-background px-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => {
              setTimelinePlaying(false);
              setTimelinePlayhead(0);
            }}
          >
            Start
          </button>
          <div className="ml-2 flex w-44 items-center gap-2 text-[10px] text-muted-foreground">
            <span>Zoom</span>
            <Slider
              value={[timelineZoom]}
              min={8}
              max={42}
              step={1}
              onValueChange={(value) => setTimelineZoom(value[0] ?? 16)}
            />
          </div>
        </div>

        {/* Strips */}
        <div className="min-h-0 flex-1 overflow-y-auto pr-1 pb-2">

            {(() => {
              const px = timelineZoom;
              const contentWidth = Math.max(480, timelineTotalSeconds * px);
              const playheadX = Math.min(contentWidth, Math.max(0, timelinePlayhead * px));
              const scrub = (event: ReactPointerEvent<HTMLDivElement>) => {
                const rect = event.currentTarget.getBoundingClientRect();
                const x = Math.min(contentWidth, Math.max(0, event.clientX - rect.left));
                movePlayhead(x / px);
              };
              return (
                <div className="overflow-hidden rounded-lg border bg-card/40">
                  <div className="flex">
                    {/* Fixed label gutter */}
                    <div className="w-[150px] shrink-0 border-r bg-muted/10">
                      <div className="h-7 border-b" />
                      {tileClips.map((tile) => {
                        const sharedCount = tile.folder ? folderUsage.get(tile.folder) ?? 0 : 0;
                        const blanks =
                          isEditMode && tile.trackSeconds < timelineTotalSeconds - 0.05;
                        return (
                          <Fragment key={tile.tileIndex}>
                          <div
                            className={`flex h-20 flex-col justify-center gap-0.5 border-b px-2 ${
                              hiddenTiles.has(tile.tileIndex) ? "opacity-40" : ""
                            }`}
                          >
                            <div className="text-xs font-medium text-foreground">
                              Tile {tile.tileIndex + 1}
                            </div>
                            <div
                              className="truncate text-[10px] text-muted-foreground"
                              title={tile.folderLabel}
                            >
                              {tile.folderLabel}
                              {sharedCount > 1 ? ` · shared ×${sharedCount}` : ""}
                            </div>
                            <div className="flex items-center justify-between gap-1">
                              <div className="font-mono text-[10px] text-muted-foreground">
                                {formatDurationSeconds(tile.trackSeconds)}
                              </div>
                              {/* Per-lane button footer — gains an audio sub-strip toggle later */}
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  className="rounded border p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                                  onClick={() => toggleTileHidden(tile.tileIndex)}
                                  title={
                                    hiddenTiles.has(tile.tileIndex)
                                      ? "Show tile in preview"
                                      : "Hide tile in preview"
                                  }
                                >
                                  {hiddenTiles.has(tile.tileIndex) ? (
                                    <EyeOff className="h-3 w-3" />
                                  ) : (
                                    <Eye className="h-3 w-3" />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  className={`rounded border p-0.5 hover:bg-accent hover:text-foreground ${
                                    audioOpenTiles.has(tile.tileIndex)
                                      ? "bg-accent text-foreground"
                                      : "text-muted-foreground"
                                  }`}
                                  onClick={() => toggleTileAudioStrip(tile.tileIndex)}
                                  title={
                                    audioOpenTiles.has(tile.tileIndex)
                                      ? "Hide audio waveform"
                                      : "Show audio waveform"
                                  }
                                >
                                  <AudioLines className="h-3 w-3" />
                                </button>
                                {tile.folder && (
                                  <button
                                    type="button"
                                    className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
                                    onClick={() => setAddClipTileIndex(tile.tileIndex)}
                                    title="Add clip from this tile's source folder"
                                  >
                                    + clip
                                  </button>
                                )}
                              </div>
                            </div>
                            {blanks && (
                              <div className="text-[10px] text-amber-500">
                                blank after {formatDurationSeconds(tile.trackSeconds)}
                              </div>
                            )}
                          </div>
                          {audioOpenTiles.has(tile.tileIndex) && (
                            <div className="flex h-12 items-center gap-1 border-b bg-muted/10 px-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                              <AudioLines className="h-3 w-3" />
                              audio
                            </div>
                          )}
                          </Fragment>
                        );
                      })}
                    </div>

                    {/* Shared horizontal-scroll lane stack */}
                    <div className="min-w-0 flex-1 overflow-x-auto">
                      <div
                        className="relative cursor-crosshair"
                        style={{ width: contentWidth }}
                        onPointerDown={(event) => {
                          timelineScrubbing.current = true;
                          scrub(event);
                        }}
                        onPointerMove={(event) => {
                          if (timelineScrubbing.current && event.buttons === 1) scrub(event);
                        }}
                        onPointerUp={() => {
                          if (timelineScrubbing.current) {
                            timelineScrubbing.current = false;
                            lastSigRef.current = computeSignature(playheadRef.current);
                            setTimelinePlayhead(playheadRef.current);
                          }
                        }}
                        onPointerLeave={() => {
                          if (timelineScrubbing.current) {
                            timelineScrubbing.current = false;
                            lastSigRef.current = computeSignature(playheadRef.current);
                            setTimelinePlayhead(playheadRef.current);
                          }
                        }}
                      >
                        {/* Ruler */}
                        <div className="relative h-7 border-b text-[10px] text-muted-foreground">
                          {makeTimeTicks(timelineTotalSeconds).map((tick) => (
                            <div
                              key={tick}
                              className="absolute top-0 h-full border-l border-border/70 pl-1 font-mono"
                              style={{ left: tick * px }}
                            >
                              {formatDurationSeconds(tick)}
                            </div>
                          ))}
                        </div>

                        {/* Tile lanes */}
                        {tileClips.map((tile) => (
                          <Fragment key={tile.tileIndex}>
                          <div className="relative h-20 border-b bg-muted/5">
                            {tile.folder && tile.clips.length > 0 ? (
                              <TileTimelineTrack
                                clips={tile.clips}
                                pxPerSecond={px}
                                playheadSeconds={timelinePlayhead}
                                selectedClipId={selectedClip?.tileIndex === tile.tileIndex ? selectedClip.clipId : null}
                                transitionType={tile.setting.trans_type || "none"}
                                transitionSeconds={
                                  tile.setting.trans_type === "fade"
                                    ? tile.setting.trans_duration || 0
                                    : 0
                                }
                                onReorder={(clipIds) => {
                                  const byId = new Map(tile.entries.map((clip) => [clip.id, clip]));
                                  saveTileTimelineEntries(
                                    tile.tileIndex,
                                    clipIds.map((id) => byId.get(id)).filter(Boolean) as TimelineClipEntry[]
                                  );
                                }}
                                onSelectClip={(clipId) => setSelectedClip({ tileIndex: tile.tileIndex, clipId })}
                                onDuplicateClip={(clipId) => duplicateTimelineClip(tile.tileIndex, clipId)}
                                onDuplicateClipAt={(clipId, index) =>
                                  duplicateTimelineClipAt(tile.tileIndex, clipId, index)
                                }
                                onRemoveClip={(clipId) => removeTimelineClip(tile.tileIndex, clipId)}
                                onTrimClip={(clipId, trim) => {
                                  saveTileTimelineEntries(
                                    tile.tileIndex,
                                    tile.entries.map((clip) =>
                                      clip.id === clipId ? { ...clip, ...trim } : clip
                                    )
                                  );
                                }}
                                onTransitionChange={(partial) =>
                                  handleUpdateTileSetting(tile.tileIndex, partial)
                                }
                              />
                            ) : (
                              <div className="flex h-full items-center px-2 text-[11px] text-muted-foreground">
                                {tile.folder ? "No videos in this folder." : "No folder assigned."}
                              </div>
                            )}
                          </div>
                          {audioOpenTiles.has(tile.tileIndex) && (
                            <div className="relative h-12 border-b bg-muted/[0.03]">
                              {tile.folder && tile.clips.length > 0 ? (
                                <TileAudioTrack
                                  clips={tile.clips}
                                  pxPerSecond={px}
                                  waveforms={waveforms}
                                />
                              ) : (
                                <div className="flex h-full items-center px-2 text-[10px] text-muted-foreground">
                                  No audio
                                </div>
                              )}
                            </div>
                          )}
                          </Fragment>
                        ))}

                        {/* Single playhead spanning the ruler + every lane */}
                        <div
                          ref={playheadLineRef}
                          className="pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-primary"
                          style={{ left: playheadX }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
        </div>
      </div>

    </div>

    {/* Composition settings drawer */}
    <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
      <SheetContent
        side="right"
        className="flex w-[380px] flex-col gap-0 p-0 sm:max-w-[380px]"
      >
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle>Composition settings</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-hidden p-4">
          <TileBuilderSidebar
            safeSettings={safeSettings}
            layouts={layouts}
            mode={compositionMode}
            outputLengthPolicy={outputLengthPolicy}
            sourceRepeatPolicy={sourceRepeatPolicy}
            folderThumbsSingle={folderThumbsSingle}
            presetOpen={presetOpen}
            onPresetOpenChange={setPresetOpen}
            onUpdateSettings={updateSettings}
            onPresetSelect={handlePresetSelect}
          />
        </div>
      </SheetContent>
    </Sheet>

    {/* Export */}
    <ExportDialog
      open={exportOpen}
      onOpenChange={setExportOpen}
      settings={safeSettings}
      saveSettings={saveSettings}
      renderMode={renderMode}
      onRenderModeChange={setRenderMode}
      outputMode={outputMode}
      onOutputModeChange={setOutputMode}
      outputProject={outputProject}
      audioEnabled={safeSettings.audio_enabled ?? false}
      onAudioEnabledChange={(v) => updateSettings({ audio_enabled: v })}
      running={running}
      onRun={handleRun}
    />

    <Dialog open={addClipTileIndex !== null} onOpenChange={(open) => !open && setAddClipTileIndex(null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Add clip{addClipTile ? ` to Tile ${addClipTile.tileIndex + 1}` : ""}
          </DialogTitle>
        </DialogHeader>
        {addClipTile?.folder ? (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              Source folder: {addClipTile.folder}. Adding a clip creates a new timeline instance; it does not copy or modify the source file.
            </div>
            <div className="max-h-[420px] overflow-y-auto rounded-md border">
              {addClipCandidates.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  No source videos found in this folder.
                </div>
              ) : (
                <div className="divide-y">
                  {addClipCandidates.map(({ video, usedCount }) => (
                    <button
                      key={video.rel_path}
                      type="button"
                      className="flex w-full items-center gap-3 p-2 text-left hover:bg-accent/60"
                      onClick={() => {
                        if (!addClipTile) return;
                        saveTileTimelineEntries(addClipTile.tileIndex, [
                          ...addClipTile.entries,
                          { id: makeTimelineClipId(), rel_path: video.rel_path },
                        ]);
                      }}
                    >
                      <div className="h-12 w-20 shrink-0 overflow-hidden rounded bg-muted">
                        <img src={thumbUrl(video.rel_path)} alt={video.name} className="h-full w-full object-cover" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{video.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatDurationSeconds(video.duration ?? 0)}{usedCount > 0 ? ` · used ${usedCount}×` : " · unused"}
                        </div>
                      </div>
                      <div className="rounded border px-2 py-1 text-xs text-muted-foreground">
                        Add
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">Assign a source folder to this tile first.</div>
        )}
      </DialogContent>
    </Dialog>

    {/* Folder picker dialog (opens when clicking a tile in preview) */}
    <FolderAssignment
      tileCount={effectiveTileCount}
      folders={safeSettings.tile_folders}
      folderOptions={folderOptions}
      folderThumbs={folderThumbs}
      onChange={(folders) => {
        const nextTimeline = [...(safeSettings.timeline_clips ?? [])];
        folders.forEach((folder, index) => {
          if (folder !== safeSettings.tile_folders[index]) {
            nextTimeline[index] = folder
              ? orderedFolderVideos(videos, folder, folderOrders[folder]).map((video) => ({
                  id: makeTimelineClipId(),
                  rel_path: video.rel_path,
                }))
              : [];
          }
        });
        updateSettings({ tile_folders: folders, timeline_clips: nextTimeline });
      }}
      openTileIndex={pickerTileIndex}
      onOpenTileChange={setPickerTileIndex}
      inline={false}
    />
    </div>
  );
}

function makeTimelineClipId() {
  return `clip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeTimeTicks(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return [0];
  const targetTickCount = 6;
  const roughStep = totalSeconds / targetTickCount;
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const step = steps.find((candidate) => candidate >= roughStep) ?? 600;
  const ticks: number[] = [];
  for (let t = 0; t <= totalSeconds + 0.01; t += step) {
    ticks.push(t);
  }
  if (ticks[ticks.length - 1] !== totalSeconds) ticks.push(totalSeconds);
  return ticks;
}
