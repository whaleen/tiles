import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ActionFormWrapper } from "./action-form-wrapper";

interface ActionFormProps {
  targetsOverride?: string[];
  targetsSummary?: string;
  allowOutput?: boolean;
  allowOverwrite?: boolean;
  allowAlongside?: boolean;
  onRunComplete?: () => void;
}

export function DoctorReencodeForm({
  targetsOverride,
  targetsSummary,
  allowOutput,
  allowOverwrite,
  allowAlongside,
  onRunComplete,
}: ActionFormProps) {
  const [fps, setFps] = useState("30");
  const [noAudio, setNoAudio] = useState(false);

  return (
    <ActionFormWrapper
      actionName="doctor-reencode"
      targetType="folders_or_videos"
      targetsOverride={targetsOverride}
      targetsSummary={targetsSummary}
      allowOutput={allowOutput}
      allowOverwrite={allowOverwrite}
      allowAlongside={allowAlongside}
      onRunComplete={onRunComplete}
      buildRequest={(targets, outputMode) => ({
        action: "doctor-reencode",
        targets,
        target_type: "folders_or_videos",
        output_mode: outputMode,
        params: {
          fps: parseInt(fps, 10) || 30,
          no_audio: noAudio,
        },
      })}
    >
      {() => (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Re-encodes videos to a constant frame rate. Phone recordings and
            screen captures often use variable frame rates, which causes choppy
            playback and sync issues when editing. This fixes that.
          </p>
          <div>
            <Label className="text-sm">FPS</Label>
            <Input
              type="number"
              min="1"
              max="120"
              value={fps}
              onChange={(e) => setFps(e.target.value)}
              className="mt-1"
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
