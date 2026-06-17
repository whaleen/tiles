import {
  Film,
  FolderOpen,
  FolderOutput,
  FolderSync,
  Grid3X3,
  Import,
  LayoutGrid,
  List,
  Loader2,
  Plus,
  Search,
  Settings,
  Settings2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { CreateProjectDialog } from "@/components/create-project-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { outThumbUrl, outVideoUrl, thumbUrl, videoUrl } from "@/api/client";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useOutputs } from "@/hooks/use-outputs";
import { useProjectDetailsMap } from "@/hooks/use-project-details-map";
import { useProjectMetasMap } from "@/hooks/use-project-metas-map";
import { useProjects } from "@/hooks/use-projects";
import { useRunningActions } from "@/hooks/use-running-actions";
import { formatActionName } from "@/lib/action-icons";
import type { OutputRun, ProjectMeta, RunningAction } from "@/types";

type ProjectViewMode = "list" | "small" | "large";
const VIEW_MODE_KEY = "tiles.workspace-home.viewMode";
const VIEW_MODES: { mode: ProjectViewMode; icon: typeof List; label: string }[] = [
  { mode: "list", icon: List, label: "List view" },
  { mode: "small", icon: Grid3X3, label: "Small cards" },
  { mode: "large", icon: LayoutGrid, label: "Large cards" },
];

function readStoredViewMode(): ProjectViewMode {
  try {
    const stored = localStorage.getItem(VIEW_MODE_KEY);
    if (stored === "list" || stored === "small" || stored === "large") return stored;
  } catch {
    // ignore — fall back to default
  }
  return "large";
}

interface WorkspaceHomePageProps {
  workspacePath?: string;
  onChangeWorkspace?: () => void;
  onSetWorkspace?: (path: string) => void;
  onOpenProject: (project: string, tab?: string) => void;
  onOpenProjectSettings?: (project: string) => void;
}

const EMPTY_META: ProjectMeta = {
  display_name: null,
  cover_image_rel: null,
  description: null,
  tags: [],
};

type WorkspaceCandidate = {
  name: string;
  path: string;
  projectCount: number;
  thumbnailDataUrl?: string | null;
};

type WorkspaceCoverCandidate = {
  relPath: string;
  name: string;
  source: string;
  thumbnailDataUrl?: string | null;
};

export function WorkspaceHomePage({
  workspacePath,
  onChangeWorkspace,
  onSetWorkspace,
  onOpenProject,
  onOpenProjectSettings,
}: WorkspaceHomePageProps) {
  const { projects, loading } = useProjects();
  const { outputs } = useOutputs();
  const { running } = useRunningActions();
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ProjectViewMode>(readStoredViewMode);
  const changeViewMode = (mode: ProjectViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      // persistence is best-effort; in-memory state still works
    }
  };
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false);
  const [workspaceSettingsOpen, setWorkspaceSettingsOpen] = useState(false);
  const [workspaceCandidates, setWorkspaceCandidates] = useState<WorkspaceCandidate[]>([]);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false);
  const [coverCandidates, setCoverCandidates] = useState<WorkspaceCoverCandidate[]>([]);
  const [currentCoverRel, setCurrentCoverRel] = useState<string | null>(null);
  const [workspaceCoverDraft, setWorkspaceCoverDraft] = useState("");
  const [workspacePickerScope, setWorkspacePickerScope] = useState<"all" | "library" | "outputs">("all");
  const [workspacePickerSearch, setWorkspacePickerSearch] = useState("");
  const [savingWorkspaceSettings, setSavingWorkspaceSettings] = useState(false);

  const projectNames = useMemo(() => projects.map((project) => project.name), [projects]);
  const { map: details } = useProjectDetailsMap(projectNames);
  const { map: metas } = useProjectMetasMap(projectNames);

  const outputsByProject = outputs.reduce<Record<string, OutputRun[]>>((acc, output) => {
    (acc[output.project] ||= []).push(output);
    return acc;
  }, {});

  const runningByProject = running.reduce<Record<string, RunningAction[]>>((acc, action) => {
    if (action.project) (acc[action.project] ||= []).push(action);
    return acc;
  }, {});

  const latestOutputByProject = useMemo(() => {
    const out: Record<string, OutputRun> = {};
    for (const project of projects) {
      const next = (outputsByProject[project.name] || []).reduce<OutputRun | null>(
        (latest, run) => (!latest || run.modified_epoch > latest.modified_epoch ? run : latest),
        null
      );
      if (next) out[project.name] = next;
    }
    return out;
  }, [projects, outputsByProject]);

  const workspaceName = workspacePath?.split(/[\\/]/).filter(Boolean).at(-1) || "Workspace";

  useEffect(() => {
    if (!workspaceDialogOpen) return;
    invoke<WorkspaceCandidate[]>("list_workspace_candidates")
      .then(setWorkspaceCandidates)
      .catch(() => setWorkspaceCandidates([]));
  }, [workspaceDialogOpen]);

  useEffect(() => {
    if (!workspaceSettingsOpen) return;
    setWorkspacePickerScope("all");
    setWorkspacePickerSearch("");
    invoke<{ coverImageRel?: string | null }>("get_workspace_meta")
      .then((meta) => {
        setCurrentCoverRel(meta.coverImageRel ?? null);
        setWorkspaceCoverDraft(meta.coverImageRel ?? "");
      })
      .catch(() => {
        setCurrentCoverRel(null);
        setWorkspaceCoverDraft("");
      });
    invoke<WorkspaceCoverCandidate[]>("list_workspace_cover_candidates")
      .then(setCoverCandidates)
      .catch(() => setCoverCandidates([]));
  }, [workspaceSettingsOpen]);

  async function switchWorkspace(path: string) {
    setSwitchingWorkspace(true);
    try {
      const nextPath = await invoke<string>("set_workspace", { path });
      onSetWorkspace?.(nextPath);
      setWorkspaceDialogOpen(false);
    } catch (error) {
      toast.error("Failed to switch workspace", { description: String(error) });
    } finally {
      setSwitchingWorkspace(false);
    }
  }

  async function saveWorkspaceSettings() {
    setSavingWorkspaceSettings(true);
    try {
      const coverImageRel = workspaceCoverDraft.trim() || null;
      await invoke("put_workspace_meta", { meta: { coverImageRel } });
      setCurrentCoverRel(coverImageRel);
      setWorkspaceSettingsOpen(false);
      toast.success("Workspace settings saved");
    } catch (error) {
      toast.error("Failed to save workspace settings", { description: String(error) });
    } finally {
      setSavingWorkspaceSettings(false);
    }
  }

  async function createWorkspace() {
    if (!newWorkspaceName.trim()) return;
    setSwitchingWorkspace(true);
    try {
      const nextPath = await invoke<string>("create_workspace", { name: newWorkspaceName });
      onSetWorkspace?.(nextPath);
      setNewWorkspaceName("");
      setWorkspaceDialogOpen(false);
    } catch (error) {
      toast.error("Failed to create workspace", { description: String(error) });
    } finally {
      setSwitchingWorkspace(false);
    }
  }

  const normalizedSearch = search.trim().toLowerCase();
  const filteredProjects = normalizedSearch
    ? projects.filter((project) => {
        const meta = metas[project.name] ?? EMPTY_META;
        const displayName = (meta.display_name || "").toLowerCase();
        const tags = (meta.tags || []).join(" ").toLowerCase();
        return (
          project.name.toLowerCase().includes(normalizedSearch) ||
          displayName.includes(normalizedSearch) ||
          tags.includes(normalizedSearch)
        );
      })
    : projects;

  const filteredWorkspaceCoverCandidates = coverCandidates
    .filter((candidate) =>
      workspacePickerScope === "all" ? true : candidate.source === workspacePickerScope
    )
    .filter((candidate) => {
      const query = workspacePickerSearch.trim().toLowerCase();
      if (!query) return true;
      return (
        candidate.name.toLowerCase().includes(query) ||
        candidate.relPath.toLowerCase().includes(query)
      );
    });

  function openProjectTab(event: MouseEvent, project: string, tab: string) {
    event.stopPropagation();
    onOpenProject(project, tab);
  }

  function openProjectSettings(event: MouseEvent, project: string) {
    event.stopPropagation();
    onOpenProjectSettings?.(project);
  }

  return (
    <div className="min-h-svh bg-background p-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="text-sm text-muted-foreground">tiles workspace</div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-semibold tracking-tight">{workspaceName}</h1>
                <Button variant="outline" size="sm" onClick={() => setWorkspaceDialogOpen(true)}>
                  <FolderSync className="h-4 w-4" />
                  Switch
                </Button>
              </div>
              <div className="mt-1 truncate font-mono text-xs text-muted-foreground">{workspacePath}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setWorkspaceSettingsOpen(true)}>
                <Settings className="h-4 w-4" />
                Settings
              </Button>
              <CreateProjectDialog
                onProjectCreated={(project) => onOpenProject(project)}
                trigger={(
                  <Button>
                    <Plus className="h-4 w-4" />
                    New project
                  </Button>
                )}
              />
            </div>
          </div>
        </header>

        <section className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Projects</h2>
              <p className="text-sm text-muted-foreground">Choose a project to open its library and tools.</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative w-full sm:max-w-sm">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search projects..."
                  className="pl-9"
                />
              </div>
              <div className="inline-flex shrink-0 rounded-md border p-0.5">
                {VIEW_MODES.map(({ mode, icon: Icon, label }) => (
                  <Button
                    key={mode}
                    size="icon"
                    variant={viewMode === mode ? "secondary" : "ghost"}
                    className="h-7 w-7"
                    title={label}
                    aria-pressed={viewMode === mode}
                    onClick={() => changeViewMode(mode)}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {loading ? (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            Loading projects…
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 text-center">
            <h2 className="text-lg font-medium">No projects yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">Create a project to enter the project workspace.</p>
            <CreateProjectDialog
              onProjectCreated={(project) => onOpenProject(project)}
              trigger={<Button className="mt-4">Create project</Button>}
            />
          </div>
        ) : (
          filteredProjects.length === 0 ? (
            <div className="text-sm text-muted-foreground">No projects match your search.</div>
          ) : (
            <div
              className={
                viewMode === "list"
                  ? "flex flex-col divide-y overflow-hidden rounded-lg border"
                  : viewMode === "small"
                  ? "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6"
                  : "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
              }
            >
              {filteredProjects.map((project) => {
                const detail = details[project.name];
                const meta = metas[project.name] ?? EMPTY_META;
                const displayName = meta.display_name || project.name;
                const projectOutputs = outputsByProject[project.name] || [];
                const projectRunning = runningByProject[project.name] || [];
                const latestOutput = latestOutputByProject[project.name];
                const thumb = thumbnailForProject(meta, latestOutput);
                const runningLabel = projectRunning[0] ? formatActionName(projectRunning[0].action) : "";
                const videoLabel = detail ? `${detail.video_count} videos` : "…";
                const folderLabel = detail ? `${detail.subfolders.length} folders` : "…";
                const outputLabel = `${projectOutputs.length} output${projectOutputs.length === 1 ? "" : "s"}`;

                if (viewMode === "list") {
                  return (
                    <div
                      key={project.name}
                      className="flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-accent/50"
                      onClick={() => onOpenProject(project.name)}
                    >
                      <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded bg-muted/40">
                        {thumb ? (
                          <img src={thumb} alt={displayName} className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          <div className="flex h-full items-center justify-center">
                            <Film className="h-4 w-4 text-muted-foreground/40" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{displayName}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {videoLabel} · {folderLabel} · {outputLabel}
                          {latestOutput
                            ? ` · ${formatActionName(latestOutput.tool)} ${timeAgo(latestOutput.modified_epoch)}`
                            : ""}
                        </div>
                      </div>
                      {projectRunning.length > 0 && (
                        <span className="relative flex h-2 w-2 shrink-0" title={runningLabel}>
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                        </span>
                      )}
                      {onOpenProjectSettings && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 shrink-0"
                          onClick={(event) => openProjectSettings(event, project.name)}
                        >
                          <Settings2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  );
                }

                if (viewMode === "small") {
                  return (
                    <Card
                      key={project.name}
                      className="cursor-pointer overflow-hidden transition-colors hover:border-primary/50"
                      onClick={() => onOpenProject(project.name)}
                    >
                      <div className="relative aspect-square w-full bg-muted/40">
                        {thumb ? (
                          <img src={thumb} alt={displayName} className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          <div className="flex h-full items-center justify-center bg-muted/60">
                            <Film className="h-6 w-6 text-muted-foreground/40" />
                          </div>
                        )}
                        {projectRunning.length > 0 && (
                          <span className="absolute right-1.5 top-1.5 flex h-2 w-2" title={runningLabel}>
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                          </span>
                        )}
                      </div>
                      <div className="p-2">
                        <div className="truncate text-sm font-medium">{displayName}</div>
                        <div className="truncate text-[10px] text-muted-foreground">
                          {videoLabel} · {folderLabel}
                        </div>
                      </div>
                    </Card>
                  );
                }

                return (
                  <Card
                    key={project.name}
                    className="cursor-pointer overflow-hidden transition-colors hover:border-primary/50"
                    onClick={() => onOpenProject(project.name)}
                  >
                    <div className="relative aspect-square w-full bg-muted/40">
                      {thumb ? (
                        <img
                          src={thumb}
                          alt={displayName}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center bg-muted/60">
                          <Film className="h-8 w-8 text-muted-foreground/40" />
                        </div>
                      )}
                    </div>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="truncate">{displayName}</CardTitle>
                        {onOpenProjectSettings && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={(event) => openProjectSettings(event, project.name)}
                          >
                            <Settings2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                      {meta.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {meta.tags.slice(0, 3).map((tag) => (
                            <Badge key={`${project.name}-${tag}`} variant="outline" className="text-[10px]">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </CardHeader>
                    <CardContent className="flex flex-col gap-2 pt-0">
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary">
                          <Film className="h-3 w-3" />
                          {detail ? `${detail.video_count} videos` : <Loader2 className="h-3 w-3 animate-spin" />}
                        </Badge>
                        <Badge variant="secondary">
                          <FolderOpen className="h-3 w-3" />
                          {detail ? `${detail.subfolders.length} folders` : <Loader2 className="h-3 w-3 animate-spin" />}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <FolderOutput className="h-3 w-3" />
                        {projectOutputs.length > 0
                          ? `${projectOutputs.length} output${projectOutputs.length === 1 ? "" : "s"}`
                          : "No outputs yet"}
                      </div>
                      {latestOutput && (
                        <div className="text-[11px] text-muted-foreground">
                          Last: {formatActionName(latestOutput.tool)} · {timeAgo(latestOutput.modified_epoch)} · {latestOutput.video_count} file
                          {latestOutput.video_count === 1 ? "" : "s"}
                        </div>
                      )}
                      {projectRunning.length > 0 && (
                        <div className="flex items-center gap-2 text-xs">
                          <span className="relative flex h-2 w-2">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                          </span>
                          <span className="text-green-600 dark:text-green-400">
                            {projectRunning.length > 1
                              ? `${runningLabel} +${projectRunning.length - 1} more`
                              : runningLabel}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center gap-1 pt-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title="Tile Builder"
                          onClick={(event) => openProjectTab(event, project.name, "tile-builder")}
                        >
                          <Grid3X3 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title="Import"
                          onClick={(event) => openProjectTab(event, project.name, "import")}
                        >
                          <Import className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title="Outputs"
                          onClick={(event) => openProjectTab(event, project.name, "outputs")}
                        >
                          <FolderOutput className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )
        )}
      </div>

      <Dialog open={workspaceSettingsOpen} onOpenChange={setWorkspaceSettingsOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Workspace Settings</DialogTitle>
            <DialogDescription>
              Customize workspace metadata for {workspaceName}.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <div>
                <div className="text-xs font-medium mb-1">Workspace folder</div>
                <Input value={workspacePath || ""} readOnly />
              </div>
              <div>
                <div className="text-xs font-medium mb-1">Cover image path</div>
                <Input
                  value={workspaceCoverDraft}
                  onChange={(event) => setWorkspaceCoverDraft(event.target.value)}
                  placeholder="src/project/... or outputs/..."
                />
                <div className="text-[11px] text-muted-foreground mt-1">
                  Path must be inside this workspace. Leave blank to use the automatic thumbnail.
                </div>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
                Current: {currentCoverRel || "automatic thumbnail"}
              </div>
            </div>

            <div>
              <div className="text-xs font-medium mb-2">Cover candidates</div>
              <div className="mb-2 flex items-center gap-2">
                <Button
                  size="sm"
                  variant={workspacePickerScope === "all" ? "default" : "outline"}
                  onClick={() => setWorkspacePickerScope("all")}
                >
                  All
                </Button>
                <Button
                  size="sm"
                  variant={workspacePickerScope === "library" ? "default" : "outline"}
                  onClick={() => setWorkspacePickerScope("library")}
                >
                  Library
                </Button>
                <Button
                  size="sm"
                  variant={workspacePickerScope === "outputs" ? "default" : "outline"}
                  onClick={() => setWorkspacePickerScope("outputs")}
                >
                  Outputs
                </Button>
              </div>
              <Input
                value={workspacePickerSearch}
                onChange={(event) => setWorkspacePickerSearch(event.target.value)}
                placeholder="Search existing media..."
                className="mb-2"
              />
              <div className="grid grid-cols-3 gap-2 max-h-64 overflow-auto pr-1">
                {filteredWorkspaceCoverCandidates.map((candidate) => (
                  <button
                    key={candidate.relPath}
                    className={`rounded border overflow-hidden text-left ${
                      workspaceCoverDraft === candidate.relPath
                        ? "border-primary"
                        : "hover:border-primary/50"
                    }`}
                    onClick={() => setWorkspaceCoverDraft(candidate.relPath)}
                    type="button"
                  >
                    {candidate.thumbnailDataUrl ? (
                      <img
                        src={candidate.thumbnailDataUrl}
                        alt={candidate.name}
                        className="h-16 w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-16 w-full items-center justify-center bg-muted">
                        <Film className="h-4 w-4 text-muted-foreground/40" />
                      </div>
                    )}
                    <div className="p-1 text-[10px] truncate">{candidate.name}</div>
                    <div className="px-1 pb-1 text-[9px] text-muted-foreground uppercase">
                      {candidate.source}
                    </div>
                  </button>
                ))}
                {filteredWorkspaceCoverCandidates.length === 0 && (
                  <div className="col-span-3 text-xs text-muted-foreground">
                    No media found in this workspace.
                  </div>
                )}
              </div>
              <div className="mt-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setWorkspaceCoverDraft("")}
                >
                  Clear cover
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setWorkspaceSettingsOpen(false)} disabled={savingWorkspaceSettings}>
              Cancel
            </Button>
            <Button onClick={saveWorkspaceSettings} disabled={savingWorkspaceSettings}>
              {savingWorkspaceSettings ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={workspaceDialogOpen} onOpenChange={setWorkspaceDialogOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Switch workspace</DialogTitle>
            <DialogDescription>
              Choose a workspace folder or create a new one in Movies. A workspace contains src, outputs, and configs.
            </DialogDescription>
          </DialogHeader>

          <div className="grid max-h-[420px] grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
            {workspaceCandidates.map((workspace) => (
              <button
                key={workspace.path}
                className="overflow-hidden rounded-lg border bg-card text-left transition-colors hover:border-primary/60 disabled:opacity-60"
                disabled={switchingWorkspace || workspace.path === workspacePath}
                onClick={() => switchWorkspace(workspace.path)}
                type="button"
              >
                <div className="aspect-video bg-muted/50">
                  {workspace.thumbnailDataUrl ? (
                    <img
                      src={workspace.thumbnailDataUrl}
                      alt={workspace.name}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <FolderSync className="h-8 w-8 text-muted-foreground/40" />
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <div className="font-medium">{workspace.name}</div>
                  <div className="mt-1 truncate font-mono text-xs text-muted-foreground">{workspace.path}</div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {workspace.projectCount} project{workspace.projectCount === 1 ? "" : "s"}
                    {workspace.path === workspacePath ? " · current" : ""}
                  </div>
                </div>
              </button>
            ))}
            {workspaceCandidates.length === 0 && (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground sm:col-span-2">
                No workspace folders found in Movies or Documents.
              </div>
            )}
          </div>

          <div className="rounded-lg border bg-muted/20 p-3">
            <LabelLike>Create new workspace</LabelLike>
            <div className="mt-2 flex gap-2">
              <Input
                value={newWorkspaceName}
                onChange={(event) => setNewWorkspaceName(event.target.value)}
                placeholder="workspace-name"
              />
              <Button onClick={createWorkspace} disabled={switchingWorkspace || !newWorkspaceName.trim()}>
                Create
              </Button>
            </div>
          </div>

          <DialogFooter>
            {onChangeWorkspace && (
              <Button variant="ghost" onClick={onChangeWorkspace}>
                Browse with Finder…
              </Button>
            )}
            <Button variant="outline" onClick={() => setWorkspaceDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LabelLike({ children }: { children: string }) {
  return <div className="text-sm font-medium">{children}</div>;
}

function thumbnailForProject(meta: ProjectMeta, latestOutput?: OutputRun): string | null {
  if (meta.cover_image_rel) {
    return isImagePath(meta.cover_image_rel)
      ? mediaPreviewUrl(meta.cover_image_rel)
      : mediaThumbUrl(meta.cover_image_rel);
  }
  if (!latestOutput?.run_rel) return null;
  return mediaThumbUrl(latestOutput.run_rel);
}

function isImagePath(path: string) {
  return /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(path);
}

function isOutputRel(path: string) {
  return path.startsWith("src/") || path.startsWith("outputs/");
}

function mediaThumbUrl(relPath: string) {
  return isOutputRel(relPath) ? outThumbUrl(relPath) : thumbUrl(relPath);
}

function mediaPreviewUrl(relPath: string) {
  return isOutputRel(relPath) ? outVideoUrl(relPath) : videoUrl(relPath);
}

function timeAgo(epochSeconds: number) {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - epochSeconds);
  if (diff < 60) return "just now";
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
