import { useMemo, useState } from "react";
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
  const [noAudio, setNoAudio] = useState(false);

  const safeTrimStart = useMemo(
    () => (Number.isFinite(trimStart) && trimStart > 0 ? trimStart : 0),
    [trimStart]
  );
  const safeTrimEnd = useMemo(
    () => (Number.isFinite(trimEnd) && trimEnd > 0 ? trimEnd : 0),
    [trimEnd]
  );

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
        params: { 
          trim_start: safeTrimStart, 
          trim_end: safeTrimEnd,
          no_audio: noAudio 
        },
      })}
    >
      {() => (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Removes seconds from the beginning and/or end of each video.
            (Always normalizes to CFR for reliable timing).
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm">Trim Start (s)</Label>
              <Input
                type="number"
                min={0}
                step="0.1"
                value={Number.isFinite(trimStart) ? trimStart : ""}
                onChange={(e) =>
                  setTrimStart(e.target.value === "" ? 0 : parseFloat(e.target.value))
                }
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm">Trim End (s)</Label>
              <Input
                type="number"
                min={0}
                step="0.1"
                value={Number.isFinite(trimEnd) ? trimEnd : ""}
                onChange={(e) =>
                  setTrimEnd(e.target.value === "" ? 0 : parseFloat(e.target.value))
                }
                className="mt-1"
              />
            </div>
          </div>

          <div className="pt-2 border-t mt-4">
            <div className="flex items-center gap-2">
              <Switch checked={noAudio} onCheckedChange={setNoAudio} />
              <Label className="text-sm">Strip Audio</Label>
            </div>
          </div>
        </div>
      )}
    </ActionFormWrapper>
  );
}
