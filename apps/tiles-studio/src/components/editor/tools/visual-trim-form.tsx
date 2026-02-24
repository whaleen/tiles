import { useState } from "react";
import { Label } from "@/components/ui/label";
import { ActionFormWrapper } from "@/components/actions/action-form-wrapper";
import { TrimTool } from "./trim-tool";
import { useVideoInfo } from "@/hooks/use-video-info";
import type { VideoEntry } from "@/types";

interface VisualTrimFormProps {
  video: VideoEntry;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  renderTimeline: (node: React.ReactNode) => void;
}

export function VisualTrimForm({
  video,
  videoRef,
  renderTimeline,
}: VisualTrimFormProps) {
  const { duration, loading, error } = useVideoInfo(video.rel_path);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [initialized, setInitialized] = useState(false);

  // Set endTime to duration once loaded
  if (duration && !initialized) {
    setEndTime(duration);
    setInitialized(true);
  }

  // Reset when video changes
  const [prevPath, setPrevPath] = useState(video.rel_path);
  if (video.rel_path !== prevPath) {
    setPrevPath(video.rel_path);
    setStartTime(0);
    setEndTime(0);
    setInitialized(false);
  }

  const trimStart = startTime;
  const trimEnd = duration ? duration - endTime : 0;

  // Render timeline into the slot
  if (duration && duration > 0) {
    renderTimeline(
      <TrimTool
        duration={duration}
        startTime={startTime}
        endTime={endTime}
        onRangeChange={(s, e) => {
          setStartTime(s);
          setEndTime(e);
        }}
        videoRef={videoRef}
      />
    );
  }

  return (
    <ActionFormWrapper
      actionName="trim"
      targetType="folders_or_videos"
      targetsOverride={[video.rel_path]}
      targetsSummary={`Video: ${video.name}`}
      buildRequest={(targets, outputMode) => ({
        action: "trim",
        targets,
        target_type: "folders_or_videos",
        output_mode: outputMode,
        params: { trim_start: trimStart, trim_end: trimEnd },
      })}
    >
      {() => (
        <div className="space-y-3">
          {loading && (
            <div className="text-xs text-muted-foreground">
              Loading video info...
            </div>
          )}
          {error && (
            <div className="text-xs text-destructive">{error}</div>
          )}
          {duration != null && (
            <>
              <p className="text-sm text-muted-foreground">
                Drag the handles on the timeline to set trim points.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Trim Start</Label>
                  <div className="text-sm font-mono mt-1">
                    {trimStart.toFixed(2)}s
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Trim End</Label>
                  <div className="text-sm font-mono mt-1">
                    {trimEnd.toFixed(2)}s
                  </div>
                </div>
              </div>
              <div>
                <Label className="text-xs">Output Duration</Label>
                <div className="text-sm font-mono mt-1">
                  {(endTime - startTime).toFixed(2)}s
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </ActionFormWrapper>
  );
}
