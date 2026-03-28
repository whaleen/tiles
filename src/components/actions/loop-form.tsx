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

export function LoopForm({
  targetsOverride,
  targetsSummary,
  allowOutput,
  allowOverwrite,
  allowAlongside,
  onRunComplete,
}: ActionFormProps) {
  const [count, setCount] = useState("2");
  const [transition, setTransition] = useState("cut");
  const [duration, setDuration] = useState("1.0");

  return (
    <ActionFormWrapper
      actionName="loop"
      targetType="folders_or_videos"
      targetsOverride={targetsOverride}
      targetsSummary={targetsSummary}
      allowOutput={allowOutput}
      allowOverwrite={allowOverwrite}
      allowAlongside={allowAlongside}
      onRunComplete={onRunComplete}
      buildRequest={(targets, outputMode) => ({
        action: "loop",
        targets,
        target_type: "folders_or_videos",
        output_mode: outputMode,
        params: {
          count: parseInt(count) || 2,
          transition: transition !== "cut" ? transition : undefined,
          duration: transition !== "cut" ? parseFloat(duration) : undefined,
        },
      })}
    >
      {() => (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Loop each video a set number of times. Transitions apply between
            each loop iteration.
          </p>
          <div>
            <Label className="text-sm">Loop Count</Label>
            <Input
              type="number"
              min={2}
              max={100}
              step={1}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              className="mt-1 w-24"
            />
          </div>
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
