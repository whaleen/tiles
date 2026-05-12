import { useContext, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
    fixedOutputMode ?? (targetType === "settings" ? "global" : "overwrite")
  );
  const [outputPath, setOutputPath] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

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
  const targets = hasOverride
    ? targetsOverride || []
    : targetType === "settings"
      ? []
      : selectedFolders;

  const handleConfirmOpen = () => {
    if (targetType !== "settings" && targets.length === 0) {
      toast.error("Select at least one target");
      return;
    }
    if (allowOutput && !fixedOutputMode && outputMode === "custom" && !outputPath.trim()) {
      toast.error("Enter a custom output path");
      return;
    }
    setConfirmOpen(true);
  };

  const handleRun = async () => {
    setConfirmOpen(false);
    const effectiveOutputMode = fixedOutputMode ?? outputMode;
    const req = buildRequest(targets, effectiveOutputMode);
    if (!fixedOutputMode && outputMode === "custom") {
      req.params = {
        ...(req.params ?? {}),
        output: outputPath.trim(),
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
    if (outputMode === "source") return "Save to project outputs folder";
    if (outputMode === "global") return "Save to global outputs folder";
    if (outputMode === "custom") {
      return outputPath.trim()
        ? `Custom path: ${outputPath.trim()}`
        : "Custom path";
    }
    return outputMode;
  }, [allowOutput, fixedOutputMode, outputMode, outputPath]);

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
            <Label className="text-sm">Folders</Label>
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
            <Label className="text-sm">Output</Label>
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

        {allowOutput && !fixedOutputMode && outputMode === "custom" && (
          <div>
            <Label className="text-sm">Output Path</Label>
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

      <Button onClick={handleConfirmOpen} disabled={running} className="w-full">
        {running ? "Running..." : `Run ${actionName}`}
      </Button>

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
