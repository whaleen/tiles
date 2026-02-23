import { useEffect, useMemo, useState } from "react";
import { useOutputTree } from "@/hooks/use-output-tree";
import { apiDelete, apiGet, outThumbUrl, outVideoUrl } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRunningActions } from "@/hooks/use-running-actions";
import { useProjects } from "@/hooks/use-projects";
import {
  RefreshCw,
  Trash2,
  Search,
  Loader2,
} from "lucide-react";
import { getActionIcon, formatActionName } from "@/lib/action-icons";
import { toast } from "sonner";
import type { OutputEntry } from "@/types";

type OutputFile = OutputEntry & {
  source?: "global" | "project";
  project?: string | null;
};

export function OutputsPage({ project }: { project?: string }) {
  const [activeGroup, setActiveGroup] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<OutputFile | null>(null);
  const [activeView, setActiveView] = useState<"all" | "global" | "project">(
    project ? "project" : "global"
  );
  const [search, setSearch] = useState("");
  const [groupThumbs, setGroupThumbs] = useState<Record<string, OutputEntry[]>>({});
  const [deleting, setDeleting] = useState(false);
  const [allFiles, setAllFiles] = useState<OutputFile[]>([]);
  const [allLoading, setAllLoading] = useState(false);
  const [allError, setAllError] = useState<string | null>(null);
  const [allRefreshKey, setAllRefreshKey] = useState(0);
  const { running: runningActions } = useRunningActions();
  const { projects } = useProjects();

  const globalRoot = "outputs";
  const projectRoot = project ? `src/${project}/outputs` : "src/__missing__/outputs";
  const {
    entries: globalEntries,
    loading: globalLoading,
    error: globalError,
    refresh: refreshGlobal,
  } = useOutputTree(globalRoot);
  const {
    entries: projectEntries,
    loading: projectLoading,
    error: projectError,
    refresh: refreshProject,
  } = useOutputTree(projectRoot);

  useEffect(() => {
    if (!project && activeView === "project") {
      setActiveView("global");
    }
  }, [project, activeView]);

  useEffect(() => {
    setActiveGroup("");
    setSelectedFile(null);
    setSearch("");
  }, [activeView, project]);

  const groups = useMemo(
    () =>
      (activeView === "project" ? projectEntries : globalEntries)
        .filter(
          (e) =>
            e.is_dir &&
            e.name !== "tui-thumbs" &&
            e.name !== "tui-logs" &&
            e.name !== ".DS_Store"
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [activeView, globalEntries, projectEntries]
  );
  const rootFiles = useMemo(
    () =>
      (activeView === "project" ? projectEntries : globalEntries).filter(
        (e) => !e.is_dir
      ),
    [activeView, globalEntries, projectEntries]
  );

  useEffect(() => {
    let cancelled = false;
    if (activeView === "all") return () => {
      cancelled = true;
    };
    const fetchThumbs = async () => {
      const updates: Record<string, OutputEntry[]> = {};
      const toFetch = groups
        .filter((g) => !groupThumbs[g.rel_path])
        .slice(0, 24);
      if (toFetch.length === 0) return;
      await Promise.all(
        toFetch.map(async (group) => {
          try {
            const list = await apiGet<OutputEntry[]>(
              `/api/outputs/tree?path=${encodeURIComponent(group.rel_path)}`
            );
            const thumbs = list
              .filter((e) => !e.is_dir && (e.kind === "video" || e.kind === "image"))
              .slice(0, 4);
            updates[group.rel_path] = thumbs;
          } catch {
            updates[group.rel_path] = [];
          }
        })
      );
      if (cancelled) return;
      setGroupThumbs((prev) => ({ ...prev, ...updates }));
    };
    fetchThumbs();
    return () => {
      cancelled = true;
    };
  }, [activeView, groups, groupThumbs]);

  const activeRoot = activeView === "project" ? projectRoot : globalRoot;
  const activePath = activeGroup || activeRoot;
  const {
    entries: groupEntries,
    loading: groupLoading,
    error: groupError,
    refresh: refreshGroup,
  } = useOutputTree(activePath);

  useEffect(() => {
    if (activeView !== "all") return;
    let cancelled = false;

    const fetchAllFiles = async () => {
      setAllLoading(true);
      setAllError(null);
      try {
        const roots = [
          { path: globalRoot, source: "global" as const, project: null },
          ...projects.map((p) => ({
            path: `src/${p.name}/outputs`,
            source: "project" as const,
            project: p.name,
          })),
        ];

        const groupLists = await Promise.all(
          roots.map(async (root) => {
            const list = await apiGet<OutputEntry[]>(
              `/api/outputs/tree?path=${encodeURIComponent(root.path)}`
            );
            const groups = list
              .filter(
                (e) =>
                  e.is_dir &&
                  e.name !== "tui-thumbs" &&
                  e.name !== "tui-logs" &&
                  e.name !== ".DS_Store"
              )
              .sort((a, b) => a.name.localeCompare(b.name));
            return { root, groups };
          })
        );

        const files = await Promise.all(
          groupLists.flatMap(({ root, groups }) =>
            groups.map(async (group) => {
              const list = await apiGet<OutputEntry[]>(
                `/api/outputs/tree?path=${encodeURIComponent(group.rel_path)}`
              );
              return list
                .filter((e) => !e.is_dir)
                .map((e) => ({
                  ...e,
                  source: root.source,
                  project: root.project,
                }));
            })
          )
        );

        const flat = files.flat().sort((a, b) => {
          if (a.modified_epoch === b.modified_epoch) {
            return a.name.localeCompare(b.name);
          }
          return b.modified_epoch - a.modified_epoch;
        });
        if (cancelled) return;
        setAllFiles(flat);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Failed to load outputs";
        setAllError(message);
      } finally {
        if (!cancelled) setAllLoading(false);
      }
    };

    fetchAllFiles();
    return () => {
      cancelled = true;
    };
  }, [activeView, projects, allRefreshKey, globalRoot]);

  const files = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list: OutputFile[] =
      activeView === "all"
        ? allFiles
        : (activeGroup ? groupEntries : rootFiles)
            .filter((e) => !e.is_dir)
            .map((e) => ({ ...e }));
    return q ? list.filter((e) => e.name.toLowerCase().includes(q)) : list;
  }, [activeView, allFiles, groupEntries, rootFiles, search, activeGroup]);

  const visibleRunning = useMemo(() => {
    if (activeView === "all") return runningActions;
    if (!project) return runningActions;
    return runningActions.filter(
      (run) => run.project === project || (!run.project && run.output_mode === "global")
    );
  }, [activeView, project, runningActions]);

  const activeLoading = activeView === "project" ? projectLoading : globalLoading;
  const activeError = activeView === "project" ? projectError : globalError;
  const refreshActive = activeView === "project" ? refreshProject : refreshGlobal;

  const handleRefresh = () => {
    if (activeView === "all") {
      setAllRefreshKey((key) => key + 1);
      return;
    }
    refreshActive();
    refreshGroup();
  };

  const handleDelete = async (
    relPath: string,
    label: string,
    reset: () => void
  ) => {
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await apiDelete(outputDeletePath(relPath));
      reset();
      if (activeView === "all") {
        setAllRefreshKey((key) => key + 1);
      } else {
        refreshActive();
        refreshGroup();
      }
      toast.success("Deleted", { description: label });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Delete failed";
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {visibleRunning.length > 0 && (
        <div className="border rounded-lg p-4 bg-muted/20 space-y-2">
          <div className="text-sm font-semibold flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            In Progress
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {visibleRunning.map((run) => {
              const RunIcon = getActionIcon(run.action);
              return (
              <div key={run.id} className="border rounded-lg p-3 bg-background">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium flex items-center gap-1.5">
                    <RunIcon className="h-3.5 w-3.5 shrink-0" />
                    {formatActionName(run.action)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {timeAgo(run.started_epoch)}
                  </div>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {run.project ? `Project: ${run.project}` : "Global"}
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  Output: {run.output || run.output_mode}
                </div>
              </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 border rounded-lg p-4 bg-muted/20 space-y-4">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search outputs..."
              className="pl-9"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Views</h3>
              <Button size="sm" variant="outline" onClick={handleRefresh}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="space-y-2">
              <button
                className={`w-full text-left px-2 py-2 rounded border ${
                  activeView === "all" ? "border-primary bg-primary/10" : "hover:bg-accent/50"
                }`}
                onClick={() => setActiveView("all")}
              >
                <div className="text-sm font-medium">All projects</div>
                <div className="text-[11px] text-muted-foreground">All outputs</div>
              </button>
              <button
                className={`w-full text-left px-2 py-2 rounded border ${
                  activeView === "global"
                    ? "border-primary bg-primary/10"
                    : "hover:bg-accent/50"
                }`}
                onClick={() => setActiveView("global")}
              >
                <div className="text-sm font-medium">Global outputs</div>
                <div className="text-[11px] text-muted-foreground">{globalRoot}</div>
              </button>
              {project && (
                <button
                  className={`w-full text-left px-2 py-2 rounded border ${
                    activeView === "project"
                      ? "border-primary bg-primary/10"
                      : "hover:bg-accent/50"
                  }`}
                  onClick={() => setActiveView("project")}
                >
                  <div className="text-sm font-medium">Project outputs</div>
                  <div className="text-[11px] text-muted-foreground">{project}</div>
                </button>
              )}
            </div>
          </div>

          {activeView !== "all" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Groups</h3>
                {activeGroup && (
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={deleting}
                    onClick={() =>
                      handleDelete(activeGroup, "group", () => {
                        setActiveGroup("");
                        setSelectedFile(null);
                      })
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </Button>
                )}
              </div>
              {activeLoading && (
                <div className="text-xs text-muted-foreground">Loading groups...</div>
              )}
              {activeError && !activeLoading && (
                <div className="text-xs text-destructive">{activeError}</div>
              )}
              {!activeLoading && !activeError && groups.length === 0 && (
                <div className="text-xs text-muted-foreground">No output groups found.</div>
              )}
              <div className="space-y-2">
                <button
                  className={`w-full text-left px-2 py-2 rounded border ${
                    activeGroup === "" ? "border-primary bg-primary/10" : "hover:bg-accent/50"
                  }`}
                  onClick={() => {
                    setActiveGroup("");
                    setSelectedFile(null);
                  }}
                >
                  <div className="text-sm font-medium">All outputs</div>
                  <div className="text-[11px] text-muted-foreground">{activeRoot}</div>
                </button>
                {groups.map((group) => {
                  const GroupIcon = getActionIcon(group.name);
                  return (
                    <button
                      key={group.rel_path}
                      className={`w-full text-left px-2 py-2 rounded border ${
                        activeGroup === group.rel_path
                          ? "border-primary bg-primary/10"
                          : "hover:bg-accent/50"
                      }`}
                      onClick={() => {
                        setActiveGroup(group.rel_path);
                        setSelectedFile(null);
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-10 h-8 rounded border bg-muted overflow-hidden grid grid-cols-2 gap-0.5">
                          {renderThumbGrid(groupThumbs[group.rel_path] || [])}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate flex items-center gap-1.5">
                            <GroupIcon className="h-3.5 w-3.5 shrink-0" />
                            {formatActionName(group.name)}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {timeAgo(group.modified_epoch)}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Outputs</h3>
              {activeView === "all" && allLoading && (
                <div className="text-[11px] text-muted-foreground">Loading...</div>
              )}
            </div>
            {activeView !== "all" && groupLoading && (
              <div className="text-xs text-muted-foreground">Loading files...</div>
            )}
            {activeView === "all" && allError && !allLoading && (
              <div className="text-xs text-destructive">{allError}</div>
            )}
            {activeView !== "all" && groupError && !groupLoading && (
              <div className="text-xs text-destructive">{groupError}</div>
            )}
            {!groupLoading && !allLoading && files.length === 0 && (
              <div className="text-xs text-muted-foreground">No files found.</div>
            )}
            <div className="space-y-2 max-h-[60vh] overflow-auto pr-1">
              {files.map((file) => {
                const projectName = file.project ?? projectFromRel(file.rel_path);
                const groupName = outputGroupFromRel(file.rel_path);
                const meta = [
                  groupName ? formatActionName(groupName) : null,
                  projectName ?? (file.source === "global" ? "Global" : null),
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <button
                    key={file.rel_path}
                    className={`w-full text-left px-2 py-2 rounded border ${
                      selectedFile?.rel_path === file.rel_path
                        ? "border-primary bg-primary/10"
                        : "hover:bg-accent/50"
                    }`}
                    onClick={() => setSelectedFile(file)}
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-12 h-8 rounded border bg-muted overflow-hidden">
                        {file.kind === "image" ? (
                          <img
                            src={outVideoUrl(file.rel_path)}
                            alt={file.name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : file.kind === "video" ? (
                          <img
                            src={outThumbUrl(file.rel_path)}
                            alt={file.name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm truncate">{file.name}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {timeAgo(file.modified_epoch)}
                        </div>
                        {meta && (
                          <div className="text-[10px] text-muted-foreground truncate">
                            {meta}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-4">
          {!selectedFile && (
            <div className="border rounded-lg p-6 text-sm text-muted-foreground">
              Select an output to preview.
            </div>
          )}
          {selectedFile && (
            <div className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">{selectedFile.name}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {selectedFile.rel_path}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {buildSourceLabel(selectedFile)}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={deleting}
                  onClick={() =>
                    handleDelete(selectedFile.rel_path, selectedFile.name, () => {
                      setSelectedFile(null);
                    })
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              </div>
              {selectedFile.kind === "video" && (
                <video
                  src={outVideoUrl(selectedFile.rel_path)}
                  className="w-full rounded aspect-video bg-muted"
                  controls
                  preload="metadata"
                />
              )}
              {selectedFile.kind === "image" && (
                <img
                  src={outVideoUrl(selectedFile.rel_path)}
                  className="w-full rounded bg-muted"
                  alt={selectedFile.name}
                />
              )}
              {selectedFile.kind !== "video" && selectedFile.kind !== "image" && (
                <div className="text-xs text-muted-foreground">
                  No preview available for this file type.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function renderThumbGrid(previews: OutputEntry[]) {
  const empty = Math.max(0, 4 - previews.length);
  return (
    <>
      {previews.map((file, i) => (
        <img
          key={`${file.rel_path}-${i}`}
          src={file.kind === "image" ? outVideoUrl(file.rel_path) : outThumbUrl(file.rel_path)}
          alt={file.name}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      ))}
      {Array.from({ length: empty }, (_, i) => (
        <div key={`empty-${i}`} className="bg-muted" />
      ))}
    </>
  );
}

function timeAgo(epoch: number) {
  if (!epoch) return "--";
  const diff = Date.now() - epoch * 1000;
  if (diff < 0) return "just now";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function projectFromRel(relPath: string) {
  if (!relPath.startsWith("src/")) return null;
  const parts = relPath.split("/");
  return parts.length > 1 ? parts[1] : null;
}

function outputGroupFromRel(relPath: string) {
  if (relPath.startsWith("outputs/")) {
    const parts = relPath.split("/");
    return parts.length > 1 ? parts[1] : null;
  }
  if (relPath.startsWith("src/")) {
    const parts = relPath.split("/");
    return parts.length > 3 ? parts[3] : null;
  }
  return null;
}

function buildSourceLabel(file: OutputFile) {
  const project = file.project ?? projectFromRel(file.rel_path);
  if (project) return `Project: ${project}`;
  return file.source === "global" || file.rel_path.startsWith("outputs/")
    ? "Global outputs"
    : "Outputs";
}

function outputDeletePath(relPath: string) {
  return `/api/outputs/${encodeURIComponent(relPath).replace(/%2F/g, "/")}`;
}
