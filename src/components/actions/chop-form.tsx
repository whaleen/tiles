import { useState } from "react";
import { FieldInfo } from "@/components/ui/field-info";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ActionFormWrapper } from "./action-form-wrapper";

interface ActionFormProps {
  targetsOverride?: string[];
  targetsSummary?: string;
  allowOutput?: boolean;
  allowOverwrite?: boolean;
  allowAlongside?: boolean;
  onRunComplete?: () => void;
}

export function ChopForm({
  targetsOverride,
  targetsSummary,
  allowOutput,
  allowOverwrite,
  allowAlongside,
  onRunComplete,
}: ActionFormProps) {
  const [mode, setMode] = useState<"duration" | "count">("duration");
  const [duration, setDuration] = useState(30);
  const [count, setCount] = useState(4);

  return (
    <ActionFormWrapper
      actionName="chop"
      targetType="folders_or_videos"
      targetsOverride={targetsOverride}
      targetsSummary={targetsSummary}
      allowOutput={allowOutput}
      allowOverwrite={allowOverwrite}
      allowAlongside={allowAlongside}
      onRunComplete={onRunComplete}
      buildRequest={(targets, outputMode) => ({
        action: "chop",
        targets,
        target_type: "folders_or_videos",
        output_mode: outputMode,
        params:
          mode === "duration"
            ? { duration }
            : { count },
      })}
    >
      {() => (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Split long videos into smaller segments by duration or count.
          </p>
          <div>
            <FieldInfo label="Split Mode" info="Choose whether to cut each video into fixed-length chunks or into a fixed number of equal-ish segments." labelClassName="text-sm" />
            <Select value={mode} onValueChange={(v) => setMode(v as "duration" | "count")}>
              <SelectTrigger className="mt-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="duration">By Duration</SelectItem>
                <SelectItem value="count">By Count</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {mode === "duration" ? (
            <div>
              <FieldInfo label="Segment Duration (seconds)" info="Length of each output segment. The last segment may be shorter if the source video does not divide evenly." labelClassName="text-sm" />
              <Input
                type="number"
                min={1}
                step="1"
                value={Number.isFinite(duration) ? duration : ""}
                onChange={(e) =>
                  setDuration(e.target.value === "" ? 0 : parseFloat(e.target.value))
                }
                className="mt-2"
              />
            </div>
          ) : (
            <div>
              <FieldInfo label="Number of Segments" info="How many pieces to split each video into. Segment lengths are calculated from each source video duration." labelClassName="text-sm" />
              <Input
                type="number"
                min={1}
                step="1"
                value={Number.isFinite(count) ? count : ""}
                onChange={(e) =>
                  setCount(e.target.value === "" ? 0 : parseInt(e.target.value, 10))
                }
                className="mt-2"
              />
            </div>
          )}
        </div>
      )}
    </ActionFormWrapper>
  );
}
