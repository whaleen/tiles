import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ActionFormWrapper } from "@/components/actions/action-form-wrapper";
import { SPEED_PRESETS, speedLabel, trimNum } from "@/components/actions/slowmo-form";
import { cn } from "@/lib/utils";
import type { VideoEntry } from "@/types";

interface VisualSlowmoFormProps {
  video: VideoEntry;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

export function VisualSlowmoForm({
  video,
  videoRef,
}: VisualSlowmoFormProps) {
  // Default 0.5 (2x slower) preserves the previous Slow Motion default.
  const [speed, setSpeed] = useState(0.5);
  const [noAudio, setNoAudio] = useState(false);

  // Apply playbackRate for real-time preview (speed is the multiplier directly).
  useEffect(() => {
    const vid = videoRef.current;
    if (vid) {
      vid.playbackRate = speed;
    }
  }, [speed, videoRef]);

  // Reset playbackRate on unmount
  useEffect(() => {
    return () => {
      const vid = videoRef.current;
      if (vid) {
        vid.playbackRate = 1.0;
      }
    };
  }, [videoRef]);

  return (
    <ActionFormWrapper
      actionName="slowmo"
      targetType="folders_or_videos"
      targetsOverride={[video.rel_path]}
      targetsSummary={`Video: ${video.name}`}
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
            Preview plays at {trimNum(speed)}x ({speedLabel(speed)}) in real-time.
            The rendered output will match.
          </p>
          <div className="space-y-2">
            <Label className="text-sm">
              Speed: {trimNum(speed)}x ({speedLabel(speed)})
            </Label>
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
          </div>
        </div>
      )}
    </ActionFormWrapper>
  );
}
