import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { InfoHover } from "@/components/ui/info-hover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Play } from "lucide-react";
import type { TileSettings } from "@/types";

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: TileSettings;
  saveSettings: (settings: TileSettings, project?: string) => void;
  renderMode: string;
  onRenderModeChange: (mode: string) => void;
  outputMode: string;
  onOutputModeChange: (mode: string) => void;
  outputProject: string | null;
  audioEnabled: boolean;
  onAudioEnabledChange: (enabled: boolean) => void;
  running: boolean;
  onRun: () => void;
}

/** Export settings + the Generate action — surfaced only when exporting. */
export function ExportDialog({
  open,
  onOpenChange,
  settings,
  saveSettings,
  renderMode,
  onRenderModeChange,
  outputMode,
  onOutputModeChange,
  outputProject,
  audioEnabled,
  onAudioEnabledChange,
  running,
  onRun,
}: ExportDialogProps) {
  const destinationLabel =
    outputMode === "global"
      ? "workspace outputs/"
      : outputProject
        ? `${outputProject}/outputs/`
        : "this project's outputs/";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export composition</DialogTitle>
          <DialogDescription>
            Render the tiled composition to a video file.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div>
            <div className="flex items-center gap-1.5">
              <Label className="text-xs font-medium">Render quality</Label>
              <InfoHover text="Fast Preview is lowest quality and quickest; Standard Preview is balanced; High Quality Production is for final exports." />
            </div>
            <Select
              value={renderMode}
              onValueChange={(value) => {
                onRenderModeChange(value);
                saveSettings({ ...settings, render_mode: value });
              }}
            >
              <SelectTrigger className="mt-1 h-9">
                <SelectValue placeholder="Render quality" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="preview">Standard Preview</SelectItem>
                <SelectItem value="fast-preview">Fast Preview (Low Res)</SelectItem>
                <SelectItem value="full">High Quality Production</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5">
                <Label className="text-xs">Save to workspace outputs</Label>
                <InfoHover text="Save to the workspace-level outputs folder instead of this project's outputs folder." />
              </div>
              <p className="text-[10px] text-muted-foreground">
                Destination: {destinationLabel}
              </p>
            </div>
            <Switch
              checked={outputMode === "global"}
              onCheckedChange={(value) => {
                const nextMode = value ? "global" : "project";
                onOutputModeChange(nextMode);
                saveSettings({ ...settings, output_mode: nextMode });
              }}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5">
                <Label className="text-xs">Audio mix</Label>
                <InfoHover text="Include audio in the rendered composition. Per-tile audio choices are set from tile menus in the preview." />
              </div>
              <p className="text-[10px] text-muted-foreground">Enable sound in output</p>
            </div>
            <Switch checked={audioEnabled} onCheckedChange={onAudioEnabledChange} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={running}>
            Cancel
          </Button>
          <Button onClick={onRun} disabled={running} className="gap-2">
            {running ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Rendering…
              </>
            ) : (
              <>
                <Play className="h-4 w-4 fill-current" />
                Generate
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
