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

export function CropForm({
  targetsOverride,
  targetsSummary,
  allowOutput,
  allowOverwrite,
  allowAlongside,
  onRunComplete,
}: ActionFormProps) {
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [w, setW] = useState(1280);
  const [h, setH] = useState(720);

  return (
    <ActionFormWrapper
      actionName="crop"
      targetType="folders_or_videos"
      targetsOverride={targetsOverride}
      targetsSummary={targetsSummary}
      allowOutput={allowOutput}
      allowOverwrite={allowOverwrite}
      allowAlongside={allowAlongside}
      onRunComplete={onRunComplete}
      buildRequest={(targets, outputMode) => ({
        action: "crop",
        targets,
        target_type: "folders_or_videos",
        output_mode: outputMode,
        params: { x, y, w, h },
      })}
    >
      {() => (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Crop videos to a specific region. The crop rectangle is defined by
            position (X, Y) and size (W, H) in pixels.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm">X offset</Label>
              <Input
                type="number"
                min={0}
                value={x}
                onChange={(e) => setX(parseInt(e.target.value) || 0)}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm">Y offset</Label>
              <Input
                type="number"
                min={0}
                value={y}
                onChange={(e) => setY(parseInt(e.target.value) || 0)}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm">Width</Label>
              <Input
                type="number"
                min={1}
                value={w}
                onChange={(e) => setW(parseInt(e.target.value) || 1)}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm">Height</Label>
              <Input
                type="number"
                min={1}
                value={h}
                onChange={(e) => setH(parseInt(e.target.value) || 1)}
                className="mt-1"
              />
            </div>
          </div>
        </div>
      )}
    </ActionFormWrapper>
  );
}
