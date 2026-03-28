import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { ActionFormWrapper } from "./action-form-wrapper";

interface ActionFormProps {
  targetsOverride?: string[];
  targetsSummary?: string;
  allowOutput?: boolean;
  allowOverwrite?: boolean;
  allowAlongside?: boolean;
  onRunComplete?: () => void;
}

export function SlowmoForm({
  targetsOverride,
  targetsSummary,
  allowOutput,
  allowOverwrite,
  allowAlongside,
  onRunComplete,
}: ActionFormProps) {
  const [factor, setFactor] = useState(2.0);
  const [noAudio, setNoAudio] = useState(false);

  return (
    <ActionFormWrapper
      actionName="slowmo"
      targetType="folders_or_videos"
      targetsOverride={targetsOverride}
      targetsSummary={targetsSummary}
      allowOutput={allowOutput}
      allowOverwrite={allowOverwrite}
      allowAlongside={allowAlongside}
      onRunComplete={onRunComplete}
      buildRequest={(targets, outputMode) => ({
        action: "slowmo",
        targets,
        target_type: "folders_or_videos",
        output_mode: outputMode,
        params: { factor: 1 / factor, no_audio: noAudio },
      })}
    >
      {() => (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Creates slow-motion versions of your videos. A 2x slowdown makes a
            10-second clip last 20 seconds.
          </p>
          <div>
            <Label className="text-sm">
              Slowdown: {factor.toFixed(1)}x slower
            </Label>
            <Slider
              min={1.5}
              max={8}
              step={0.5}
              value={[factor]}
              onValueChange={([v]) => setFactor(v)}
              className="mt-2"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={noAudio} onCheckedChange={setNoAudio} />
            <Label className="text-sm">No Audio</Label>
          </div>
        </div>
      )}
    </ActionFormWrapper>
  );
}
