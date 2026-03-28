import { useState } from "react";
import { ActionFormWrapper } from "./action-form-wrapper";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ActionFormProps {
  targetsOverride?: string[];
  targetsSummary?: string;
  allowOutput?: boolean;
  allowOverwrite?: boolean;
  allowAlongside?: boolean;
  onRunComplete?: () => void;
}

export function SplitDetectForm({
  targetsOverride,
  targetsSummary,
  allowOutput,
  allowOverwrite,
  allowAlongside,
  onRunComplete,
}: ActionFormProps) {
  const [forceTwoPanel, setForceTwoPanel] = useState(false);
  const [quality, setQuality] = useState("medium");
  const [clipSeconds, setClipSeconds] = useState("");
  const [fastPreview, setFastPreview] = useState(true);
  return (
    <ActionFormWrapper
      actionName="split-detect"
      targetType="folders_or_videos"
      targetsOverride={targetsOverride}
      targetsSummary={targetsSummary}
      allowOutput={allowOutput}
      allowOverwrite={allowOverwrite}
      allowAlongside={allowAlongside}
      onRunComplete={onRunComplete}
      buildRequest={(targets, outputMode) => ({
        action: "split-detect",
        targets,
        target_type: "folders_or_videos",
        output_mode: outputMode,
        params: {
          force_two_panel: forceTwoPanel,
          quality,
          clip_seconds: clipSeconds ? parseFloat(clipSeconds) : undefined,
          fast_preview: fastPreview,
        },
      })}
    >
      {() => (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Detects split-screen regions in each video and exports every split into
            its own folder.
          </p>
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
            <Switch checked={fastPreview} onCheckedChange={setFastPreview} />
            <Label className="text-sm">Fast preview (downscale + low fps)</Label>
          </div>
        </div>
      )}
    </ActionFormWrapper>
  );
}
