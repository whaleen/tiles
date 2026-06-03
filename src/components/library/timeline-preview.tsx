import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { videoUrl, thumbUrl } from "@/api/client";
import { Button } from "@/components/ui/button";
import { readFullscreenState, useFullscreenVideo } from "@/components/fullscreen-video-player";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Maximize,
  Pause,
  Play,
  Film,
} from "lucide-react";
import type { VideoEntry } from "@/types";

interface TimelinePreviewProps {
  videos: VideoEntry[];
  onBack: () => void;
  startIndex?: number;
}

export function TimelinePreview({
  videos,
  onBack,
  startIndex = 0,
}: TimelinePreviewProps) {
  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const [isPlaying, setIsPlaying] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { openVideoFullscreen, isVideoFullscreenOpen } = useFullscreenVideo();
  const activeThumbRef = useRef<HTMLButtonElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const current = videos[currentIndex];
  const isLast = currentIndex === videos.length - 1;

  const goTo = useCallback(
    (index: number) => {
      if (index < 0 || index >= videos.length) return;
      setCurrentIndex(index);
      setIsPlaying(true);
    },
    [videos.length]
  );

  const goPrev = useCallback(() => {
    if (currentIndex > 0) goTo(currentIndex - 1);
  }, [currentIndex, goTo]);

  const goNext = useCallback(() => {
    if (!isLast) goTo(currentIndex + 1);
  }, [currentIndex, isLast, goTo]);

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      el.play();
      setIsPlaying(true);
    } else {
      el.pause();
      setIsPlaying(false);
    }
  }, []);

  const enterFullscreen = useCallback(() => {
    if (!current) return;
    openVideoFullscreen({
      src: videoUrl(current.rel_path),
      title: current.name,
      ...readFullscreenState(videoRef.current),
      onClose: (state) => {
        const el = videoRef.current;
        if (!el) return;
        el.currentTime = state.currentTime;
        el.volume = state.volume;
        el.muted = state.muted;
        el.playbackRate = state.playbackRate;
        if (state.paused) el.pause();
        else void el.play().catch(() => {});
        setIsPlaying(!state.paused);
      },
    });
  }, [current, openVideoFullscreen]);

  // Auto-advance on video end
  const handleEnded = useCallback(() => {
    if (!isLast) {
      goNext();
    } else {
      setIsPlaying(false);
    }
  }, [isLast, goNext]);

  // Auto-play when clip changes
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !isPlaying) return;
    el.load();
    const playPromise = el.play();
    if (playPromise) {
      playPromise.catch(() => {
        // browser may block autoplay
      });
    }
  }, [currentIndex, isPlaying]);

  // Scroll active thumb into view
  useEffect(() => {
    activeThumbRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [currentIndex]);

  // Keyboard navigation
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (isVideoFullscreenOpen) return;
      if (e.key === "Escape") {
        onBack();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      } else if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        enterFullscreen();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onBack, goPrev, goNext, togglePlay, enterFullscreen, isVideoFullscreenOpen]);

  if (!current) return null;

  return (
    <div className="min-h-0 flex-1 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-2 shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack} className="h-8 px-2">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <div className="text-sm text-muted-foreground tabular-nums">
          {currentIndex + 1} / {videos.length}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={goPrev}
            disabled={currentIndex === 0}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={togglePlay}
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={goNext}
            disabled={isLast}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={enterFullscreen}
          >
            <Maximize className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Video player */}
      <div className="flex-1 min-h-0 flex items-center justify-center bg-black rounded-lg overflow-hidden">
        <video
          ref={videoRef}
          src={videoUrl(current.rel_path)}
          className="max-w-full max-h-full"
          onEnded={handleEnded}
          onPause={() => setIsPlaying(false)}
          onPlay={() => setIsPlaying(true)}
        />
      </div>

      {/* Clip name */}
      <div className="text-xs text-muted-foreground text-center truncate px-4 shrink-0">
        {current.name}
      </div>

      {/* Timeline strip */}
      <div
        ref={stripRef}
        className="shrink-0 border rounded-lg bg-muted/20 p-2 overflow-x-auto"
      >
        <div className="flex items-center gap-1.5">
          {videos.map((v, i) => (
            <TimelineThumb
              key={v.name}
              video={v}
              active={i === currentIndex}
              onClick={() => goTo(i)}
              ref={i === currentIndex ? activeThumbRef : undefined}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const TimelineThumb = forwardRef<
  HTMLButtonElement,
  { video: VideoEntry; active: boolean; onClick: () => void }
>(function TimelineThumb({ video, active, onClick }, ref) {
  const [broken, setBroken] = useState(false);

  return (
    <button
      ref={ref}
      onClick={onClick}
      className={`shrink-0 w-[120px] rounded overflow-hidden transition-all ${
        active ? "ring-2 ring-primary scale-105" : "opacity-70 hover:opacity-100"
      }`}
    >
      <div className="relative aspect-video bg-muted">
        {broken ? (
          <div className="w-full h-full flex items-center justify-center">
            <Film className="h-4 w-4 text-muted-foreground/50" />
          </div>
        ) : (
          <img
            src={thumbUrl(video.rel_path)}
            alt={video.name}
            className="w-full h-full object-cover"
            loading="lazy"
            draggable={false}
            onError={() => setBroken(true)}
          />
        )}
      </div>
      <p className="text-[10px] text-muted-foreground truncate px-0.5 mt-0.5">
        {video.name}
      </p>
    </button>
  );
});
