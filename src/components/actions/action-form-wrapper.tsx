import { useContext, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldInfo } from "@/components/ui/field-info";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useProjects } from "@/hooks/use-projects";
import { useActionRunner } from "@/hooks/use-action-runner";
import { bumpMediaCache } from "@/api/client";
import { toast } from "sonner";
import type { ActionRunRequest } from "@/types";
import { ActionCompleteContext } from "@/contexts/action-complete-context";
import { FolderOutput, Loader2 } from "lucide-react";

interface ActionFormWrapperProps {
  actionName: string;
  targetType: "folders" | "folders_or_videos" | "settings";
  children: (props: { targets: string[] }) => React.ReactNode;
  buildRequest: (targets: string[], outputMode: string) => ActionRunRequest;
  targetsOverride?: string[];
  targetsSummary?: string;
  allowOverwrite?: boolean;
  allowOutput?: boolean;
  allowAlongside?: boolean;
  fixedOutputMode?: string;
  onRunComplete?: () => void;
}

export function ActionFormWrapper({
  actionName,
  targetType,
  children,
  buildRequest,
  targetsOverride,
  targetsSummary,
  allowOverwrite = true,
  allowOutput = true,
  allowAlongside = true,
  fixedOutputMode,
  onRunComplete,
}: ActionFormWrapperProps) {
  const { projects } = useProjects();
  const runnerScope = useMemo(
    () => `${actionName}:${targetsSummary ?? ""}:${targetType}`,
    [actionName, targetType, targetsSummary]
  );
  const { running, result, runAction } = useActionRunner(runnerScope);
  const onActionComplete = useContext(ActionCompleteContext);
  const [selectedFolders, setSelectedFolders] = useState<string[]>([]);
  const [outputMode, setOutputMode] = useState(
    fixedOutputMode ?? (targetType === "settings" ? "global" : "source")
  );
  const [outputPath, setOutputPath] = useState("");
  const [outputName, setOutputName] = useState("");
  const [outputNameTouched, setOutputNameTouched] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (fixedOutputMode && outputMode !== fixedOutputMode) {
      setOutputMode(fixedOutputMode);
    }
  }, [fixedOutputMode, outputMode]);

  useEffect(() => {
    if (fixedOutputMode) return;
    if (!allowOverwrite && outputMode === "overwrite") {
      setOutputMode(targetType === "settings" ? "global" : "source");
    }
  }, [allowOverwrite, fixedOutputMode, outputMode, targetType]);

  useEffect(() => {
    if (fixedOutputMode) return;
    if (!allowOutput && outputMode !== "global") {
      setOutputMode("global");
    }
  }, [allowOutput, fixedOutputMode, outputMode]);

  const hasOverride = Array.isArray(targetsOverride);
  const targets = useMemo(
    () =>
      hasOverride
        ? targetsOverride || []
        : targetType === "settings"
          ? []
          : selectedFolders,
    [hasOverride, selectedFolders, targetType, targetsOverride]
  );

  const suggestedOutputName = useMemo(
    () => suggestOutputName(actionName, targets, targetType),
    [actionName, targets, targetType]
  );

  useEffect(() => {
    if (!outputNameTouched || !outputName.trim()) {
      setOutputName(suggestedOutputName);
    }
  }, [outputNameTouched, outputName, suggestedOutputName]);

  useEffect(() => {
    if (!running) {
      setRunStartedAt(null);
      return;
    }
    const started = Date.now();
    setRunStartedAt(started);
    setNow(started);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const effectiveOutputPath = useMemo(() => {
    const name = outputName.trim();
    if (!name || !allowOutput || fixedOutputMode) return "";
    if (outputMode === "custom") return outputPath.trim();
    if (outputMode === "global") return `outputs/${actionName}/${name}`;
    if (outputMode === "source" || outputMode === "project") {
      const projectName = projectFromTargets(targets);
      return projectName ? `src/${projectName}/outputs/${actionName}/${name}` : "";
    }
    return "";
  }, [actionName, allowOutput, fixedOutputMode, outputMode, outputName, outputPath, targets]);

  const handleConfirmOpen = () => {
    if (targetType !== "settings" && targets.length === 0) {
      toast.error("Select at least one target");
      return;
    }
    if (allowOutput && !fixedOutputMode && outputMode === "custom" && !outputPath.trim()) {
      toast.error("Enter a custom output path");
      return;
    }
    if (
      allowOutput &&
      !fixedOutputMode &&
      ["source", "project", "global"].includes(outputMode) &&
      !outputName.trim()
    ) {
      toast.error("Enter an output name");
      return;
    }
    if (
      allowOutput &&
      !fixedOutputMode &&
      ["source", "project"].includes(outputMode) &&
      !projectFromTargets(targets)
    ) {
      toast.error("Project outputs require targets from one project. Choose a custom or global output for mixed targets.");
      return;
    }
    setConfirmOpen(true);
  };

  const handleRun = async () => {
    setConfirmOpen(false);
    const effectiveOutputMode = fixedOutputMode ?? outputMode;
    const req = buildRequest(targets, effectiveOutputMode);
    if (!fixedOutputMode && allowOutput && effectiveOutputPath) {
      req.params = {
        ...(req.params ?? {}),
        output: effectiveOutputPath,
      };
    }
      const res = await runAction(req);
      try {
        if (res) {
          if (res.exit_code === 0) {
          toast.success(`${actionName} completed`, {
            description: `${targetLabel} · ${outputLabel}`,
          });
          if ((fixedOutputMode ?? outputMode) === "overwrite" && onActionComplete) {
            onActionComplete();
          } else {
            bumpMediaCache();
          }
        } else {
          toast.error(`${actionName} failed`, {
            description: `${res.output.slice(0, 180)}${res.log_file ? ` · log: ${res.log_file}` : ""}`,
          });
        }
      }
    } finally {
      onRunComplete?.();
    }
  };

  const targetLabel = useMemo(() => {
    if (targetsSummary) return targetsSummary;
    if (targetType === "settings") return "Saved settings";
    if (targets.length === 0) return "No targets selected";
    const noun = targetType === "folders" ? "folder" : "target";
    return `${targets.length} ${noun}${targets.length === 1 ? "" : "s"}`;
  }, [targetType, targets.length, targetsSummary]);

  const outputLabel = useMemo(() => {
    if (fixedOutputMode === "alongside") return "Save transcript next to source video";
    if (!allowOutput) return "Not applicable";
    if (outputMode === "overwrite") return "Overwrite originals";
    if (outputMode === "alongside") return "Save alongside originals";
    if (["source", "project", "global", "custom"].includes(outputMode)) {
      return effectiveOutputPath ||
        (outputMode === "custom" ? "Custom path" : "Choose targets to build output path");
    }
    return outputMode;
  }, [allowOutput, effectiveOutputPath, fixedOutputMode, outputMode]);

  const toggleFolder = (name: string) => {
    setSelectedFolders((prev) =>
      prev.includes(name) ? prev.filter((f) => f !== name) : [...prev, name]
    );
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <h3 className="text-lg font-semibold capitalize">{actionName}</h3>

      <>
        {targetsSummary && (
          <div className="text-xs text-muted-foreground">
            {targetsSummary}
          </div>
        )}
        {targetType !== "settings" && !hasOverride && (
          <div>
            <FieldInfo label="Folders" info="Choose which project folders this action should process. When individual videos are selected in the Library, this folder picker is replaced by that selection." labelClassName="text-sm" />
            {projects.length === 0 ? (
              <div className="text-xs text-muted-foreground mt-1">
                No projects found. Scan a project folder to get started.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 mt-1">
                {projects.map((p) => (
                  <button
                    key={p.name}
                    onClick={() => toggleFolder(p.name)}
                    className={`px-2 py-1 text-xs rounded border ${
                      selectedFolders.includes(p.name)
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-accent"
                    }`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
            {targetType === "folders_or_videos" && (
              <p className="text-xs text-muted-foreground mt-2">
                To target individual videos instead of whole folders, select them
                in the Library tab.
              </p>
            )}
          </div>
        )}

        {allowOutput && !fixedOutputMode && (
          <div>
            <FieldInfo label="Output" info="Controls where generated files are written. Project outputs stay with the selected project; global outputs go to the workspace-level outputs folder; overwrite changes source files directly." labelClassName="text-sm" />
            <Select value={outputMode} onValueChange={setOutputMode}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {targetType !== "settings" && allowOverwrite && (
                  <SelectItem value="overwrite">Overwrite originals</SelectItem>
                )}
              {targetType !== "settings" && allowAlongside && (
                <SelectItem value="alongside">Save alongside originals</SelectItem>
              )}
                {targetType !== "settings" && (
                  <SelectItem value="source">Save to project outputs folder</SelectItem>
                )}
                <SelectItem value="global">Save to global outputs folder</SelectItem>
                <SelectItem value="custom">Custom path</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              {outputMode === "source" &&
                "Saves results to src/<project>/outputs/<action>."}
              {outputMode === "global" &&
                "Saves results to outputs/<action> at the project root."}
              {outputMode === "custom" && "Specify a path relative to the project root."}
              {outputMode === "overwrite" &&
                "Replaces the original files. This cannot be undone."}
            {outputMode === "alongside" &&
              "Saves results next to the source files with a numeric suffix."}
            </p>
          </div>
        )}

        {allowOutput && !fixedOutputMode && ["source", "project", "global"].includes(outputMode) && (
          <div>
            <div className="flex items-center justify-between gap-2">
              <FieldInfo label={outputNameKind(actionName)} info="Name used for the generated run, folder, or output file. The suggested name is safe to use, but you can customize it before running." labelClassName="text-sm" />
              {outputNameTouched && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={() => {
                    setOutputName(suggestedOutputName);
                    setOutputNameTouched(false);
                  }}
                >
                  Reset suggestion
                </Button>
              )}
            </div>
            <Input
              value={outputName}
              onChange={(e) => {
                setOutputName(e.target.value);
                setOutputNameTouched(true);
              }}
              placeholder={suggestedOutputName}
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1 truncate">
              {effectiveOutputPath || "Select targets to build the project output path."}
            </p>
          </div>
        )}

        {allowOutput && !fixedOutputMode && outputMode === "custom" && (
          <div>
            <FieldInfo label="Output Path" info="Custom output path relative to the workspace root. Use this when project/global output presets do not fit the job." labelClassName="text-sm" />
            <Input
              value={outputPath}
              onChange={(e) => setOutputPath(e.target.value)}
              placeholder="outputs/my-folder/output.mp4"
              className="mt-1"
            />
          </div>
        )}
      </>

      {children({ targets })}

      <div className="space-y-2">
        <Button onClick={handleConfirmOpen} disabled={running} className="w-full gap-2">
          {running ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Running {formatElapsed(runStartedAt ? now - runStartedAt : 0)}
            </>
          ) : (
            `Run ${actionName}`
          )}
        </Button>
        {running && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full gap-2"
            onClick={() => navigateToOutputs(projectFromTargets(targets))}
          >
            <FolderOutput className="h-4 w-4" />
            View active job in Outputs
          </Button>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm {actionName}</AlertDialogTitle>
            <AlertDialogDescription>
              Review the action details before running.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Targets</div>
              <div className="font-medium">{targetLabel}</div>
            </div>
            {allowOutput && !fixedOutputMode && (
              <div>
                <div className="text-xs text-muted-foreground">Output</div>
                <div className={outputMode === "overwrite" ? "font-medium text-destructive" : "font-medium"}>
                  {outputLabel}
                </div>
                {outputMode === "overwrite" && (
                  <div className="text-xs text-destructive mt-1">
                    This will replace the original files. This cannot be undone.
                  </div>
                )}
              </div>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={running}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleRun();
              }}
              className={outputMode === "overwrite" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
              disabled={running}
            >
              {running ? "Running..." : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {result && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">Output</div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(result.output || "");
              }}
            >
              Copy
            </Button>
          </div>
          <pre className="text-xs bg-muted p-3 rounded max-h-64 overflow-auto whitespace-pre-wrap">
            {result.output}
          </pre>
        </div>
      )}
    </div>
  );
}

function outputNameKind(actionName: string) {
  return singleFileOutputActions.has(actionName) ? "Output file" : "Output folder";
}

const singleFileOutputActions = new Set(["tile", "run", "yolo"]);

function suggestOutputName(actionName: string, targets: string[], targetType: string) {
  const stamp = new Date().toISOString().slice(0, 10);
  const base = targetType === "settings"
    ? "tile"
    : targets.length === 1
      ? lastPathSegment(targets[0])
      : targets.length > 1
        ? `${projectFromTargets(targets) ?? "mixed"}_${targets.length}_items`
        : "output";
  const safeBase = slugify(base || "output");
  const safeAction = slugify(actionName);
  const name = `${safeBase}_${safeAction}_${stamp}`;
  return singleFileOutputActions.has(actionName) ? `${name}.mp4` : name;
}

function projectFromTargets(targets: string[]) {
  let project: string | null = null;
  for (const target of targets) {
    const parts = target.replaceAll("\\", "/").split("/").filter(Boolean);
    const candidate = parts[0] === "src" ? parts[1] : parts[0];
    if (!candidate) continue;
    if (project && project !== candidate) return null;
    project = candidate;
  }
  return project;
}

function lastPathSegment(path: string) {
  const parts = path.replaceAll("\\", "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "output";
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "output";
}

function formatElapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function navigateToOutputs(project?: string | null) {
  window.dispatchEvent(
    new CustomEvent("tiles:navigate", {
      detail: { tab: "outputs", project: project ?? null },
    })
  );
}
