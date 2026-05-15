import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldInfo } from "@/components/ui/field-info";
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
        <FieldInfo label="URL" info="URL passed to yt-dlp for the legacy split-frame import. Use the main Import page's URL tab for selectable multi-URL imports." labelClassName="text-sm" />
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
        <FieldInfo label="" info="Skip automatic detection and always crop the downloaded video into left and right halves." className="contents" labelClassName="hidden" />
      </div>
      <div>
        <FieldInfo label="Quality" info="Encoding quality for the split-frame crop outputs after download." labelClassName="text-sm" />
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
        <FieldInfo label="Clip seconds (for fast tests)" info="Optional processing limit for quick tests. Leave blank to download/process the full video." labelClassName="text-sm" />
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
        <FieldInfo label="" info="Lets yt-dlp read browser cookies for sites that require login, age checks, memberships, or region/session state." className="contents" labelClassName="hidden" />
      </div>
      {useBrowserCookies && (
        <div>
          <FieldInfo label="Browser" info="Browser profile yt-dlp should read cookies from. Pick the browser where you are logged into the source site." labelClassName="text-sm" />
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
        <FieldInfo label="" info="Speeds up test runs by producing lower-resolution, lower-framerate split outputs." className="contents" labelClassName="hidden" />
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
