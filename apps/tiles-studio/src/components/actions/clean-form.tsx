import { useState } from "react";
import { Label } from "@/components/ui/label";
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

export function CleanForm({
  targetsOverride,
  targetsSummary,
  allowOutput,
  allowOverwrite,
  allowAlongside,
  onRunComplete,
}: ActionFormProps) {
  const [mode, setMode] = useState("3");
  const [addNumber, setAddNumber] = useState(false);

  return (
    <ActionFormWrapper
      actionName="clean"
      targetType="folders"
      targetsOverride={targetsOverride}
      targetsSummary={targetsSummary}
      allowOutput={allowOutput}
      allowOverwrite={allowOverwrite}
      allowAlongside={allowAlongside}
      onRunComplete={onRunComplete}
      buildRequest={(targets, outputMode) => ({
        action: "clean",
        targets,
        target_type: "folders",
        output_mode: outputMode,
        params: { mode, add_number: addNumber },
      })}
    >
      {() => (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Tidies up video filenames in a folder. Can remove duplicate files
            (by content hash), rename files to a clean numbered sequence, or both.
          </p>
          <div>
            <Label className="text-sm">Mode</Label>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Remove Duplicates</SelectItem>
                <SelectItem value="2">Rename Files</SelectItem>
                <SelectItem value="3">Both (duplicates + rename)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={addNumber} onCheckedChange={setAddNumber} />
            <Label className="text-sm">Add Number Prefix</Label>
          </div>
        </div>
      )}
    </ActionFormWrapper>
  );
}
