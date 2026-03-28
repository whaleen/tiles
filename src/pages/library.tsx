import { useState, useMemo, useEffect, useRef, useCallback, memo } from "react";
import type { DragEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { thumbUrl } from "@/api/client";
import { invoke } from "@tauri-apps/api/core";
import { useProjectDetail } from "@/hooks/use-project-detail";
import { useVideos } from "@/hooks/use-videos";
import { useFolderOrder } from "@/hooks/use-folder-order";
import { queryKeys } from "@/lib/query-keys";
import { VideoGrid } from "@/components/library/video-grid";
import { FolderTimeline } from "@/components/library/folder-timeline";
import { TimelinePreview } from "@/components/library/timeline-preview";
import { VideoEditor } from "@/components/editor/video-editor";
import { LibraryActionPanel } from "@/components/library/library-action-panel";
import { FolderContextMenu } from "@/components/library/folder-context-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FolderPathResponse, MoveVideosResponse, VideoEntry } from "@/types";
import {
  Search,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  FolderMinus,
  Film as FilmStrip,
  CheckSquare,
  XSquare,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

type FolderCard = {
  key: string;
  label: string;
  path: string;
  fullPath: string;
  thumbs: string[];
};

const isImage = (path: string) =>
  /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(path);

export function LibraryPage({
  project,
}: {
  project?: string;
}) {
  const queryClient = useQueryClient();
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [foldersOpen, setFoldersOpen] = useState(true);
  const {
    detail,
    loading: detailLoading,
    error: detailError,
    refresh: refreshDetail,
  } = useProjectDetail(project);
  const { videos, loading: videosLoading, refresh, removeVideo } = useVideos(project, search);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [editorVideo, setEditorVideo] = useState<VideoEntry | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);
  const [movingVideos, setMovingVideos] = useState(false);
  const [dragRelPath, setDragRelPath] = useState<string | null>(null);
  const [dragOverFolderPath, setDragOverFolderPath] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderParent, setNewFolderParent] = useState("__root__");
  const [showTimeline, setShowTimeline] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [rootOnly, setRootOnly] = useState(true);

  const { order, saveOrder } = useFolderOrder(project, selectedFolder);
  const lastSelectedRef = useRef<string | null>(null);

  const toggleSelect = (relPath: string, shiftKey?: boolean) => {
    if (shiftKey && lastSelectedRef.current && lastSelectedRef.current !== relPath) {
      // Shift+click: select range between last selected and current
      const lastIdx = orderedVideos.findIndex((v) => v.rel_path === lastSelectedRef.current);
      const curIdx = orderedVideos.findIndex((v) => v.rel_path === relPath);
      if (lastIdx !== -1 && curIdx !== -1) {
        const start = Math.min(lastIdx, curIdx);
        const end = Math.max(lastIdx, curIdx);
        setSelectedPaths((prev) => {
          const next = new Set(prev);
          for (let i = start; i <= end; i++) {
            next.add(orderedVideos[i].rel_path);
          }
          return next;
        });
        lastSelectedRef.current = relPath;
        return;
      }
    }
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(relPath)) next.delete(relPath);
      else next.add(relPath);
      return next;
    });
    lastSelectedRef.current = relPath;
  };

  useEffect(() => {
    setSelectedFolder(undefined);
    setSelectedPaths(new Set());
    setEditorVideo(null);
    setPreviewMode(false);
    setDragRelPath(null);
    setDragOverFolderPath(null);
  }, [project]);

  useEffect(() => {
    setSelectedPaths(new Set());
    setEditorVideo(null);
    setPreviewMode(false);
    setDragRelPath(null);
    setDragOverFolderPath(null);
  }, [selectedFolder]);

  // Listen for editor navigation events (prev/next inside editor)
  const handleEditorNavigate = useCallback((e: Event) => {
    const video = (e as CustomEvent<VideoEntry>).detail;
    if (video) setEditorVideo(video);
  }, []);
  useEffect(() => {
    window.addEventListener("editor-navigate", handleEditorNavigate);
    return () =>
      window.removeEventListener("editor-navigate", handleEditorNavigate);
  }, [handleEditorNavigate]);

  const filteredVideos = useMemo(() => {
    let result = videos;
    if (project && selectedFolder) {
      const prefix = `${project}/${selectedFolder}`;
      result = result.filter(
        (v) => v.folder === prefix || v.folder.startsWith(`${prefix}/`)
      );
    } else if (project && rootOnly && !selectedFolder) {
      result = result.filter((v) => v.folder === project);
    }
    return result;
  }, [videos, project, selectedFolder, rootOnly]);

  const orderedVideos = useMemo(() => {
    if (order.length === 0) return filteredVideos;
    const orderIndex = new Map(order.map((name, i) => [name, i]));
    return [...filteredVideos].sort((a, b) => {
      const ai = orderIndex.get(a.name);
      const bi = orderIndex.get(b.name);
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (ai !== undefined) return -1;
      if (bi !== undefined) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [filteredVideos, order]);

  const folderCards = useMemo(
    () => buildFolderCards(selectedFolder || "", detail?.subfolders, videos, project),
    [detail?.subfolders, project, selectedFolder, videos]
  );

  const selectedVideos = useMemo(
    () => filteredVideos.filter((v) => selectedPaths.has(v.rel_path)),
    [filteredVideos, selectedPaths]
  );

  const parentPath = selectedFolder
    ? selectedFolder.split("/").slice(0, -1).join("/")
    : undefined;

  const parentThumbs = useMemo(() => {
    if (!selectedFolder) return [] as string[];
    return buildFolderPreviewThumbs(parentPath || "", videos, project);
  }, [parentPath, project, selectedFolder, videos]);

  const allFolderPaths = useMemo(() => {
    const paths = [...(detail?.subfolders ?? [])];
    paths.sort((a, b) => a.localeCompare(b));
    return paths;
  }, [detail?.subfolders]);

  const dropTargets = useMemo(() => {
    if (!project) return [] as { path: string; label: string }[];

    if (!selectedFolder) {
      // At root level: show all top-level folders
      const topLevel = new Set<string>();
      for (const folder of allFolderPaths) {
        const segment = folder.split("/")[0];
        if (segment) topLevel.add(segment);
      }
      return Array.from(topLevel)
        .sort((a, b) => a.localeCompare(b))
        .map((seg) => ({ path: seg, label: seg }));
    }

    // In a subfolder: show root, parent, and sibling folders
    const parent = selectedFolder.split("/").slice(0, -1).join("/");
    const prefix = parent ? `${parent}/` : "";
    const direct = new Set<string>();

    for (const folder of allFolderPaths) {
      if (parent && !folder.startsWith(prefix)) continue;
      const remainder = parent ? folder.slice(prefix.length) : folder;
      const segment = remainder.split("/")[0];
      if (!segment) continue;
      const candidate = parent ? `${parent}/${segment}` : segment;
      if (candidate !== selectedFolder) direct.add(candidate);
    }

    const out = new Map<string, string>();
    out.set("", `${project} (root)`);
    out.set(parent, parent ? `${parent} (parent)` : `${project} (root)`);

    for (const sib of Array.from(direct).sort((a, b) => a.localeCompare(b))) {
      out.set(sib, sib);
    }

    return Array.from(out.entries()).map(([path, label]) => ({ path, label }));
  }, [allFolderPaths, project, selectedFolder]);

  // Scope counts for the sticky toolbar
  const baseVideosForScope = selectedVideos.length > 0 ? selectedVideos : filteredVideos;
  const videoCount = useMemo(
    () => baseVideosForScope.filter((v) => !isImage(v.rel_path)).length,
    [baseVideosForScope]
  );
  const imageCount = useMemo(
    () => baseVideosForScope.filter((v) => isImage(v.rel_path)).length,
    [baseVideosForScope]
  );

  async function refreshLibraryData() {
    const scrollEl = gridScrollRef.current;
    const prevTop = scrollEl?.scrollTop ?? null;
    await Promise.all([refresh(), refreshDetail()]);
    if (scrollEl && prevTop !== null) {
      requestAnimationFrame(() => {
        scrollEl.scrollTop = prevTop;
      });
    }
  }

  async function createFolderFromDialog() {
    if (!project || folderBusy) return;
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    setFolderBusy(true);
    try {
      await invoke("create_folder", {
        project,
        parent: newFolderParent === "__root__" ? undefined : newFolderParent,
        name: trimmed,
      });
      toast.success("Folder created");
      setNewFolderOpen(false);
      setNewFolderName("");
      await refreshLibraryData();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create folder";
      toast.error(message);
    } finally {
      setFolderBusy(false);
    }
  }

  async function renameFolder(folderPath: string) {
    if (!project || folderBusy) return;
    const currentName = folderPath.split("/").pop() || folderPath;
    const name = window.prompt("Rename folder", currentName);
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === currentName) return;
    setFolderBusy(true);
    try {
      const res = await invoke<FolderPathResponse>("rename_folder", {
        project,
        path: folderPath,
        new_name: trimmed,
      });
      if (selectedFolder === folderPath) {
        setSelectedFolder(res.path);
      }
      toast.success("Folder renamed");
      await refreshLibraryData();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to rename folder";
      toast.error(message);
    } finally {
      setFolderBusy(false);
    }
  }

  async function moveFolder(folderPath: string) {
    if (!project || folderBusy) return;
    const currentParent = folderPath.split("/").slice(0, -1).join("/");
    const targetParentInput = window.prompt(
      "Move folder to parent path (blank for project root)",
      currentParent
    );
    if (targetParentInput === null) return;
    const targetParent = targetParentInput.trim();
    setFolderBusy(true);
    try {
      const res = await invoke<FolderPathResponse>("move_folder", {
        project,
        path: folderPath,
        target_parent: targetParent,
      });
      if (selectedFolder === folderPath) {
        setSelectedFolder(res.path);
      }
      toast.success("Folder moved");
      await refreshLibraryData();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to move folder";
      toast.error(message);
    } finally {
      setFolderBusy(false);
    }
  }

  async function deleteFolder(folderPath: string) {
    if (!project || folderBusy) return;
    if (
      !window.confirm(
        `Delete folder "${folderPath}" and everything inside it?`
      )
    ) {
      return;
    }
    setFolderBusy(true);
    try {
      await invoke("delete_folder", {
        project,
        path: folderPath,
      });
      if (selectedFolder === folderPath) {
        const parent = folderPath.split("/").slice(0, -1).join("/");
        setSelectedFolder(parent || undefined);
      }
      toast.success("Folder deleted");
      await refreshLibraryData();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to delete folder";
      toast.error(message);
    } finally {
      setFolderBusy(false);
    }
  }

  function dragSelectionPaths() {
    if (selectedPaths.size > 0 && dragRelPath && selectedPaths.has(dragRelPath)) {
      return Array.from(selectedPaths);
    }
    if (dragRelPath) return [dragRelPath];
    return [] as string[];
  }

  async function moveVideosToFolder(targetFolder: string, paths?: string[]) {
    if (!project || movingVideos) return;
    const targets =
      paths && paths.length > 0
        ? paths
        : selectedPaths.size > 0
          ? Array.from(selectedPaths)
          : dragSelectionPaths();

    if (targets.length === 0) {
      toast("Select videos or drag a video first");
      return;
    }

    setMovingVideos(true);
    try {
      const res = await invoke<MoveVideosResponse>("move_videos", {
        project,
        video_paths: targets,
        target_folder: targetFolder,
      });
      if (res.moved > 0) {
        toast.success(`Moved ${res.moved} video${res.moved !== 1 ? "s" : ""}`);
        // Optimistic cache update: remove moved videos from the current list immediately
        const movedFromSet = new Set(res.moved_paths.map((p) => p.from));
        queryClient.setQueryData<VideoEntry[]>(
          queryKeys.videos.list(project, search),
          (prev) => (prev ? prev.filter((v) => !movedFromSet.has(v.rel_path)) : [])
        );
      } else {
        toast("Nothing moved");
      }
      setSelectedPaths(new Set());
      setDragRelPath(null);
      setDragOverFolderPath(null);
      // Background refresh to sync subfolder counts and pick up new paths
      void refreshLibraryData();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to move videos";
      toast.error(message);
    } finally {
      setMovingVideos(false);
    }
  }

  function folderDropHandlers(path: string) {
    return {
      onDragOver: (event: DragEvent<HTMLButtonElement>) => {
        if (!dragRelPath) return;
        event.preventDefault();
        setDragOverFolderPath(path);
      },
      onDragLeave: () => {
        if (dragOverFolderPath === path) {
          setDragOverFolderPath(null);
        }
      },
      onDrop: (event: DragEvent<HTMLButtonElement>) => {
        if (!dragRelPath) return;
        event.preventDefault();
        setDragOverFolderPath(null);
        const paths = dragSelectionPaths();
        if (paths.length === 0) return;
        void moveVideosToFolder(path, paths);
      },
    };
  }

  function openNewFolderDialog() {
    setNewFolderParent(selectedFolder || "__root__");
    setNewFolderName("");
    setNewFolderOpen(true);
  }

  return (
    <div className="h-full min-h-0">
      {videosLoading || (project && detailLoading) ? (
        <div className="h-full flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="h-full min-h-0 flex flex-col gap-3">
          {project && (
            <div className="shrink-0 border-b pb-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 text-sm text-muted-foreground shrink-0">
                  <button
                    className="hover:text-foreground font-medium"
                    onClick={() => setSelectedFolder(undefined)}
                  >
                    {project}
                  </button>
                  {selectedFolder && (
                    <>
                      {selectedFolder.split("/").map((segment, i, arr) => {
                        const path = arr.slice(0, i + 1).join("/");
                        const isLast = i === arr.length - 1;
                        return (
                          <span key={path} className="flex items-center gap-1">
                            <span>/</span>
                            {isLast ? (
                              <span className="text-foreground font-medium">{segment}</span>
                            ) : (
                              <button
                                className="hover:text-foreground"
                                onClick={() => setSelectedFolder(path)}
                              >
                                {segment}
                              </button>
                            )}
                          </span>
                        );
                      })}
                    </>
                  )}
                </div>
                <div className="ml-auto flex items-center gap-1.5 shrink-0">
                  {!selectedFolder && (
                    <Button
                      variant={rootOnly ? "secondary" : "ghost"}
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => setRootOnly((v) => !v)}
                      title={rootOnly ? "Showing root-level videos only" : "Showing all videos including subfolders"}
                    >
                      <FolderMinus className="h-3 w-3 mr-1" />
                      {rootOnly ? "Root only" : "All folders"}
                    </Button>
                  )}
                  {selectedFolder && (
                    <Button
                      variant={showTimeline ? "secondary" : "ghost"}
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => setShowTimeline((v) => !v)}
                      title="Toggle timeline strip"
                    >
                      <FilmStrip className="h-3 w-3 mr-1" />
                      Timeline
                    </Button>
                  )}
                  <div className="w-full sm:w-[220px] relative">
                    <Search className="absolute left-2.5 top-1.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search..."
                      className="h-7 pl-9 text-xs"
                    />
                  </div>
                </div>
                <Badge variant="secondary" className="shrink-0 text-xs">
                  {[
                    videoCount > 0 ? `${videoCount} vid${videoCount !== 1 ? "s" : ""}` : null,
                    imageCount > 0 ? `${imageCount} img${imageCount !== 1 ? "s" : ""}` : null,
                  ]
                    .filter(Boolean)
                    .join(", ") || `${filteredVideos.length} items`}
                </Badge>
                {selectedPaths.size > 0 ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <Badge className="text-xs">{selectedPaths.size} sel</Badge>
                    {selectedPaths.size < filteredVideos.length && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() =>
                          setSelectedPaths(new Set(filteredVideos.map((v) => v.rel_path)))
                        }
                      >
                        <CheckSquare className="h-3 w-3 mr-1" />
                        All
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => setSelectedPaths(new Set())}
                    >
                      <XSquare className="h-3 w-3 mr-1" />
                      None
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs shrink-0"
                    onClick={() =>
                      setSelectedPaths(new Set(filteredVideos.map((v) => v.rel_path)))
                    }
                    disabled={filteredVideos.length === 0}
                  >
                    <CheckSquare className="h-3 w-3 mr-1" />
                    All
                  </Button>
                )}
              </div>
            </div>
          )}

          <div
            className={`min-h-0 flex-1 flex flex-col gap-3 ${
              project ? "lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-4" : ""
            }`}
          >
            {project && !detailLoading && !detailError && (
              <div className="lg:hidden">
                <Collapsible open={foldersOpen} onOpenChange={setFoldersOpen}>
                  <div className="flex items-center gap-2">
                    <CollapsibleTrigger className="flex items-center gap-1.5 text-sm font-medium hover:text-foreground text-muted-foreground">
                      {foldersOpen ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                      Folders ({folderCards.length})
                    </CollapsibleTrigger>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={openNewFolderDialog}
                      disabled={folderBusy}
                    >
                      <FolderPlus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <CollapsibleContent>
                    <div className="flex items-start gap-3 overflow-x-auto overflow-y-hidden pb-2 mt-2 min-h-[92px]">
                      {selectedFolder && (
                        <button
                          onClick={() => {
                            const parts = selectedFolder.split("/").slice(0, -1);
                            setSelectedFolder(parts.length ? parts.join("/") : undefined);
                          }}
                          className={`rounded border text-left p-1.5 w-[180px] shrink-0 ${
                            dragOverFolderPath === (parentPath || "")
                              ? "border-primary ring-2 ring-primary/60"
                              : "hover:bg-accent/50"
                          }`}
                          {...folderDropHandlers(parentPath || "")}
                        >
                          <div className="text-sm font-semibold truncate mb-1 flex items-center gap-1">
                            <ChevronUp className="h-3.5 w-3.5" />
                            {selectedFolder.split("/").length > 1
                              ? selectedFolder.split("/").slice(0, -1).pop()
                              : project}
                          </div>
                          <FolderThumbMosaic thumbs={parentThumbs} label="Up one level" />
                        </button>
                      )}
                      {folderCards.map((folder) => (
                        <FolderContextMenu
                          key={`ctx-mobile-${folder.key}`}
                          folderPath={folder.path}
                          folderLabel={folder.label}
                          onNavigate={(path) => setSelectedFolder(path)}
                          onRename={(path) => void renameFolder(path)}
                          onMove={(path) => void moveFolder(path)}
                          onDelete={(path) => void deleteFolder(path)}
                          disabled={folderBusy}
                        >
                          <button
                            onClick={() => setSelectedFolder(folder.path)}
                            className={`rounded border text-left p-1.5 w-[180px] shrink-0 ${
                              dragOverFolderPath === folder.path
                                ? "border-primary ring-2 ring-primary/60"
                                : selectedFolder === folder.path
                                  ? "border-primary bg-primary/10"
                                  : "hover:bg-accent/50"
                            }`}
                            title={folder.path}
                            {...folderDropHandlers(folder.path)}
                          >
                            <div className="text-sm font-semibold truncate mb-1">
                              {folder.label}
                            </div>
                            <FolderThumbMosaic thumbs={folder.thumbs} label={folder.label} />
                          </button>
                        </FolderContextMenu>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            )}

            {project && (
              <aside className="hidden lg:flex min-h-0 flex-col rounded-lg border bg-muted/10 p-2">
                <div className="flex items-center gap-2 px-1">
                  <span className="text-sm font-medium text-muted-foreground">
                    Folders ({folderCards.length})
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto h-7 w-7 p-0"
                    onClick={openNewFolderDialog}
                    disabled={folderBusy}
                  >
                    <FolderPlus className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {detailLoading && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground px-1 mt-2"><Loader2 className="h-3 w-3 animate-spin" />Loading folders...</span>
                )}
                {detailError && <div className="text-xs text-destructive px-1 mt-2">{detailError}</div>}
                {!detailLoading && !detailError && (
                  <div className="mt-2 min-h-0 flex-1 overflow-y-auto space-y-2 pr-1">
                    {selectedFolder && (
                      <button
                        onClick={() => {
                          const parts = selectedFolder.split("/").slice(0, -1);
                          setSelectedFolder(parts.length ? parts.join("/") : undefined);
                        }}
                        className={`rounded border text-left p-2 w-full ${
                          dragOverFolderPath === (parentPath || "")
                            ? "border-primary ring-2 ring-primary/60"
                            : "hover:bg-accent/50"
                        }`}
                        {...folderDropHandlers(parentPath || "")}
                        >
                          <div className="text-sm font-semibold truncate flex items-center gap-1">
                            <ChevronUp className="h-3.5 w-3.5" />
                            {selectedFolder.split("/").length > 1
                              ? selectedFolder.split("/").slice(0, -1).pop()
                              : project}
                          </div>
                          <div className="mt-1.5">
                            <FolderThumbMosaic thumbs={parentThumbs} label="Up one level" />
                          </div>
                        </button>
                      )}
                    {folderCards.length === 0 && (
                      <div className="text-xs text-muted-foreground px-1 py-2">
                        {selectedFolder
                          ? "No subfolders found."
                          : "No folders found in this project."}
                      </div>
                    )}
                    {folderCards.map((folder) => (
                      <FolderContextMenu
                        key={`ctx-desktop-${folder.key}`}
                        folderPath={folder.path}
                        folderLabel={folder.label}
                        onNavigate={(path) => setSelectedFolder(path)}
                        onRename={(path) => void renameFolder(path)}
                        onMove={(path) => void moveFolder(path)}
                        onDelete={(path) => void deleteFolder(path)}
                        disabled={folderBusy}
                      >
                        <button
                          onClick={() => setSelectedFolder(folder.path)}
                          className={`rounded border text-left p-2 w-full ${
                            dragOverFolderPath === folder.path
                              ? "border-primary ring-2 ring-primary/60"
                              : selectedFolder === folder.path
                                ? "border-primary bg-primary/10"
                                : "hover:bg-accent/50"
                          }`}
                          title={folder.path}
                          {...folderDropHandlers(folder.path)}
                        >
                          <div className="text-sm font-semibold truncate">{folder.label}</div>
                          <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                            {folder.path}
                          </div>
                          <div className="mt-1.5">
                            <FolderThumbMosaic thumbs={folder.thumbs} label={folder.label} />
                          </div>
                        </button>
                      </FolderContextMenu>
                    ))}
                  </div>
                )}
              </aside>
            )}

            <section className="min-h-0 flex flex-col gap-3">
              {project && detailLoading && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground lg:hidden"><Loader2 className="h-3 w-3 animate-spin" />Loading folders...</span>
              )}
              {project && detailError && (
                <div className="text-xs text-destructive lg:hidden">{detailError}</div>
              )}
              {editorVideo ? (
                <div className="min-h-0 flex-1 border rounded-lg overflow-hidden">
                  <VideoEditor
                    video={editorVideo}
                    videos={orderedVideos}
                    onBack={() => setEditorVideo(null)}
                    onRemoveVideo={(relPath) => {
                      removeVideo(relPath);
                      setSelectedPaths((prev) => {
                        const next = new Set(prev);
                        next.delete(relPath);
                        return next;
                      });
                    }}
                  />
                </div>
              ) : previewMode ? (
                <TimelinePreview
                  videos={orderedVideos}
                  onBack={() => setPreviewMode(false)}
                />
              ) : (
                <>
                  <LibraryActionPanel
                    selectedVideos={selectedVideos}
                    displayedVideos={orderedVideos}
                    currentProject={project}
                  />
                  {selectedFolder && showTimeline && (
                    <FolderTimeline
                      videos={orderedVideos}
                      onReorder={(newOrder) => void saveOrder(newOrder)}
                      onPreview={() => setPreviewMode(true)}
                    />
                  )}
                  <div ref={gridScrollRef} className="min-h-0 flex-1 overflow-y-auto">
                    <div className="space-y-3 pr-1 pb-2">
                      {project && dragRelPath !== null && dropTargets.length > 0 && (
                        <div className="sticky top-0 z-10 backdrop-blur rounded-md border border-dashed border-primary/50 bg-primary/5 p-2">
                          <div className="text-[11px] text-muted-foreground mb-1">
                            Drop into folder
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {dropTargets.map((target) => (
                              <button
                                key={`drop-target-${target.path || "__root__"}`}
                                className={`rounded-full border px-2.5 py-1 text-xs ${
                                  dragOverFolderPath === target.path
                                    ? "border-primary bg-primary/10 ring-2 ring-primary/60"
                                    : "hover:bg-accent/50"
                                }`}
                                onClick={() => {
                                  if (selectedPaths.size === 0) {
                                    toast("Select videos first, or drag onto a target");
                                    return;
                                  }
                                  void moveVideosToFolder(target.path, Array.from(selectedPaths));
                                }}
                                {...folderDropHandlers(target.path)}
                              >
                                {target.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      <VideoGrid
                        videos={orderedVideos}
                        selectedPaths={selectedPaths}
                        onToggleSelect={toggleSelect}
                        onVideoClick={setEditorVideo}
                        onVideoDragStart={(video, event) => {
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", video.rel_path);
                          setDragRelPath(video.rel_path);
                          // Multi-drag badge
                          const count = selectedPaths.has(video.rel_path) ? selectedPaths.size : 1;
                          if (count > 1) {
                            const badge = document.createElement("div");
                            badge.textContent = `${count} items`;
                            Object.assign(badge.style, {
                              position: "fixed", top: "-9999px", left: "-9999px",
                              display: "flex", alignItems: "center", gap: "6px",
                              borderRadius: "8px", padding: "6px 12px",
                              fontSize: "13px", fontWeight: "500",
                              background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))",
                            });
                            document.body.appendChild(badge);
                            event.dataTransfer.setDragImage(badge, 40, 20);
                            requestAnimationFrame(() => badge.remove());
                          }
                        }}
                        onVideoDragEnd={() => {
                          setDragRelPath(null);
                          setDragOverFolderPath(null);
                        }}
                        reorderEnabled={!!selectedFolder}
                        onReorder={(newOrder) => void saveOrder(newOrder)}
                      />
                    </div>
                  </div>
                </>
              )}
            </section>
          </div>
        </div>
      )}
      <Dialog
        open={newFolderOpen}
        onOpenChange={(open) => {
          setNewFolderOpen(open);
          if (!open) {
            setNewFolderName("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Folder</DialogTitle>
            <DialogDescription>
              Choose a destination inside this project and create the folder.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Folder name</div>
              <Input
                value={newFolderName}
                onChange={(event) => setNewFolderName(event.target.value)}
                placeholder="e.g. selects, b-roll, picks"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void createFolderFromDialog();
                  }
                }}
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Destination</div>
              <Select value={newFolderParent} onValueChange={setNewFolderParent}>
                <SelectTrigger>
                  <SelectValue placeholder="Select destination folder" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__root__">Project Root</SelectItem>
                  {allFolderPaths.map((folderPath) => (
                    <SelectItem key={`new-folder-parent-${folderPath}`} value={folderPath}>
                      {folderPath}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setNewFolderOpen(false);
                setNewFolderName("");
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={folderBusy || !project || newFolderName.trim().length === 0}
              onClick={() => {
                void createFolderFromDialog();
              }}
            >
              Create Folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function buildFolderCards(
  basePath: string,
  subfolders: string[] | undefined,
  videos: VideoEntry[],
  project: string | undefined
) {
  if (!project) return [] as FolderCard[];
  const folders = subfolders ?? [];
  const unique = new Map<string, { path: string; label: string }>();
  const prefix = basePath ? `${basePath}/` : "";

  for (const folder of folders) {
    if (basePath && !folder.startsWith(prefix)) continue;
    const remainder = basePath ? folder.slice(prefix.length) : folder;
    const segment = remainder.split("/")[0];
    if (!segment) continue;
    const path = basePath ? `${basePath}/${segment}` : segment;
    if (!unique.has(path)) {
      unique.set(path, { path, label: segment });
    }
  }

  const videoIndex = new Map<string, VideoEntry[]>();
  for (const v of videos) {
    if (!v.folder.startsWith(`${project}/`)) continue;
    const rel = v.folder.slice(project.length + 1);
    if (!videoIndex.has(rel)) videoIndex.set(rel, []);
    videoIndex.get(rel)!.push(v);
  }

  return Array.from(unique.values()).map((entry) => {
    const fullFolder = `${project}/${entry.path}`;
    const direct = videoIndex.get(entry.path) || [];
    let candidates = direct;
    if (candidates.length === 0) {
      const childPrefix = `${entry.path}/`;
      candidates = videos.filter((v) => {
        if (!v.folder.startsWith(`${project}/`)) return false;
        const rel = v.folder.slice(project.length + 1);
        return rel.startsWith(childPrefix);
      });
    }
    const thumbs = candidates.slice(0, 4).map((v) => thumbUrl(v.rel_path));
    return {
      key: entry.path,
      label: entry.label,
      path: entry.path,
      fullPath: fullFolder,
      thumbs,
    };
  });
}

function buildFolderPreviewThumbs(
  folderPath: string,
  videos: VideoEntry[],
  project: string | undefined
) {
  if (!project) return [] as string[];
  const prefix = `${project}/`;
  const direct = videos.filter((v) => v.folder === `${project}/${folderPath}`);
  if (direct.length > 0) {
    return direct.slice(0, 4).map((v) => thumbUrl(v.rel_path));
  }
  const descendantPrefix = folderPath ? `${folderPath}/` : "";
  const candidates = videos.filter((v) => {
    if (!v.folder.startsWith(prefix)) return false;
    const rel = v.folder.slice(prefix.length);
    return descendantPrefix ? rel.startsWith(descendantPrefix) : true;
  });
  return candidates.slice(0, 4).map((v) => thumbUrl(v.rel_path));
}

const FolderThumbMosaic = memo(function FolderThumbMosaic({ thumbs, label }: { thumbs: string[]; label: string }) {
  if (thumbs.length === 0) {
    return (
      <div className="h-18 rounded bg-muted flex items-center justify-center text-[10px] text-muted-foreground">
        No preview
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 grid-rows-2 gap-1 h-18">
      {(thumbs.length >= 1 ? [thumbs[0]] : [null]).map((thumb, i) =>
        thumb ? (
          <img
            key={`${label}-thumb-main-${i}`}
            src={thumb}
            alt={label}
            className="col-span-1 row-span-2 w-full h-full rounded object-cover"
            loading="lazy"
          />
        ) : (
          <div
            key={`${label}-thumb-main-empty-${i}`}
            className="col-span-1 row-span-2 rounded bg-muted"
          />
        )
      )}
      {(thumbs.length >= 2 ? [thumbs[1]] : [null]).map((thumb, i) =>
        thumb ? (
          <img
            key={`${label}-thumb-top-${i}`}
            src={thumb}
            alt={label}
            className="w-full h-full rounded object-cover"
            loading="lazy"
          />
        ) : (
          <div key={`${label}-thumb-top-empty-${i}`} className="rounded bg-muted" />
        )
      )}
      {(thumbs.length >= 3 ? [thumbs[2]] : [null]).map((thumb, i) =>
        thumb ? (
          <img
            key={`${label}-thumb-bottom-${i}`}
            src={thumb}
            alt={label}
            className="w-full h-full rounded object-cover"
            loading="lazy"
          />
        ) : (
          <div key={`${label}-thumb-bottom-empty-${i}`} className="rounded bg-muted" />
        )
      )}
    </div>
  );
});
