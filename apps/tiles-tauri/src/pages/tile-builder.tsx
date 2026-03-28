import { useState, useEffect, useMemo } from "react";
import { useSettings } from "@/hooks/use-settings";
import { useVideos } from "@/hooks/use-videos";
import { useFolderOrders } from "@/hooks/use-folder-orders";
import { useActionRunner } from "@/hooks/use-action-runner";
import { useOutputs } from "@/hooks/use-outputs";
import { TileGridPreview, type LayoutNode } from "@/components/tile-builder/tile-grid-preview";
import { FolderAssignment } from "@/components/tile-builder/folder-assignment";
import { TileBuilderSidebar } from "@/components/tile-builder/tile-builder-sidebar";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type {
  TileSettings,
  TileSettingEntry,
  LayoutTreeNode,
} from "@/types";
import {
  getSingleProject,
  extractOutputRel,
  isRepoOutputPath,
  mediaUrlForRel,
  formatEpoch,
  buildFolderThumbs,
  buildTileTimeline,
  defaultTileSetting,
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

export function TileBuilderPage({ project }: { project?: string }) {
  const { settings, layouts, loading, saveSettings } = useSettings(project);
  const { videos, loading: videosLoading } = useVideos(project);
  const runnerScope = project ?? "__all-projects__";
  const { running, runAction } = useActionRunner(runnerScope);
  const [renderMode, setRenderMode] = useState("preview");
  const [outputMode, setOutputMode] = useState("project");
  const [noOverwrite, setNoOverwrite] = useState(false);
  const [lastOutputRel, setLastOutputRel] = useState<string | null>(null);
  const [lastOutputLog, setLastOutputLog] = useState<string | null>(null);
  const [pendingOutputRel, setPendingOutputRel] = useState<string | null>(null);
  const [pickerTileIndex, setPickerTileIndex] = useState<number | null>(null);
  const [layoutTree, setLayoutTree] = useState<LayoutNode | null>(null);
  const [presetOpen, setPresetOpen] = useState(false);

  const safeSettings: TileSettings = settings ?? {
    layout_code: null,
    crop_mode: null,
    layout_mode: null,
    layout_rects: null,
    layout_tree: null,
    render_mode: null,
    output_mode: null,
    no_overwrite: null,
    tile_folders: [],
    audio_enabled: false,
    audio_tiles: [],
    audio_tile: null,
    max_total_duration: null,
    max_duration: null,
    distribution_mode: null,
    tile_settings: [],
    sizing_mode: null,
    canvas_width: null,
    canvas_height: null,
    padding: null,
    bg_color: null,
    no_repeat: null,
    output_length_policy: null,
    source_repeat_policy: null,
  };

  const { orders: folderOrders } = useFolderOrders(safeSettings.tile_folders);

  // --- Sync settings to local state ---

  useEffect(() => {
    if (!settings) return;
    if (settings.crop_mode !== "crop") {
      saveSettings({ ...settings, crop_mode: "crop" });
    }
  }, [settings?.crop_mode]);

  useEffect(() => {
    if (!settings) return;
    if (settings.render_mode) {
      setRenderMode(settings.render_mode);
    }
    if (settings.output_mode) {
      setOutputMode(settings.output_mode === "custom" ? "project" : settings.output_mode);
    }
    if (typeof settings.no_overwrite === "boolean") {
      setNoOverwrite(settings.no_overwrite);
    }
  }, [
    settings?.render_mode,
    settings?.output_mode,
    settings?.no_overwrite,
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
    const pendingOutput = projectOutputFile;
    setPendingOutputRel(pendingOutput);
    const res = await runAction({
      action: "tile",
      targets: [],
      target_type: "settings",
      output_mode: outputMode,
      params: {
        settings_path: projectName
          ? `src/${projectName}/tile_videos_settings.json`
          : "configs/tile_videos_settings.json",
        render_mode: renderMode,
        no_overwrite: noOverwrite,
        force_cfr: false,
        ...(projectOutputFile ? { output: projectOutputFile } : {}),
      },
    });
    setPendingOutputRel(null);
    if (res) {
      setLastOutputLog(res.output || null);
      const outputRel = projectOutputFile || extractOutputRel(res.output);
      setLastOutputRel(outputRel || null);
      refreshOutputs();
      if (res.exit_code === 0) {
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

  const folderThumbs = buildFolderThumbs(videos);
  const folderOptions = Object.keys(folderThumbs).sort();
  const folderThumbsSingle = folderOptions.reduce((acc, folder) => {
    const thumbs = folderThumbs[folder];
    if (thumbs && thumbs.length > 0) {
      acc[folder] = thumbs[0];
    }
    return acc;
  }, {} as Record<string, string>);

  // --- Outputs ---

  const derivedProject = getSingleProject(safeSettings.tile_folders);
  const outputProject = project || derivedProject || null;
  const {
    outputs: tileOutputs,
    loading: outputsLoading,
    refresh: refreshOutputs,
  } = useOutputs(outputProject ?? undefined, "tile");

  useEffect(() => {
    setLastOutputRel(null);
    setLastOutputLog(null);
    setPendingOutputRel(null);
  }, [outputProject]);

  const latestOutput = useMemo(() => {
    if (tileOutputs.length === 0) return null;
    if (outputProject) return tileOutputs[0];
    return tileOutputs.find((o) => o.project === "(global)") || tileOutputs[0];
  }, [tileOutputs, outputProject]);

  const latestOutputRel = latestOutput?.run_rel || null;
  const latestOutputUrl = latestOutput?.sample_url
    ? latestOutput.sample_url
    : latestOutputRel
      ? mediaUrlForRel(latestOutputRel)
      : null;
  const resolvedOutputRel = lastOutputRel || latestOutputRel;
  const resolvedOutputUrl =
    lastOutputRel && isRepoOutputPath(lastOutputRel)
      ? mediaUrlForRel(lastOutputRel)
      : latestOutputUrl;
  const canPreviewPending = pendingOutputRel
    ? isRepoOutputPath(pendingOutputRel)
    : false;
  const lastRenderLabel = latestOutput
    ? formatEpoch(latestOutput.modified_epoch)
    : null;

  // --- Timeline ---

  const outputLengthPolicy =
    safeSettings.output_length_policy ??
    ((safeSettings.no_repeat ?? false) ? "shortest" : "longest");
  const sourceRepeatPolicy = safeSettings.source_repeat_policy ?? "allow";

  const timeline = useMemo(
    () =>
      buildTileTimeline({
        tileCount: effectiveTileCount,
        folders: safeSettings.tile_folders,
        tileSettings: safeSettings.tile_settings,
        videos,
        renderMode,
        outputLengthPolicy,
        sourceRepeatPolicy,
        distributionMode: safeSettings.distribution_mode,
        globalMaxDuration: safeSettings.max_duration,
        maxTotalDuration: safeSettings.max_total_duration,
        folderOrders,
      }),
    [
      effectiveTileCount,
      safeSettings.tile_folders,
      safeSettings.tile_settings,
      outputLengthPolicy,
      sourceRepeatPolicy,
      safeSettings.distribution_mode,
      safeSettings.max_duration,
      safeSettings.max_total_duration,
      videos,
      folderOrders,
    ]
  );

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
    <div className="grid flex-1 min-h-0 grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
      {/* Main area: tabs */}
      <Tabs defaultValue="preview" className="flex flex-col min-h-0 overflow-hidden">
        <TabsList>
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="output">Output</TabsTrigger>
        </TabsList>

        <TabsContent value="preview" className="flex-1 mt-4">
          <TileGridPreview
            layoutCode={safeSettings.layout_code || "2x1"}
            tileCount={effectiveTileCount}
            folders={safeSettings.tile_folders}
            folderThumbs={folderThumbsSingle}
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
            selectedTileIndex={pickerTileIndex}
            canvasWidth={safeSettings.canvas_width ?? 1920}
            canvasHeight={safeSettings.canvas_height ?? 1080}
            padding={safeSettings.padding ?? 0}
            bgColor={safeSettings.bg_color ?? "000000"}
          />
        </TabsContent>

        <TabsContent value="timeline" className="flex-1 mt-4">
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              {timeline.summary}
            </div>
            {timeline.entries.map((entry) => (
              <div key={entry.tileIndex} className="space-y-1">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <div className="truncate">
                    <span className="font-medium text-foreground">
                      Tile {entry.tileIndex + 1}
                    </span>{" "}
                    <span className="text-muted-foreground">
                      {entry.folderLabel}
                    </span>
                  </div>
                  <span className="tabular-nums text-muted-foreground">
                    {entry.valueLabel}
                  </span>
                </div>
                {entry.shortByLabel && (
                  <div className="text-[11px] text-amber-500 tabular-nums">
                    short by {entry.shortByLabel}
                  </div>
                )}
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full transition-[width] duration-200 ${
                      entry.dropsEarly ? "bg-amber-500" : "bg-primary"
                    }`}
                    style={{ width: `${entry.percent}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="output" className="flex-1 mt-4">
          <div className="border rounded-lg p-3 bg-muted/20 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Render Output</div>
                <div className="text-xs text-muted-foreground">
                  {outputProject ? `Project: ${outputProject}` : "Global outputs"}
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                {running
                  ? "Rendering..."
                  : lastRenderLabel
                    ? `Last render: ${lastRenderLabel}`
                    : outputsLoading
                      ? "Checking outputs..."
                      : "No renders yet"}
              </div>
            </div>
            {running && pendingOutputRel && (
              <div className="text-xs text-muted-foreground truncate">
                Output: {pendingOutputRel}
              </div>
            )}
            {!running && resolvedOutputUrl && (
              <video
                src={resolvedOutputUrl}
                className="w-full rounded aspect-video bg-muted"
                controls
                preload="metadata"
              />
            )}
            {!running && !resolvedOutputUrl && (
              <div className="text-xs text-muted-foreground">
                {resolvedOutputRel && !isRepoOutputPath(resolvedOutputRel)
                  ? "Last render saved outside this workspace."
                  : "No preview available."}
              </div>
            )}
            {pendingOutputRel && running && canPreviewPending && (
              <div className="text-xs text-muted-foreground">
                Preview will appear once rendering completes.
              </div>
            )}
            {resolvedOutputRel && (
              <div className="text-xs text-muted-foreground truncate">
                {resolvedOutputRel}
              </div>
            )}
            {lastOutputLog && (
              <div>
                <div className="text-xs font-semibold text-muted-foreground">Run log</div>
                <pre className="mt-1 text-[11px] leading-4 bg-muted/40 border rounded p-2 max-h-40 overflow-auto">
                  {lastOutputLog.trim()}
                </pre>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Right sidebar */}
      <div className="min-h-0 h-full overflow-hidden">
        <TileBuilderSidebar
          settings={settings}
          safeSettings={safeSettings}
          layouts={layouts}
          renderMode={renderMode}
          outputMode={outputMode}
          noOverwrite={noOverwrite}
          outputLengthPolicy={outputLengthPolicy}
          sourceRepeatPolicy={sourceRepeatPolicy}
          running={running}
          folderThumbsSingle={folderThumbsSingle}
          presetOpen={presetOpen}
          onPresetOpenChange={setPresetOpen}
          onRenderModeChange={setRenderMode}
          onOutputModeChange={setOutputMode}
          onNoOverwriteChange={setNoOverwrite}
          onUpdateSettings={updateSettings}
          onPresetSelect={handlePresetSelect}
          onRun={handleRun}
          saveSettings={saveSettings}
        />
      </div>
    </div>

    {/* Folder picker dialog (opens when clicking a tile in preview) */}
    <FolderAssignment
      tileCount={effectiveTileCount}
      folders={safeSettings.tile_folders}
      folderOptions={folderOptions}
      folderThumbs={folderThumbs}
      onChange={(folders) => updateSettings({ tile_folders: folders })}
      openTileIndex={pickerTileIndex}
      onOpenTileChange={setPickerTileIndex}
      inline={false}
    />
    </div>
  );
}
