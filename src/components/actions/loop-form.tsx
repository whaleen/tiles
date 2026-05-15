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
            <FieldInfo label="Loop Count" info="Total number of times each video should play in the output. 2 means the original plus one repeat." labelClassName="text-sm" />
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
            <FieldInfo label="Transition" info="Effect inserted between loop repetitions. Cut keeps the loop abrupt; fades/dissolves make repeated clips blend together." labelClassName="text-sm" />
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
              <FieldInfo label="Duration (seconds)" info="How long each transition lasts between loop repetitions." labelClassName="text-sm" />
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
