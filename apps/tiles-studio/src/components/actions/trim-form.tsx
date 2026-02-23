import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ActionFormWrapper } from "./action-form-wrapper";

interface ActionFormProps {
  targetsOverride?: string[];
  targetsSummary?: string;
  allowOutput?: boolean;
  allowOverwrite?: boolean;
  allowAlongside?: boolean;
  onRunComplete?: () => void;
}

export function TrimForm({
  targetsOverride,
  targetsSummary,
  allowOutput,
  allowOverwrite,
  allowAlongside,
  onRunComplete,
}: ActionFormProps) {
  const [trimStart, setTrimStart] = useState(0.5);
  const [trimEnd, setTrimEnd] = useState(0.25);

  return (
    <ActionFormWrapper
      actionName="trim"
      targetType="folders_or_videos"
      targetsOverride={targetsOverride}
      targetsSummary={targetsSummary}
      allowOutput={allowOutput}
      allowOverwrite={allowOverwrite}
      allowAlongside={allowAlongside}
      onRunComplete={onRunComplete}
      buildRequest={(targets, outputMode) => ({
        action: "trim",
        targets,
        target_type: "folders_or_videos",
        output_mode: outputMode,
        params: { trim_start: trimStart, trim_end: trimEnd },
      })}
    >
      {() => (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Removes a fixed number of seconds from the beginning and/or end of each video.
          </p>
          <div>
            <Label className="text-sm">Trim Start (seconds)</Label>
            <Input
              type="number"
              min={0}
              step="0.1"
              value={Number.isFinite(trimStart) ? trimStart : ""}
              onChange={(e) =>
                setTrimStart(e.target.value === "" ? 0 : parseFloat(e.target.value))
              }
              className="mt-2"
            />
          </div>
          <div>
            <Label className="text-sm">Trim End (seconds)</Label>
            <Input
              type="number"
              min={0}
              step="0.1"
              value={Number.isFinite(trimEnd) ? trimEnd : ""}
              onChange={(e) =>
                setTrimEnd(e.target.value === "" ? 0 : parseFloat(e.target.value))
              }
              className="mt-2"
            />
          </div>
        </div>
      )}
    </ActionFormWrapper>
  );
}
