import { useCallback, useEffect, useMemo, useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ActionFormWrapper } from "@/components/actions/action-form-wrapper";
import { TrimTool } from "./trim-tool";
import { useVideoInfo } from "@/hooks/use-video-info";
import type { VideoEntry } from "@/types";

interface VisualTrimFormProps {
  video: VideoEntry;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  renderTimeline: (node: React.ReactNode) => void;
}

const MIN_OUTPUT_DURATION = 0.1;
const NUDGE_SECONDS = 0.1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundToHundredths(value: number): number {
  return Math.round(value * 100) / 100;
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
  const [noAudio, setNoAudio] = useState(false);

  useEffect(() => {
    if (duration && !initialized) {
      setEndTime(duration);
      setInitialized(true);
    }
  }, [duration, initialized]);

  useEffect(() => {
    setStartTime(0);
    setEndTime(0);
    setInitialized(false);
    setNoAudio(false);
  }, [video.rel_path]);

  const safeDuration = useMemo(
    () => (duration && duration > 0 ? duration : 0),
    [duration]
  );

  const updateRange = useCallback(
    (nextStart: number, nextEnd: number) => {
      if (safeDuration <= 0) {
        setStartTime(0);
        setEndTime(0);
        return;
      }

      if (safeDuration <= MIN_OUTPUT_DURATION) {
        setStartTime(0);
        setEndTime(roundToHundredths(safeDuration));
        return;
      }

      const maxStart = safeDuration - MIN_OUTPUT_DURATION;
      const clampedStart = clamp(nextStart, 0, maxStart);
      const minEnd = clampedStart + MIN_OUTPUT_DURATION;
      const clampedEnd = clamp(nextEnd, minEnd, safeDuration);

      setStartTime(roundToHundredths(clampedStart));
      setEndTime(roundToHundredths(clampedEnd));
    },
    [safeDuration]
  );

  const trimStart = useMemo(() => clamp(startTime, 0, safeDuration), [startTime, safeDuration]);
  const clampedEndTime = useMemo(() => {
    if (safeDuration <= 0) return 0;
    if (safeDuration <= MIN_OUTPUT_DURATION) return safeDuration;
    const minEnd = trimStart + MIN_OUTPUT_DURATION;
    return clamp(endTime, minEnd, safeDuration);
  }, [endTime, safeDuration, trimStart]);

  const trimEnd = useMemo(
    () => (safeDuration ? Math.max(0, safeDuration - clampedEndTime) : 0),
    [safeDuration, clampedEndTime]
  );
  const outputDuration = useMemo(
    () => Math.max(0, clampedEndTime - trimStart),
    [clampedEndTime, trimStart]
  );

  const timelineContent = useMemo(() => {
    if (!safeDuration || safeDuration <= 0) return null;
    return (
      <TrimTool
        duration={safeDuration}
        startTime={trimStart}
        endTime={clampedEndTime}
        onRangeChange={updateRange}
        videoRef={videoRef}
      />
    );
  }, [safeDuration, trimStart, clampedEndTime, updateRange, videoRef]);

  const canReset = trimStart > 0 || clampedEndTime < safeDuration;

  useEffect(() => {
    renderTimeline(timelineContent);
    return () => renderTimeline(null);
  }, [timelineContent, renderTimeline]);

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
        params: { 
          trim_start: trimStart, 
          trim_end: trimEnd,
          no_audio: noAudio 
        },
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
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <Label className="text-xs">Trim Start (`trim_start`)</Label>
                  <div className="text-sm font-mono mt-1 mb-1">
                    {trimStart.toFixed(2)}s
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      max={safeDuration}
                      step={0.01}
                      value={trimStart.toFixed(2)}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        if (!Number.isFinite(next)) return;
                        updateRange(next, clampedEndTime);
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => updateRange(trimStart - NUDGE_SECONDS, clampedEndTime)}
                    >
                      -0.1s
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => updateRange(trimStart + NUDGE_SECONDS, clampedEndTime)}
                    >
                      +0.1s
                    </Button>
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Trim End (`trim_end`)</Label>
                  <div className="text-sm font-mono mt-1 mb-1">
                    {trimEnd.toFixed(2)}s
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      max={safeDuration}
                      step={0.01}
                      value={trimEnd.toFixed(2)}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        if (!Number.isFinite(next)) return;
                        const nextEndTime = safeDuration - next;
                        updateRange(trimStart, nextEndTime);
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const nextTrimEnd = trimEnd - NUDGE_SECONDS;
                        updateRange(trimStart, safeDuration - nextTrimEnd);
                      }}
                    >
                      -0.1s
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const nextTrimEnd = trimEnd + NUDGE_SECONDS;
                        updateRange(trimStart, safeDuration - nextTrimEnd);
                      }}
                    >
                      +0.1s
                    </Button>
                  </div>
                </div>
              </div>
              <div>
                <Label className="text-xs">Output Duration</Label>
                <div className="text-sm font-mono mt-1">
                  {outputDuration.toFixed(2)}s
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canReset}
                  onClick={() => updateRange(0, safeDuration)}
                >
                  Reset Range
                </Button>
                {safeDuration > 0 && outputDuration < MIN_OUTPUT_DURATION && (
                  <span className="text-xs text-destructive">
                    Output duration must be at least {MIN_OUTPUT_DURATION.toFixed(1)}s.
                  </span>
                )}
              </div>

              <div className="pt-2 border-t mt-4">
                <div className="flex items-center gap-2 pb-2.5">
                  <Switch checked={noAudio} onCheckedChange={setNoAudio} />
                  <Label className="text-sm">Strip Audio</Label>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </ActionFormWrapper>
  );
}
