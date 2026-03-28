import { useCallback, useEffect, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ActionFormWrapper } from "@/components/actions/action-form-wrapper";
import type { VideoEntry } from "@/types";

interface VisualLoopFormProps {
  video: VideoEntry;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  renderOverlay: (node: React.ReactNode) => void;
}

export function VisualLoopForm({
  video,
  videoRef,
  renderOverlay,
}: VisualLoopFormProps) {
  const [count, setCount] = useState("2");
  const [transition, setTransition] = useState("cut");
  const [duration, setDuration] = useState("1.0");
  const [fadeOpacity, setFadeOpacity] = useState(0);
  const rafRef = useRef<number>(0);
  const loopCountRef = useRef(0);
  const maxLoops = parseInt(count) || 2;

  // Loop the video on ended
  const handleEnded = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return;
    loopCountRef.current += 1;
    if (loopCountRef.current < maxLoops) {
      vid.currentTime = 0;
      vid.play();
    }
  }, [videoRef, maxLoops]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    loopCountRef.current = 0;
    vid.addEventListener("ended", handleEnded);
    return () => vid.removeEventListener("ended", handleEnded);
  }, [videoRef, handleEnded]);

  // Fade preview overlay
  const fadeDuration = parseFloat(duration) || 1.0;
  const showFade = transition !== "cut";

  useEffect(() => {
    if (!showFade) {
      setFadeOpacity(0);
      renderOverlay(null);
      return;
    }

    function tick() {
      const vid = videoRef.current;
      if (!vid || vid.paused || !vid.duration) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const timeLeft = vid.duration - vid.currentTime;
      if (timeLeft <= fadeDuration && timeLeft >= 0) {
        const progress = 1 - timeLeft / fadeDuration;
        setFadeOpacity(progress);
      } else {
        setFadeOpacity(0);
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [videoRef, fadeDuration, showFade]);

  // Render fade overlay
  useEffect(() => {
    if (!showFade || fadeOpacity <= 0) {
      renderOverlay(null);
      return;
    }

    const bg =
      transition === "fadeblack"
        ? `rgba(0, 0, 0, ${fadeOpacity})`
        : `rgba(0, 0, 0, ${fadeOpacity * 0.5})`;

    renderOverlay(
      <div
        className="absolute inset-0 pointer-events-none transition-none"
        style={{ backgroundColor: bg, zIndex: 10 }}
      />
    );
  }, [fadeOpacity, transition, showFade]);

  // Cleanup
  useEffect(() => {
    return () => renderOverlay(null);
  }, []);

  return (
    <ActionFormWrapper
      actionName="loop"
      targetType="folders_or_videos"
      targetsOverride={[video.rel_path]}
      targetsSummary={`Video: ${video.name}`}
      allowOverwrite={false}
      buildRequest={(targets, outputMode) => ({
        action: "loop",
        targets,
        target_type: "folders_or_videos",
        output_mode: outputMode,
        params: {
          count: parseInt(count) || 2,
          transition: transition !== "cut" ? transition : undefined,
          duration: transition !== "cut" ? parseFloat(duration) : undefined,
        },
      })}
    >
      {() => (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Preview: video will loop {maxLoops} times with{" "}
            {transition === "cut" ? "no transition" : `${transition} transition`}.
          </p>
          <div>
            <Label className="text-sm">Loop Count</Label>
            <Input
              type="number"
              min={2}
              max={100}
              step={1}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              className="mt-1 w-24"
            />
          </div>
          <div>
            <Label className="text-sm">Transition</Label>
            <Select value={transition} onValueChange={setTransition}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cut">Cut (no transition)</SelectItem>
                <SelectItem value="fade">Fade</SelectItem>
                <SelectItem value="fadeblack">Fade to Black</SelectItem>
                <SelectItem value="dissolve">Dissolve</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {transition !== "cut" && (
            <div>
              <Label className="text-sm">Duration (seconds)</Label>
              <Input
                type="number"
                step="0.1"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className="mt-1"
              />
            </div>
          )}
        </div>
      )}
    </ActionFormWrapper>
  );
}
