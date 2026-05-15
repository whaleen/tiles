import { useState } from "react";
import { FieldInfo } from "@/components/ui/field-info";
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
              <FieldInfo label="X offset" info="Left edge of the crop rectangle in pixels, measured from the source video's left side." labelClassName="text-sm" />
              <Input
                type="number"
                min={0}
                value={x}
                onChange={(e) => setX(parseInt(e.target.value) || 0)}
                className="mt-1"
              />
            </div>
            <div>
              <FieldInfo label="Y offset" info="Top edge of the crop rectangle in pixels, measured from the source video's top edge." labelClassName="text-sm" />
              <Input
                type="number"
                min={0}
                value={y}
                onChange={(e) => setY(parseInt(e.target.value) || 0)}
                className="mt-1"
              />
            </div>
            <div>
              <FieldInfo label="Width" info="Width of the crop rectangle in pixels. Must fit within the source video after the X offset." labelClassName="text-sm" />
              <Input
                type="number"
                min={1}
                value={w}
                onChange={(e) => setW(parseInt(e.target.value) || 1)}
                className="mt-1"
              />
            </div>
            <div>
              <FieldInfo label="Height" info="Height of the crop rectangle in pixels. Must fit within the source video after the Y offset." labelClassName="text-sm" />
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
