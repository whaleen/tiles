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
}

export function RunForm({ targetsOverride, targetsSummary }: ActionFormProps) {
  const [renderMode, setRenderMode] = useState("preview");
  const [noOverwrite, setNoOverwrite] = useState(false);
  const [forceCfr, setForceCfr] = useState(false);

  return (
    <ActionFormWrapper
      actionName="run"
      targetType="settings"
      targetsOverride={targetsOverride}
      targetsSummary={targetsSummary}
      buildRequest={(_targets, outputMode) => ({
        action: "run",
        targets: [],
        target_type: "settings",
        output_mode: outputMode,
        params: {
          settings_path: "configs/tile_videos_settings.json",
          render_mode: renderMode,
          no_overwrite: noOverwrite,
          force_cfr: forceCfr,
        },
      })}
    >
      {() => (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Renders a tiled composition using your saved Tile Builder settings.
            A quick way to re-render without opening the builder.
          </p>
          <div>
            <Label className="text-sm">Render Mode</Label>
            <Select value={renderMode} onValueChange={setRenderMode}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="preview">Preview</SelectItem>
                <SelectItem value="fast-preview">Fast Preview</SelectItem>
                <SelectItem value="full">Full</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={noOverwrite} onCheckedChange={setNoOverwrite} />
            <Label className="text-sm">Skip if output already exists</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={forceCfr} onCheckedChange={setForceCfr} />
            <Label className="text-sm">Force constant frame rate</Label>
          </div>
        </div>
      )}
    </ActionFormWrapper>
  );
}
