import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActionRunner } from "@/hooks/use-action-runner";
import { bumpMediaCache } from "@/api/client";
import { toast } from "sonner";
import type { ActionRunRequest } from "@/types";

interface YtImportFormProps {
  targetsSummary?: string;
  currentProject?: string;
  allowOutput?: boolean;
  onRunComplete?: () => void;
}

export function YtImportForm({
  targetsSummary,
  currentProject,
  allowOutput,
  onRunComplete,
}: YtImportFormProps) {
  const runnerScope = currentProject ?? "__yt-import-none__";
  const { running, runAction } = useActionRunner(runnerScope);
  const [url, setUrl] = useState("");
  const [forceTwoPanel, setForceTwoPanel] = useState(true);
  const [quality, setQuality] = useState("medium");
  const [clipSeconds, setClipSeconds] = useState("");
  const [useBrowserCookies, setUseBrowserCookies] = useState(true);
  const [browserChoice, setBrowserChoice] = useState("chrome");
  const [fastPreview, setFastPreview] = useState(true);

  const handleRun = async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      toast.error("Enter a URL");
      return;
    }
    if (!currentProject) {
      toast.error("Select a project in the sidebar");
      return;
    }
    const output = `src/${currentProject}/outputs/yt-import`;
    const req: ActionRunRequest = {
      action: "yt-import",
      targets: [trimmed],
      target_type: "url",
      output_mode: allowOutput ? "project" : "global",
        params: {
          output,
          force_two_panel: forceTwoPanel,
          quality,
          clip_seconds: clipSeconds ? parseFloat(clipSeconds) : undefined,
          cookies_from_browser: useBrowserCookies ? browserChoice : undefined,
          fast_preview: fastPreview,
        },
      };
    try {
      const res = await runAction(req);
      if (res) {
        if (res.exit_code === 0) {
          toast.success("Import complete", {
            description: `${currentProject} · src/${currentProject}/outputs/yt-import`,
          });
          bumpMediaCache();
          setUrl("");
        } else {
          toast.error("Import failed", {
            description: `${res.output.slice(0, 180)}${res.log_file ? ` · log: ${res.log_file}` : ""}`,
          });
        }
      }
    } finally {
      onRunComplete?.();
    }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <h3 className="text-lg font-semibold">URL Import</h3>
      {targetsSummary && (
        <div className="text-xs text-muted-foreground">{targetsSummary}</div>
      )}
      <div>
        <Label className="text-sm">URL</Label>
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://..."
          className="mt-1"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Downloads the video via yt-dlp (YouTube, Vimeo, X, and more), fetches the transcript, and splits the screen into tiles.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={forceTwoPanel} onCheckedChange={setForceTwoPanel} />
        <Label className="text-sm">Force two-panel split (left/right)</Label>
      </div>
      <div>
        <Label className="text-sm">Quality</Label>
        <Select value={quality} onValueChange={setQuality}>
          <SelectTrigger className="mt-1">
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
        <Label className="text-sm">Clip seconds (for fast tests)</Label>
        <Input
          type="number"
          min={1}
          step="1"
          value={clipSeconds}
          onChange={(e) => setClipSeconds(e.target.value)}
          placeholder="Full length"
          className="mt-1"
        />
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={useBrowserCookies} onCheckedChange={setUseBrowserCookies} />
        <Label className="text-sm">Use browser cookies</Label>
      </div>
      {useBrowserCookies && (
        <div>
          <Label className="text-sm">Browser</Label>
          <Select value={browserChoice} onValueChange={setBrowserChoice}>
            <SelectTrigger className="mt-1">
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
        <Switch checked={fastPreview} onCheckedChange={setFastPreview} />
        <Label className="text-sm">Fast preview (downscale + low fps)</Label>
      </div>
      <div className="text-xs text-muted-foreground">
        Output: {currentProject ? `src/${currentProject}/outputs/yt-import` : "Select a project"}
      </div>
      <Button onClick={handleRun} disabled={running || !currentProject}>
        {running ? "Running..." : "Run Import"}
      </Button>
    </div>
  );
}
