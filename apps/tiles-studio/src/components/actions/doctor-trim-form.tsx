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

export function DoctorTrimForm({
  targetsOverride,
  targetsSummary,
  allowOutput,
  allowOverwrite,
  allowAlongside,
  onRunComplete,
}: ActionFormProps) {
  const [seconds, setSeconds] = useState("1.0");
  const [noAudio, setNoAudio] = useState(false);

  return (
    <ActionFormWrapper
      actionName="doctor-trim-start"
      targetType="folders_or_videos"
      targetsOverride={targetsOverride}
      targetsSummary={targetsSummary}
      allowOutput={allowOutput}
      allowOverwrite={allowOverwrite}
      allowAlongside={allowAlongside}
      onRunComplete={onRunComplete}
      buildRequest={(targets, outputMode) => ({
        action: "doctor-trim-start",
        targets,
        target_type: "folders_or_videos",
        output_mode: outputMode,
        params: {
          seconds: parseFloat(seconds) || 1.0,
          no_audio: noAudio,
        },
      })}
    >
      {() => (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Removes a set number of seconds from the start of each video. Useful
            for fixing black or corrupted first frames that some cameras produce.
          </p>
          <div>
            <Label className="text-sm">Seconds to trim</Label>
            <Input
              type="number"
              step="0.1"
              min="0.1"
              value={seconds}
              onChange={(e) => setSeconds(e.target.value)}
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
