import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { outVideoUrl, bumpMediaCache } from "@/api/client";
import { useActionRunner } from "@/hooks/use-action-runner";
import { useOutputTree } from "@/hooks/use-output-tree";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Loader2, RefreshCw, FolderOpen, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

export function ImportPage({ project }: { project?: string }) {
  const runnerScope = project ?? "__import-none__";
  const { running, runAction } = useActionRunner(runnerScope);
  const [ytUrl, setYtUrl] = useState("");
  const [ytForceTwoPanel, setYtForceTwoPanel] = useState(true);
  const [ytQuality, setYtQuality] = useState("medium");
  const [ytClipSeconds, setYtClipSeconds] = useState("");
  const [ytUseCookies, setYtUseCookies] = useState(true);
  const [ytBrowserChoice, setYtBrowserChoice] = useState("chrome");
  const [ytFastPreview, setYtFastPreview] = useState(true);
  const [selectedImport, setSelectedImport] = useState<string | null>(null);
  const [transcriptText, setTranscriptText] = useState<string>("");
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);

  const [localFiles, setLocalFiles] = useState<string[]>([]);
  const [localImporting, setLocalImporting] = useState(false);

  const ytProject = project || null;
  const ytImportRoot = ytProject
    ? `src/${ytProject}/outputs/yt-import`
    : "outputs/__none__";
  const {
    entries: ytImports,
    loading: ytImportsLoading,
    refresh: refreshYtImports,
  } = useOutputTree(ytImportRoot);
  const {
    entries: ytImportFiles,
    loading: ytImportFilesLoading,
  } = useOutputTree(selectedImport || "outputs/__none__");

  const importRuns = useMemo(
    () => ytImports.filter((entry) => entry.is_dir),
    [ytImports]
  );
  const selectedImportRun = useMemo(() => {
    if (selectedImport) {
      return (
        importRuns.find((run) => run.rel_path === selectedImport) ||
        importRuns[0] ||
        null
      );
    }
    return importRuns[0] || null;
  }, [importRuns, selectedImport]);
  const transcriptCandidates = useMemo(
    () =>
      ytImportFiles.filter(
        (file) =>
          !file.is_dir &&
          (file.name.endsWith(".json3") ||
            file.name.endsWith(".vtt") ||
            file.name.endsWith(".srt"))
      ),
    [ytImportFiles]
  );
  const transcriptFile = transcriptCandidates[0] || null;

  useEffect(() => {
    if (!selectedImportRun) {
      setTranscriptText("");
      setTranscriptError(null);
      return;
    }
    setSelectedImport(selectedImportRun.rel_path);
  }, [selectedImportRun]);

  useEffect(() => {
    if (!transcriptFile) {
      setTranscriptText("");
      setTranscriptError(null);
      return;
    }
    setTranscriptLoading(true);
    setTranscriptError(null);
    fetch(outFilePath(transcriptFile.rel_path)).then((r) => {
      if (!r.ok) throw new Error(`Failed to load transcript: ${r.status}`);
      return r.text();
    })
      .then((raw) => {
        if (transcriptFile.name.endsWith(".json3")) {
          setTranscriptText(parseJson3Transcript(raw));
        } else {
          setTranscriptText(raw);
        }
      })
      .catch((err) => setTranscriptError(err.message || "Failed to load transcript"))
      .finally(() => setTranscriptLoading(false));
  }, [transcriptFile]);

  const pickLocalFiles = async () => {
    const picked = await open({
      multiple: true,
      filters: [{ name: "Videos", extensions: ["mp4", "mov", "mkv", "avi", "m4v", "webm", "wmv", "mts", "m2ts"] }],
    });
    if (picked) {
      setLocalFiles(Array.isArray(picked) ? picked : [picked]);
    }
  };

  const runLocalImport = async () => {
    if (!localFiles.length || !project) return;
    setLocalImporting(true);
    try {
      const result = await invoke<{ copied: number; skipped: number }>(
        "import_files_to_folder",
        { project, folder: "", files: localFiles }
      );
      toast.success(
        `Imported ${result.copied} file${result.copied !== 1 ? "s" : ""}`,
        { description: result.skipped > 0 ? `${result.skipped} skipped` : undefined }
      );
      setLocalFiles([]);
      bumpMediaCache();
    } catch (err) {
      toast.error("Import failed", { description: String(err) });
    } finally {
      setLocalImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border rounded-lg p-3 bg-muted/20 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Local Files</div>
            <div className="text-xs text-muted-foreground">
              {project ? `Copy files into ${project}` : "Select a project to import"}
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <Button
            size="sm"
            variant="outline"
            onClick={pickLocalFiles}
            disabled={!project}
            className="gap-2"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Choose files
          </Button>
          {localFiles.length > 0 && (
            <div className="space-y-1">
              {localFiles.map((f) => (
                <div key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="truncate flex-1">{f.split("/").pop()}</span>
                  <button
                    onClick={() => setLocalFiles((prev) => prev.filter((p) => p !== f))}
                    className="shrink-0 hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <Button
            size="sm"
            onClick={runLocalImport}
            disabled={!project || !localFiles.length || localImporting}
          >
            {localImporting ? "Importing..." : `Import ${localFiles.length || ""} file${localFiles.length !== 1 ? "s" : ""}`}
          </Button>
        </div>
      </div>

      <div className="border rounded-lg p-3 bg-muted/20 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">URL Import</div>
            <div className="text-xs text-muted-foreground">
              {ytProject
                ? `Project: ${ytProject}`
                : "Select a project to import"}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={refreshYtImports}
            disabled={!ytProject}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
        <div className="space-y-2">
          <Label className="text-xs">URL</Label>
          <div className="flex gap-2">
            <Input
              value={ytUrl}
              onChange={(e) => setYtUrl(e.target.value)}
              placeholder="https://..."
              disabled={!ytProject || running}
            />
            <Button
              onClick={async () => {
                const trimmed = ytUrl.trim();
                if (!trimmed) {
                  toast.error("Enter a URL");
                  return;
                }
                if (!ytProject) {
                  toast.error("Select a project");
                  return;
                }
                const res = await runAction({
                  action: "yt-import",
                  targets: [trimmed],
                  target_type: "url",
                  output_mode: "project",
                  params: {
                    output: `src/${ytProject}/outputs/yt-import`,
                    force_two_panel: ytForceTwoPanel,
                    quality: ytQuality,
                    clip_seconds: ytClipSeconds
                      ? parseFloat(ytClipSeconds)
                      : undefined,
                    cookies_from_browser: ytUseCookies ? ytBrowserChoice : undefined,
                    fast_preview: ytFastPreview,
                  },
                });
                if (res) {
                  if (res.exit_code === 0) {
                    toast.success("Import complete", {
                      description: `${ytProject} · ${selectedImportRun?.rel_path ?? "yt-import"}`,
                    });
                    setYtUrl("");
                    refreshYtImports();
                  } else {
                    toast.error("Import failed", {
                      description: `${ytProject ?? "No project"} · ${res.output.slice(0, 180)}`,
                    });
                  }
                }
              }}
              disabled={!ytProject || running}
            >
              {running ? "Running..." : "Import"}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={ytForceTwoPanel}
              onCheckedChange={setYtForceTwoPanel}
              disabled={!ytProject}
            />
            <Label className="text-xs">Force two-panel split (left/right)</Label>
          </div>
          <div>
            <Label className="text-xs">Quality</Label>
            <Select value={ytQuality} onValueChange={setYtQuality}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low (fastest / smallest)</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="ultra">Ultra</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Clip seconds (for fast tests)</Label>
            <Input
              type="number"
              min={1}
              step="1"
              value={ytClipSeconds}
              onChange={(e) => setYtClipSeconds(e.target.value)}
              placeholder="Full length"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={ytUseCookies}
              onCheckedChange={setYtUseCookies}
              disabled={!ytProject}
            />
            <Label className="text-xs">Use browser cookies</Label>
          </div>
          {ytUseCookies && (
            <div>
              <Label className="text-xs">Browser</Label>
              <Select value={ytBrowserChoice} onValueChange={setYtBrowserChoice}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="chrome">Chrome</SelectItem>
                  <SelectItem value="brave">Brave</SelectItem>
                  <SelectItem value="edge">Edge</SelectItem>
                  <SelectItem value="firefox">Firefox</SelectItem>
                  <SelectItem value="safari">Safari</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Switch
              checked={ytFastPreview}
              onCheckedChange={setYtFastPreview}
              disabled={!ytProject}
            />
            <Label className="text-xs">Fast preview (downscale + low fps)</Label>
          </div>
        </div>
      </div>

      <div className="border rounded-lg p-3 bg-muted/20 space-y-3">
        <div className="space-y-2">
          <Label className="text-xs">Imports</Label>
          {ytImportsLoading && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading imports...
            </div>
          )}
          {!ytImportsLoading && importRuns.length === 0 && (
            <div className="text-xs text-muted-foreground">No imports yet.</div>
          )}
          {importRuns.length > 0 && (
            <Select
              value={selectedImportRun?.rel_path || ""}
              onValueChange={setSelectedImport}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select import" />
              </SelectTrigger>
              <SelectContent>
                {importRuns.map((run) => (
                  <SelectItem key={run.rel_path} value={run.rel_path}>
                    {run.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Transcript</Label>
          {ytImportFilesLoading && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading transcript...
            </div>
          )}
          {transcriptError && (
            <div className="text-xs text-destructive">{transcriptError}</div>
          )}
          {!transcriptLoading && !transcriptError && transcriptFile && (
            <pre className="text-[11px] leading-4 bg-muted/40 border rounded p-2 max-h-64 overflow-auto whitespace-pre-wrap">
              {transcriptText || "Transcript is empty."}
            </pre>
          )}
          {!transcriptLoading && !transcriptError && !transcriptFile && (
            <div className="text-xs text-muted-foreground">
              No transcript file found yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function outFilePath(relPath: string) {
  return outVideoUrl(relPath);
}

function parseJson3Transcript(raw: string) {
  try {
    const parsed = JSON.parse(raw) as {
      events?: Array<{
        tStartMs?: number;
        dDurationMs?: number;
        segs?: Array<{ utf8?: string }>;
      }>;
    };
    if (!parsed.events) return raw;
    const lines: string[] = [];
    for (const event of parsed.events) {
      if (!event.segs) continue;
      const text = event.segs
        .map((seg) => (seg.utf8 || "").replace(/\n/g, " "))
        .join("")
        .trim();
      if (!text) continue;
      const ts = formatTimestamp(event.tStartMs ?? 0);
      lines.push(`[${ts}] ${text}`);
    }
    return lines.join("\n");
  } catch {
    return raw;
  }
}

function formatTimestamp(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(
      seconds
    ).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
