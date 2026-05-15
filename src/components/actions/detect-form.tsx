import { useState } from "react";
import { Label } from "@/components/ui/label";
import { FieldInfo } from "@/components/ui/field-info";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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

export function DetectForm({
  targetsOverride,
  targetsSummary,
  allowOutput,
  allowOverwrite,
  allowAlongside,
  onRunComplete,
}: ActionFormProps) {
  const [threshold, setThreshold] = useState("0.3");
  const [method, setMethod] = useState("content");
  const [listOnly, setListOnly] = useState(false);

  return (
    <ActionFormWrapper
      actionName="detect"
      targetType="folders_or_videos"
      targetsOverride={targetsOverride}
      targetsSummary={targetsSummary}
      allowOutput={allowOutput}
      allowOverwrite={allowOverwrite}
      allowAlongside={allowAlongside}
      onRunComplete={onRunComplete}
      buildRequest={(targets, outputMode) => ({
        action: "detect",
        targets,
        target_type: "folders_or_videos",
        output_mode: outputMode,
        params: {
          threshold: parseFloat(threshold),
          method,
          list_only: listOnly,
        },
      })}
    >
      {() => (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Analyzes videos for scene changes and splits them into separate
            clips at each cut point. Lower thresholds detect more scenes.
          </p>
          <div>
            <FieldInfo label="Threshold" info="Scene-change sensitivity. Lower values create more cuts; higher values only split on more obvious changes." labelClassName="text-sm" />
            <Input
              type="number"
              step="0.01"
              min="0.01"
              max="1.0"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <FieldInfo label="Method" info="Content compares frame differences directly. Adaptive adjusts sensitivity over time and can work better on videos with changing motion/lighting." labelClassName="text-sm" />
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="content">Content</SelectItem>
                <SelectItem value="adaptive">Adaptive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={listOnly} onCheckedChange={setListOnly} />
            <Label className="text-sm">List Only (no splitting)</Label>
            <FieldInfo label="" info="Preview detected scene boundaries without writing any split clip files." className="contents" labelClassName="hidden" />
          </div>
        </div>
      )}
    </ActionFormWrapper>
  );
}
