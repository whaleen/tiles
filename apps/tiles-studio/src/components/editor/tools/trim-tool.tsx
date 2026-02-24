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

  const constrainPlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.currentTime < startTime) {
      video.currentTime = startTime;
    }
    if (video.currentTime >= endTime) {
      video.currentTime = startTime;
    }

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
        onValueChange={([s, e]) => onRangeChange(s, e)}
        minStepsBetweenThumbs={1}
      />
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>0:00</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}
