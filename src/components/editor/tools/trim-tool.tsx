import { useCallback, useEffect, useRef } from "react";
import { Slider } from "@/components/ui/slider";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

interface TrimToolProps {
  duration: number;
  startTime: number;
  endTime: number;
  onRangeChange: (start: number, end: number) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

export function TrimTool({
  duration,
  startTime,
  endTime,
  onRangeChange,
  videoRef,
}: TrimToolProps) {
  const rafRef = useRef<number>(0);
  const prevRangeRef = useRef<[number, number]>([startTime, endTime]);
  const isDraggingRef = useRef(false);
  const resumeAfterDragRef = useRef(false);

  const constrainPlayback = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      if (video.currentTime < startTime) {
        video.currentTime = startTime;
      }
      if (video.currentTime >= endTime) {
        video.currentTime = startTime;
      }
    }

    // Keep ticking so we recover if the video element ref is attached later.
    rafRef.current = requestAnimationFrame(constrainPlayback);
  }, [startTime, endTime, videoRef]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(constrainPlayback);
    return () => cancelAnimationFrame(rafRef.current);
  }, [constrainPlayback]);

  // Seek to startTime when handles change
  useEffect(() => {
    const video = videoRef.current;
    if (video && (video.currentTime < startTime || video.currentTime > endTime)) {
      video.currentTime = startTime;
    }
  }, [startTime, endTime, videoRef]);

  useEffect(() => {
    prevRangeRef.current = [startTime, endTime];
  }, [startTime, endTime]);

  const handleRangeChange = useCallback(
    ([s, e]: number[]) => {
      onRangeChange(s, e);

      const video = videoRef.current;
      if (!video) return;

      if (!isDraggingRef.current) {
        isDraggingRef.current = true;
        resumeAfterDragRef.current = !video.paused;
        if (resumeAfterDragRef.current) {
          video.pause();
        }
      }

      const [prevStart, prevEnd] = prevRangeRef.current;
      const startDelta = Math.abs(s - prevStart);
      const endDelta = Math.abs(e - prevEnd);
      const movedHandleTime = endDelta > startDelta ? e : s;
      video.currentTime = movedHandleTime;

      prevRangeRef.current = [s, e];
    },
    [onRangeChange, videoRef]
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{formatTime(startTime)}</span>
        <span className="font-medium text-foreground">
          Duration: {formatTime(endTime - startTime)}
        </span>
        <span>{formatTime(endTime)}</span>
      </div>
      <Slider
        min={0}
        max={duration}
        step={0.01}
        value={[startTime, endTime]}
        onValueChange={handleRangeChange}
        onValueCommit={() => {
          const video = videoRef.current;
          const shouldResume = resumeAfterDragRef.current;
          isDraggingRef.current = false;
          resumeAfterDragRef.current = false;

          if (video && shouldResume) {
            void video.play().catch(() => {
              // Ignore autoplay/play interruption failures.
            });
          }
        }}
        minStepsBetweenThumbs={duration > 0.01 ? 1 : 0}
      />
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>0:00</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}
