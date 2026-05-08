import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ActionFormWrapper } from "./action-form-wrapper";
import type { ActionRunRequest } from "@/types";

type Props = {
  targetsOverride?: string[];
  targetsSummary?: string;
  allowOverwrite?: boolean;
  allowOutput?: boolean;
  allowAlongside?: boolean;
  onRunComplete?: () => void;
};

export function DoctorReencodeForm(props: Props) {
  const [fps, setFps] = useState(30);

  return (
    <ActionFormWrapper
      actionName="doctor-reencode"
      targetType="folders_or_videos"
      buildRequest={(targets, outputMode): ActionRunRequest => ({
        action: "doctor-reencode",
        targets,
        target_type: "folders_or_videos",
        output_mode: outputMode,
        params: { fps },
      })}
      {...props}
    >
      {() => (
        <div>
          <Label className="text-sm">Frame rate</Label>
          <Input
            type="number"
            min={1}
            max={240}
            step={1}
            value={fps}
            onChange={(e) => setFps(Number(e.target.value) || 30)}
            className="mt-1"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Re-encode to constant frame rate to fix variable-frame-rate clips.
          </p>
        </div>
      )}
    </ActionFormWrapper>
  );
}
