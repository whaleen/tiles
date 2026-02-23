import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { useProjects } from "@/hooks/use-projects";
import { useOutputs } from "@/hooks/use-outputs";
import { useRunningActions } from "@/hooks/use-running-actions";
import {
  apiGet,
  apiPost,
  apiPut,
  outThumbUrl,
  outVideoUrl,
  thumbUrl,
  videoUrl,
} from "@/api/client";
import type {
  ProjectDetail,
  ProjectMeta,
  OutputRun,
  RunningAction,
  VideoEntry,
} from "@/types";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Plus,
  Film,
  FolderOpen,
  FolderOutput,
  Search,
  Settings2,
} from "lucide-react";
import { toast } from "sonner";
import { formatActionName } from "@/lib/action-icons";

interface DashboardPageProps {
  onNavigate: (tab: string) => void;
  onProjectChange: (project?: string) => void;
}

type MetaDraft = {
  display_name: string;
  cover_image_rel: string;
  description: string;
  tags: string;
};

type CoverCandidate = {
  rel_path: string;
  name: string;
  source: "library" | "outputs";
};

const EMPTY_META: ProjectMeta = {
  display_name: null,
  cover_image_rel: null,
  description: null,
  tags: [],
};

export function DashboardPage({ onNavigate, onProjectChange }: DashboardPageProps) {
  const { projects, loading: projectsLoading, refresh } = useProjects();
  const { outputs } = useOutputs();
  const { running } = useRunningActions();
  const [details, setDetails] = useState<Record<string, ProjectDetail>>({});
  const [metas, setMetas] = useState<Record<string, ProjectMeta>>({});
  const [search, setSearch] = useState("");

  const [settingsProject, setSettingsProject] = useState<string | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [coverCandidates, setCoverCandidates] = useState<CoverCandidate[]>([]);
  const [pickerScope, setPickerScope] = useState<"all" | "library" | "outputs">("all");
  const [pickerSearch, setPickerSearch] = useState("");
  const [draft, setDraft] = useState<MetaDraft>({
    display_name: "",
    cover_image_rel: "",
    description: "",
    tags: "",
  });

  useEffect(() => {
    if (projects.length === 0) return;
    Promise.all(
      projects.map((p) =>
        apiGet<ProjectDetail>(`/api/projects/${encodeURIComponent(p.name)}`)
          .then((d) => [p.name, d] as const)
          .catch(() => null)
      )
    ).then((results) => {
      const map: Record<string, ProjectDetail> = {};
      for (const r of results) {
        if (r) map[r[0]] = r[1];
      }
      setDetails(map);
    });
  }, [projects]);

  useEffect(() => {
    if (projects.length === 0) {
      setMetas({});
      return;
    }
    Promise.all(
      projects.map((p) =>
        apiGet<ProjectMeta>(`/api/projects/${encodeURIComponent(p.name)}/meta`)
          .then((meta) => [p.name, normalizeMeta(meta)] as const)
          .catch(() => [p.name, EMPTY_META] as const)
      )
    ).then((results) => {
      setMetas(Object.fromEntries(results));
    });
  }, [projects]);

  const outputsByProject = outputs.reduce<Record<string, OutputRun[]>>((acc, o) => {
    (acc[o.project] ||= []).push(o);
    return acc;
  }, {});

  const runningByProject = running.reduce<Record<string, RunningAction[]>>((acc, r) => {
    if (r.project) (acc[r.project] ||= []).push(r);
    return acc;
  }, {});

  const normalizedSearch = search.trim().toLowerCase();
  const filteredProjects = normalizedSearch
    ? projects.filter((p) => {
        const meta = metas[p.name] ?? EMPTY_META;
        const displayName = (meta.display_name || "").toLowerCase();
        const tags = (meta.tags || []).join(" ").toLowerCase();
        return (
          p.name.toLowerCase().includes(normalizedSearch) ||
          displayName.includes(normalizedSearch) ||
          tags.includes(normalizedSearch)
        );
      })
    : projects;

  const latestOutputByProject = useMemo(() => {
    const out: Record<string, OutputRun> = {};
    for (const p of projects) {
      const next = (outputsByProject[p.name] || []).reduce<OutputRun | null>(
        (latest, run) => {
          if (!latest || run.modified_epoch > latest.modified_epoch) return run;
          return latest;
        },
        null
      );
      if (next) out[p.name] = next;
    }
    return out;
  }, [projects, outputsByProject]);

  function handleCardClick(name: string) {
    onProjectChange(name);
    onNavigate("library");
  }

  function handleOpenProjectTab(event: MouseEvent, name: string, tab: string) {
    event.stopPropagation();
    onProjectChange(name);
    onNavigate(tab);
  }

  async function handleOpenSettings(event: MouseEvent, name: string) {
    event.stopPropagation();
    const meta = normalizeMeta(metas[name] ?? EMPTY_META);
    setSettingsProject(name);
    setDraft({
      display_name: meta.display_name || "",
      cover_image_rel: meta.cover_image_rel || "",
      description: meta.description || "",
      tags: meta.tags.join(", "),
    });
    setPickerScope("all");
    setPickerSearch("");
    try {
      const [libraryList, outputList] = await Promise.all([
        apiGet<VideoEntry[]>(`/api/videos?project=${encodeURIComponent(name)}`),
        apiGet<OutputRun[]>(`/api/outputs?project=${encodeURIComponent(name)}`),
      ]);
      const outputCandidates = outputList
        .map((run) => run.run_rel)
        .filter((rel) => !!rel && !rel.endsWith("/"))
        .slice(0, 120)
        .map((rel) => ({
          rel_path: rel,
          name: rel.split("/").pop() || rel,
          source: "outputs" as const,
        }));
      const libraryCandidates = libraryList.slice(0, 160).map((entry) => ({
        rel_path: entry.rel_path,
        name: entry.name,
        source: "library" as const,
      }));
      setCoverCandidates([...libraryCandidates, ...outputCandidates]);
    } catch {
      setCoverCandidates([]);
    }
  }

  function handleCloseSettings() {
    if (settingsSaving) return;
    setSettingsProject(null);
    setCoverCandidates([]);
    setPickerSearch("");
  }

  async function handleSaveSettings() {
    if (!settingsProject) return;
    const coverImageRel = draft.cover_image_rel.trim();
    if (coverImageRel && !coverImageRel.startsWith(`${settingsProject}/`)) {
      toast.error("Cover image path must start with the project folder");
      return;
    }

    const payload: ProjectMeta = {
      display_name: draft.display_name.trim() || null,
      cover_image_rel: coverImageRel || null,
      description: draft.description.trim() || null,
      tags: draft.tags
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    };

    setSettingsSaving(true);
    try {
      await apiPut(`/api/projects/${encodeURIComponent(settingsProject)}/meta`, payload);
      const normalized = normalizeMeta(payload);
      setMetas((prev) => ({ ...prev, [settingsProject]: normalized }));
      toast.success("Project settings saved", {
        description: normalized.display_name || settingsProject,
      });
      setSettingsProject(null);
      setCoverCandidates([]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save settings";
      toast.error(message);
    } finally {
      setSettingsSaving(false);
    }
  }

  async function handleCreate() {
    const name = window.prompt("New project name");
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const res = await apiPost<{ name: string }>("/api/projects", { name: trimmed });
      await refresh();
      onProjectChange(res.name);
      onNavigate("library");
      toast.success("Project created", { description: res.name });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create project";
      toast.error(message);
    }
  }

  if (projectsLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Loading projects…
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-muted-foreground">No projects yet</p>
        <Button onClick={handleCreate}>
          <Plus className="h-4 w-4 mr-2" />
          Add project
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Projects</h1>
          <Button variant="outline" size="sm" onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-1" />
            Add project
          </Button>
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects..."
            className="pl-9"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredProjects.map((p) => {
            const detail = details[p.name];
            const meta = metas[p.name] ?? EMPTY_META;
            const displayName = meta.display_name || p.name;
            const projectOutputs = outputsByProject[p.name] || [];
            const projectRunning = runningByProject[p.name] || [];
            const latestOutput = latestOutputByProject[p.name];
            const thumb = thumbnailForProject(meta, latestOutput);
            const runningLabel = projectRunning[0]
              ? formatActionName(projectRunning[0].action)
              : "";

            return (
              <Card
                key={p.name}
                className="cursor-pointer overflow-hidden transition-colors hover:border-primary/50"
                onClick={() => handleCardClick(p.name)}
              >
                <div className="relative h-32 w-full bg-muted/40">
                  {thumb ? (
                    <img
                      src={thumb}
                      alt={displayName}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                      No thumbnail
                    </div>
                  )}
                </div>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="truncate">{displayName}</CardTitle>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={(event) => handleOpenSettings(event, p.name)}
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {meta.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {meta.tags.slice(0, 3).map((tag) => (
                        <Badge key={`${p.name}-${tag}`} variant="outline" className="text-[10px]">
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
                      {detail ? `${detail.video_count} videos` : "…"}
                    </Badge>
                    <Badge variant="secondary">
                      <FolderOpen className="h-3 w-3" />
                      {detail ? `${detail.subfolders.length} folders` : "…"}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
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
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                      </span>
                      <span className="text-green-600 dark:text-green-400">
                        {projectRunning.length > 1
                          ? `${runningLabel} +${projectRunning.length - 1} more`
                          : runningLabel}
                      </span>
                    </div>
                  )}
                  {projectRunning.length > 0 && (
                    <div className="text-[11px] text-muted-foreground">
                      {projectRunning.length} running · oldest {timeAgo(
                        Math.min(...projectRunning.map((r) => r.started_epoch))
                      )}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(event) => handleOpenProjectTab(event, p.name, "library")}
                    >
                      Library
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(event) => handleOpenProjectTab(event, p.name, "tile-builder")}
                    >
                      Tile Builder
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(event) => handleOpenProjectTab(event, p.name, "import")}
                    >
                      Import
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(event) => handleOpenProjectTab(event, p.name, "outputs")}
                    >
                      Outputs
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {filteredProjects.length === 0 && (
          <div className="text-sm text-muted-foreground">No projects match your search.</div>
        )}
      </div>

      <Dialog open={!!settingsProject} onOpenChange={(open) => !open && handleCloseSettings()}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Project Settings</DialogTitle>
            <DialogDescription>
              Customize dashboard metadata for {settingsProject || "project"}.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <div>
                <div className="text-xs font-medium mb-1">Display name</div>
                <Input
                  value={draft.display_name}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, display_name: e.target.value }))
                  }
                  placeholder="Optional UI name"
                />
              </div>
              <div>
                <div className="text-xs font-medium mb-1">Description</div>
                <textarea
                  value={draft.description}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, description: e.target.value }))
                  }
                  className="w-full min-h-20 rounded-md border bg-background px-3 py-2 text-sm"
                  placeholder="Optional short description"
                />
              </div>
              <div>
                <div className="text-xs font-medium mb-1">Tags</div>
                <Input
                  value={draft.tags}
                  onChange={(e) => setDraft((prev) => ({ ...prev, tags: e.target.value }))}
                  placeholder="ugc, promo, highlights"
                />
              </div>
              <div>
                <div className="text-xs font-medium mb-1">Cover image/video path</div>
                <Input
                  value={draft.cover_image_rel}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, cover_image_rel: e.target.value }))
                  }
                  placeholder={settingsProject ? `${settingsProject}/...` : "project/..."}
                />
                <div className="text-[11px] text-muted-foreground mt-1">
                  Path must start with the project folder name.
                </div>
              </div>
            </div>

            <div>
              <div className="text-xs font-medium mb-2">Cover candidates</div>
              <div className="mb-2 flex items-center gap-2">
                <Button
                  size="sm"
                  variant={pickerScope === "all" ? "default" : "outline"}
                  onClick={() => setPickerScope("all")}
                >
                  All
                </Button>
                <Button
                  size="sm"
                  variant={pickerScope === "library" ? "default" : "outline"}
                  onClick={() => setPickerScope("library")}
                >
                  Library
                </Button>
                <Button
                  size="sm"
                  variant={pickerScope === "outputs" ? "default" : "outline"}
                  onClick={() => setPickerScope("outputs")}
                >
                  Outputs
                </Button>
              </div>
              <Input
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                placeholder="Search existing media..."
                className="mb-2"
              />
              <div className="grid grid-cols-3 gap-2 max-h-64 overflow-auto pr-1">
                {coverCandidates
                  .filter((entry) =>
                    pickerScope === "all" ? true : entry.source === pickerScope
                  )
                  .filter((entry) => {
                    const q = pickerSearch.trim().toLowerCase();
                    if (!q) return true;
                    return (
                      entry.name.toLowerCase().includes(q) ||
                      entry.rel_path.toLowerCase().includes(q)
                    );
                  })
                  .map((entry) => {
                  const src = isImagePath(entry.rel_path)
                    ? mediaPreviewUrl(entry.rel_path)
                    : mediaThumbUrl(entry.rel_path);
                  return (
                    <button
                      key={entry.rel_path}
                      className={`rounded border overflow-hidden text-left ${
                        draft.cover_image_rel === entry.rel_path
                          ? "border-primary"
                          : "hover:border-primary/50"
                      }`}
                      onClick={() =>
                        setDraft((prev) => ({ ...prev, cover_image_rel: entry.rel_path }))
                      }
                    >
                      <img
                        src={src}
                        alt={entry.name}
                        className="h-16 w-full object-cover"
                        loading="lazy"
                      />
                      <div className="p-1 text-[10px] truncate">{entry.name}</div>
                      <div className="px-1 pb-1 text-[9px] text-muted-foreground uppercase">
                        {entry.source}
                      </div>
                    </button>
                  );
                })}
                {coverCandidates.length === 0 && (
                  <div className="col-span-3 text-xs text-muted-foreground">
                    No media found in this project.
                  </div>
                )}
              </div>
              <div className="mt-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDraft((prev) => ({ ...prev, cover_image_rel: "" }))}
                >
                  Clear cover
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseSettings} disabled={settingsSaving}>
              Cancel
            </Button>
            <Button onClick={handleSaveSettings} disabled={settingsSaving}>
              {settingsSaving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function normalizeMeta(meta: ProjectMeta | null | undefined): ProjectMeta {
  return {
    display_name: meta?.display_name || null,
    cover_image_rel: meta?.cover_image_rel || null,
    description: meta?.description || null,
    tags: meta?.tags || [],
  };
}

function isImagePath(path: string) {
  return /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(path);
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
