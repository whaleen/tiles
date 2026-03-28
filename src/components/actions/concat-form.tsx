import { useState } from "react";
import { Label } from "@/components/ui/label";
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

export function ConcatForm({
  targetsOverride,
  targetsSummary,
  allowOutput,
  allowOverwrite,
  allowAlongside,
  onRunComplete,
}: ActionFormProps) {
  const [transition, setTransition] = useState("cut");
  const [duration, setDuration] = useState("1.0");

  return (
    <ActionFormWrapper
      actionName="concat"
      targetType="folders"
      targetsOverride={targetsOverride}
      targetsSummary={targetsSummary}
      allowOutput={allowOutput}
      allowOverwrite={allowOverwrite}
      allowAlongside={allowAlongside}
      onRunComplete={onRunComplete}
      buildRequest={(targets, outputMode) => ({
        action: "concat",
        targets,
        target_type: "folders",
        output_mode: outputMode,
        params: {
          transition: transition !== "cut" ? transition : undefined,
          duration: transition !== "cut" ? parseFloat(duration) : undefined,
        },
      })}
    >
      {() => (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Joins all videos in the selected folders into one continuous file,
            in filename order. Pick a transition to smooth the cuts between clips.
          </p>
          <div>
            <Label className="text-sm">Transition</Label>
            <Select value={transition} onValueChange={setTransition}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cut">Cut (no transition)</SelectItem>
                <SelectItem value="fade">Fade</SelectItem>
                <SelectItem value="fadeblack">Fade to Black</SelectItem>
                <SelectItem value="dissolve">Dissolve</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {transition !== "cut" && (
            <div>
              <Label className="text-sm">Duration (seconds)</Label>
              <Input
                type="number"
                step="0.1"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className="mt-1"
              />
            </div>
          )}
        </div>
      )}
    </ActionFormWrapper>
  );
}
