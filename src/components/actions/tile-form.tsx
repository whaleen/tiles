import { useState } from "react";
import { Label } from "@/components/ui/label";
import { FieldInfo } from "@/components/ui/field-info";
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

export function TileForm({ targetsOverride, targetsSummary }: ActionFormProps) {
  const [renderMode, setRenderMode] = useState("preview");
  const [noOverwrite, setNoOverwrite] = useState(false);
  const [forceCfr, setForceCfr] = useState(false);

  return (
    <ActionFormWrapper
      actionName="tile"
      targetType="settings"
      targetsOverride={targetsOverride}
      targetsSummary={targetsSummary}
      buildRequest={(_targets, outputMode) => ({
        action: "tile",
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
            Renders a tiled video composition using the layout and folder
            assignments you configured in the Tile Builder. Use preview mode for
            fast test renders before committing to a full-quality export.
          </p>
          <div>
            <FieldInfo label="Render Mode" info="Preview renders faster at practical quality; Fast Preview is lower-res for quick checks; Full is intended for final exports." labelClassName="text-sm" />
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
            <FieldInfo label="" info="Prevents replacing an existing render with the same output path." className="contents" labelClassName="hidden" />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={forceCfr} onCheckedChange={setForceCfr} />
            <Label className="text-sm">Force constant frame rate</Label>
            <FieldInfo label="" info="Normalizes variable-frame-rate source clips before/while rendering to avoid timing drift and choppy playback." className="contents" labelClassName="hidden" />
          </div>
        </div>
      )}
    </ActionFormWrapper>
  );
}
