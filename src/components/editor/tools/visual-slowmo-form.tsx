import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { ActionFormWrapper } from "@/components/actions/action-form-wrapper";
import type { VideoEntry } from "@/types";

interface VisualSlowmoFormProps {
  video: VideoEntry;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

export function VisualSlowmoForm({
  video,
  videoRef,
}: VisualSlowmoFormProps) {
  const [factor, setFactor] = useState(2.0);
  const [noAudio, setNoAudio] = useState(false);

  // Apply playbackRate for real-time preview
  useEffect(() => {
    const vid = videoRef.current;
    if (vid) {
      vid.playbackRate = 1 / factor;
    }
  }, [factor, videoRef]);

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
        params: { factor: 1 / factor, no_audio: noAudio },
      })}
    >
      {() => (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Preview plays at {factor.toFixed(1)}x slower speed in real-time.
            The rendered output will match.
          </p>
          <div>
            <Label className="text-sm">
              Slowdown: {factor.toFixed(1)}x slower
            </Label>
            <Slider
              min={1.5}
              max={8}
              step={0.5}
              value={[factor]}
              onValueChange={([v]) => setFactor(v)}
              className="mt-2"
            />
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
