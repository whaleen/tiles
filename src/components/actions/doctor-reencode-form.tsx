import { useState } from "react";
import { FieldInfo } from "@/components/ui/field-info";
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
          <FieldInfo label="Frame rate" info="Target constant frame rate for re-encoding. 30 fps is a safe default for fixing variable-frame-rate clips without creating huge files." labelClassName="text-sm" />
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
