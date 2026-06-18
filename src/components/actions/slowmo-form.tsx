import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { FieldInfo } from "@/components/ui/field-info";
import { Switch } from "@/components/ui/switch";
import { ActionFormWrapper } from "./action-form-wrapper";
import { cn } from "@/lib/utils";

interface ActionFormProps {
  targetsOverride?: string[];
  targetsSummary?: string;
  allowOutput?: boolean;
  allowOverwrite?: boolean;
  allowAlongside?: boolean;
  onRunComplete?: () => void;
}

// Speed multiplier presets: < 1 slows down, > 1 speeds up. `factor` sent to the
// CLI is this same multiplier (CLI: setpts=(1/factor)*PTS, duration=d/factor).
export const SPEED_PRESETS = [0.25, 0.5, 1, 2, 4];

export function trimNum(n: number): string {
  return Number(n.toFixed(2)).toString();
}

export function speedLabel(speed: number): string {
  if (Math.abs(speed - 1) < 1e-6) return "normal speed";
  if (speed < 1) return `${trimNum(1 / speed)}x slower`;
  return `${trimNum(speed)}x faster`;
}

export function SlowmoForm({
  targetsOverride,
  targetsSummary,
  allowOutput,
  allowOverwrite,
  allowAlongside,
  onRunComplete,
}: ActionFormProps) {
  // Default 0.5 (2x slower) preserves the previous Slow Motion default.
  const [speed, setSpeed] = useState(0.5);
  const [noAudio, setNoAudio] = useState(false);

  return (
    <ActionFormWrapper
      actionName="slowmo"
      targetType="folders_or_videos"
      targetsOverride={targetsOverride}
      targetsSummary={targetsSummary}
      allowOutput={allowOutput}
      allowOverwrite={allowOverwrite}
      allowAlongside={allowAlongside}
      onRunComplete={onRunComplete}
      buildRequest={(targets, outputMode) => ({
        action: "slowmo",
        targets,
        target_type: "folders_or_videos",
        output_mode: outputMode,
        params: { factor: speed, no_audio: noAudio },
      })}
    >
      {() => (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Change playback speed. Below 1x slows the clip down (longer); above
            1x speeds it up (shorter).
          </p>
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label className="text-sm">
                Speed: {trimNum(speed)}x ({speedLabel(speed)})
              </Label>
              <FieldInfo label="" info="Playback speed multiplier. 0.5x is twice as long (slow motion); 2x is half as long (sped up)." className="contents" labelClassName="hidden" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SPEED_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setSpeed(p)}
                  className={cn(
                    "rounded border px-2 py-1 text-xs transition-colors",
                    Math.abs(speed - p) < 1e-6
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  {p}x
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Custom</Label>
              <Input
                type="number"
                min={0.1}
                step={0.05}
                value={speed}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (Number.isFinite(v) && v > 0) setSpeed(v);
                }}
                className="h-8 w-24 text-xs"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={noAudio} onCheckedChange={setNoAudio} />
            <Label className="text-sm">No Audio</Label>
            <FieldInfo label="" info="Drops audio from the output. Useful when re-timed audio would sound distorted or distracting." className="contents" labelClassName="hidden" />
          </div>
        </div>
      )}
    </ActionFormWrapper>
  );
}
