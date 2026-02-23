import { useState, useMemo, useEffect, useRef } from "react";
import type { DragEvent } from "react";
import { apiPost, apiPostNoContent, thumbUrl } from "@/api/client";
import { useProjectDetail } from "@/hooks/use-project-detail";
import { useVideos } from "@/hooks/use-videos";
import { VideoGrid } from "@/components/library/video-grid";
import { VideoPlayerModal } from "@/components/library/video-player-modal";
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
  FolderOutput,
  FolderPlus,
  CheckSquare,
  XSquare,
  X,
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
  onNavigate,
}: {
  project?: string;
  onNavigate?: (tab: string) => void;
}) {
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [foldersOpen, setFoldersOpen] = useState(true);
  const {
    detail,
    loading: detailLoading,
    error: detailError,
    refresh: refreshDetail,
  } = useProjectDetail(project);
  const { videos, loading: videosLoading, refresh } = useVideos(project, search);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [activeVideo, setActiveVideo] = useState<VideoEntry | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);
  const [movingVideos, setMovingVideos] = useState(false);
  const [dragRelPath, setDragRelPath] = useState<string | null>(null);
  const [dragOverFolderPath, setDragOverFolderPath] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderParent, setNewFolderParent] = useState("__root__");

  const toggleSelect = (relPath: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(relPath)) next.delete(relPath);
      else next.add(relPath);
      return next;
    });
  };

  useEffect(() => {
    setSelectedFolder(undefined);
    setSelectedPaths(new Set());
    setActiveVideo(null);
    setDragRelPath(null);
    setDragOverFolderPath(null);
  }, [project]);

  useEffect(() => {
    setSelectedPaths(new Set());
    setActiveVideo(null);
    setDragRelPath(null);
    setDragOverFolderPath(null);
  }, [selectedFolder]);

  const filteredVideos = useMemo(() => {
    if (!project || !selectedFolder) return videos;
    const prefix = `${project}/${selectedFolder}`;
    return videos.filter(
      (v) => v.folder === prefix || v.folder.startsWith(`${prefix}/`)
    );
  }, [videos, project, selectedFolder]);

  const folderCards = useMemo(
    () => buildFolderCards(selectedFolder || "", detail?.subfolders, videos, project),
    [detail?.subfolders, project, selectedFolder, videos]
  );

  const hasOutputs = useMemo(() => {
    if (!project || !detail?.subfolders) return false;
    return detail.subfolders.some((f) => f.split("/").includes("outputs"));
  }, [project, detail?.subfolders]);

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
    const paths = (detail?.subfolders ?? []).filter(
      (folder) => !folder.split("/").includes("outputs")
    );
    paths.sort((a, b) => a.localeCompare(b));
    return paths;
  }, [detail?.subfolders]);

  const siblingDropTargets = useMemo(() => {
    if (!project || !selectedFolder) return [] as { path: string; label: string }[];
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
    const scrollEl = findScrollContainer(pageRef.current);
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
      await apiPost<FolderPathResponse>("/api/folders/create", {
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
      const res = await apiPost<FolderPathResponse>("/api/folders/rename", {
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
      const res = await apiPost<FolderPathResponse>("/api/folders/move", {
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
      await apiPostNoContent("/api/folders/delete", {
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
      const res = await apiPost<MoveVideosResponse>("/api/folders/move-videos", {
        project,
        video_paths: targets,
        target_folder: targetFolder,
      });
      if (res.moved > 0) {
        toast.success(`Moved ${res.moved} video${res.moved !== 1 ? "s" : ""}`);
      } else {
        toast("Nothing moved");
      }
      setSelectedPaths(new Set());
      setDragRelPath(null);
      setDragOverFolderPath(null);
      await refreshLibraryData();
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
    <div ref={pageRef} className="h-full">
      <div className="p-4">
        {videosLoading ? (
          <div className="text-muted-foreground text-sm">Loading...</div>
        ) : (
          <div className="space-y-3">
            {/* Compact sticky toolbar */}
            {project && (
              <div className="sticky top-12 z-10 bg-background/95 backdrop-blur border-b pb-2 shadow-sm -mx-4 px-4">
                <div className="flex items-center gap-3 h-11">
                  {/* Breadcrumb */}
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

                  {/* Search */}
                  <div className="ml-auto w-[200px] relative shrink-0">
                    <Search className="absolute left-2.5 top-1.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search..."
                      className="h-7 pl-9 text-xs"
                    />
                  </div>

                  {/* Scope badges */}
                  {!videosLoading && (
                    <Badge variant="secondary" className="shrink-0 text-xs">
                      {[
                        videoCount > 0 ? `${videoCount} vid${videoCount !== 1 ? "s" : ""}` : null,
                        imageCount > 0 ? `${imageCount} img${imageCount !== 1 ? "s" : ""}` : null,
                      ]
                        .filter(Boolean)
                        .join(", ") || `${filteredVideos.length} items`}
                    </Badge>
                  )}

                  {/* Selection controls */}
                  {selectedPaths.size > 0 ? (
                    <div className="flex items-center gap-1 shrink-0">
                      <Badge className="text-xs">{selectedPaths.size} sel</Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => setSelectedPaths(new Set())}
                      >
                        <X className="h-3 w-3" />
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
                  {selectedPaths.size > 0 && selectedPaths.size < filteredVideos.length && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs shrink-0"
                      onClick={() =>
                        setSelectedPaths(new Set(filteredVideos.map((v) => v.rel_path)))
                      }
                    >
                      <CheckSquare className="h-3 w-3 mr-1" />
                      All
                    </Button>
                  )}
                  {selectedPaths.size > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs shrink-0"
                      onClick={() => setSelectedPaths(new Set())}
                    >
                      <XSquare className="h-3 w-3 mr-1" />
                      None
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Drop targets — only visible during drag */}
            {project && dragRelPath !== null && selectedFolder && (
              <div className="rounded-md border border-dashed border-primary/50 bg-primary/5 p-2">
                <div className="text-[11px] text-muted-foreground mb-1">
                  Drop into folder
                </div>
                <div className="flex flex-wrap gap-2">
                  {siblingDropTargets.map((target) => (
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

            {/* Collapsible folder carousel */}
            {project && !detailLoading && !detailError && (
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
                        {parentThumbs.length > 0 ? (
                          <div className="grid grid-cols-2 grid-rows-2 gap-1 h-18">
                            {(parentThumbs.length >= 1 ? [parentThumbs[0]] : [null]).map(
                              (thumb, i) =>
                                thumb ? (
                                  <img
                                    key={`up-thumb-main-${i}`}
                                    src={thumb}
                                    alt="Up one level"
                                    className="col-span-1 row-span-2 w-full h-full rounded object-cover"
                                    loading="lazy"
                                  />
                                ) : (
                                  <div
                                    key={`up-thumb-main-empty-${i}`}
                                    className="col-span-1 row-span-2 rounded bg-muted"
                                  />
                                )
                            )}
                            {(parentThumbs.length >= 2 ? [parentThumbs[1]] : [null]).map(
                              (thumb, i) =>
                                thumb ? (
                                  <img
                                    key={`up-thumb-top-${i}`}
                                    src={thumb}
                                    alt="Up one level"
                                    className="w-full h-full rounded object-cover"
                                    loading="lazy"
                                  />
                                ) : (
                                  <div
                                    key={`up-thumb-top-empty-${i}`}
                                    className="rounded bg-muted"
                                  />
                                )
                            )}
                            {(parentThumbs.length >= 3 ? [parentThumbs[2]] : [null]).map(
                              (thumb, i) =>
                                thumb ? (
                                  <img
                                    key={`up-thumb-bottom-${i}`}
                                    src={thumb}
                                    alt="Up one level"
                                    className="w-full h-full rounded object-cover"
                                    loading="lazy"
                                  />
                                ) : (
                                  <div
                                    key={`up-thumb-bottom-empty-${i}`}
                                    className="rounded bg-muted"
                                  />
                                )
                            )}
                          </div>
                        ) : (
                          <div className="h-18 rounded bg-muted flex items-center justify-center text-[10px] text-muted-foreground">
                            No preview
                          </div>
                        )}
                      </button>
                    )}
                    {folderCards.length === 0 && (
                      <div className="text-xs text-muted-foreground min-w-[200px] flex items-center">
                        {selectedFolder
                          ? "No subfolders found."
                          : "No folders found in this project."}
                      </div>
                    )}
                    {folderCards.map((folder) => (
                      <FolderContextMenu
                        key={`ctx-${folder.key}`}
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
                          {folder.thumbs.length > 0 ? (
                            <div className="grid grid-cols-2 grid-rows-2 gap-1 h-18">
                              {(folder.thumbs.length >= 1 ? [folder.thumbs[0]] : [null]).map(
                                (thumb, i) =>
                                  thumb ? (
                                    <img
                                      key={`${folder.key}-thumb-main-${i}`}
                                      src={thumb}
                                      alt={folder.label}
                                      className="col-span-1 row-span-2 w-full h-full rounded object-cover"
                                      loading="lazy"
                                    />
                                  ) : (
                                    <div
                                      key={`${folder.key}-thumb-main-empty-${i}`}
                                      className="col-span-1 row-span-2 rounded bg-muted"
                                    />
                                  )
                              )}
                              {(folder.thumbs.length >= 2 ? [folder.thumbs[1]] : [null]).map(
                                (thumb, i) =>
                                  thumb ? (
                                    <img
                                      key={`${folder.key}-thumb-top-${i}`}
                                      src={thumb}
                                      alt={folder.label}
                                      className="w-full h-full rounded object-cover"
                                      loading="lazy"
                                    />
                                  ) : (
                                    <div
                                      key={`${folder.key}-thumb-top-empty-${i}`}
                                      className="rounded bg-muted"
                                    />
                                  )
                              )}
                              {(folder.thumbs.length >= 3 ? [folder.thumbs[2]] : [null]).map(
                                (thumb, i) =>
                                  thumb ? (
                                    <img
                                      key={`${folder.key}-thumb-bottom-${i}`}
                                      src={thumb}
                                      alt={folder.label}
                                      className="w-full h-full rounded object-cover"
                                      loading="lazy"
                                    />
                                  ) : (
                                    <div
                                      key={`${folder.key}-thumb-bottom-empty-${i}`}
                                      className="rounded bg-muted"
                                    />
                                  )
                              )}
                            </div>
                          ) : (
                            <div className="h-18 rounded bg-muted flex items-center justify-center text-[10px] text-muted-foreground">
                              No preview
                            </div>
                          )}
                        </button>
                      </FolderContextMenu>
                    ))}
                    {!selectedFolder && hasOutputs && onNavigate && (
                      <button
                        onClick={() => onNavigate("outputs")}
                        className="rounded border text-left p-1.5 w-[180px] shrink-0 hover:bg-accent/50"
                      >
                        <div className="text-sm font-semibold truncate mb-1 flex items-center gap-1">
                          <FolderOutput className="h-3.5 w-3.5" />
                          Outputs
                        </div>
                        <div className="h-18 rounded bg-muted/50 flex items-center justify-center text-[10px] text-muted-foreground">
                          View project outputs
                        </div>
                      </button>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            {project && detailLoading && (
              <span className="text-xs text-muted-foreground">Loading folders...</span>
            )}
            {project && detailError && (
              <div className="text-xs text-destructive">{detailError}</div>
            )}

            <LibraryActionPanel
              selectedVideos={selectedVideos}
              displayedVideos={filteredVideos}
              currentProject={project}
            />
            <VideoGrid
              videos={filteredVideos}
              selectedPaths={selectedPaths}
              onToggleSelect={toggleSelect}
              onVideoClick={setActiveVideo}
              onVideoDragStart={(video, event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", video.rel_path);
                setDragRelPath(video.rel_path);
              }}
              onVideoDragEnd={() => {
                setDragRelPath(null);
                setDragOverFolderPath(null);
              }}
            />
          </div>
        )}
      </div>
      <VideoPlayerModal
        video={activeVideo}
        videos={filteredVideos}
        onClose={() => setActiveVideo(null)}
        onNavigate={setActiveVideo}
        onDeleted={() => setSelectedPaths(new Set())}
        onRefresh={refresh}
      />
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

function findScrollContainer(node: HTMLElement | null): HTMLElement | null {
  let current = node?.parentElement ?? null;
  while (current) {
    const style = window.getComputedStyle(current);
    const overflowY = style.overflowY;
    if (overflowY === "auto" || overflowY === "scroll") {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function buildFolderCards(
  basePath: string,
  subfolders: string[] | undefined,
  videos: VideoEntry[],
  project: string | undefined
) {
  if (!project) return [] as FolderCard[];
  const folders = (subfolders ?? []).filter(
    (folder) => !folder.split("/").includes("outputs")
  );
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
