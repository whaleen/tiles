import { useState, useRef, useCallback, useEffect, memo } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { DragEventHandler } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { thumbUrl, videoUrl } from "@/api/client";
import { Film, GripVertical, Maximize, Play, X } from "lucide-react";
import type { VideoEntry } from "@/types";

const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i;

interface VideoCardProps {
  video: VideoEntry;
  selected: boolean;
  onToggleSelect: (shiftKey?: boolean) => void;
  onClick: () => void;
  onDragStart?: DragEventHandler<HTMLDivElement>;
  onDragEnd?: DragEventHandler<HTMLDivElement>;
  dragHandleProps?: Record<string, unknown>;
  sortableStyle?: React.CSSProperties;
  sortableRef?: (node: HTMLElement | null) => void;
}

export const VideoCard = memo(function VideoCard({
  video,
  selected,
  onToggleSelect,
  onClick,
  onDragStart,
  onDragEnd,
  dragHandleProps,
  sortableStyle,
  sortableRef,
}: VideoCardProps) {
  const durationLabel = formatDuration(video.duration);
  const isImage = IMAGE_RE.test(video.rel_path);
  const [playing, setPlaying] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [thumbBroken, setThumbBroken] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const enterFullscreen = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    await getCurrentWindow().setFullscreen(true);
    setFullscreen(true);
  }, []);

  const exitFullscreen = useCallback(async () => {
    await getCurrentWindow().setFullscreen(false);
    setFullscreen(false);
  }, []);

  useEffect(() => {
    if (!fullscreen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") exitFullscreen();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [fullscreen, exitFullscreen]);

  const stopPlaying = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setPlaying(false);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.removeAttribute("src");
      videoRef.current.load();
    }
  }, []);

  return (
    <Card
      ref={sortableRef}
      style={sortableStyle}
      className={`group cursor-grab active:cursor-grabbing overflow-hidden transition-all hover:scale-[1.02] ${
        selected ? "ring-2 ring-primary" : "hover:ring-2 hover:ring-primary/50"
      }`}
      onClick={playing ? undefined : onClick}
      draggable={!playing}
      onDragStart={playing ? undefined : onDragStart}
      onDragEnd={playing ? undefined : onDragEnd}
    >
      <div className="relative aspect-video bg-muted">
        {playing ? (
          <>
            <video
              ref={videoRef}
              src={videoUrl(video.rel_path)}
              className="w-full h-full object-cover"
              controls
              autoPlay
              onEnded={() => setPlaying(false)}
            />
            <button
              className="absolute top-2 right-8 rounded-full bg-black/70 p-1 text-white hover:bg-black/90 transition-colors z-10"
              onClick={enterFullscreen}
            >
              <Maximize className="h-3.5 w-3.5" />
            </button>
            <button
              className="absolute top-2 right-2 rounded-full bg-black/70 p-1 text-white hover:bg-black/90 transition-colors z-10"
              onClick={stopPlaying}
            >
              <X className="h-3.5 w-3.5" />
            </button>
            {fullscreen && (
              <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
                <video
                  src={videoUrl(video.rel_path)}
                  controls
                  autoPlay
                  className="w-full h-full object-contain"
                />
                <button
                  className="absolute top-4 right-4 rounded-full bg-black/70 p-2 text-white hover:bg-black/90 transition-colors"
                  onClick={exitFullscreen}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            {thumbBroken ? (
              <div className="w-full h-full flex items-center justify-center">
                <Film className="h-8 w-8 text-muted-foreground/50" />
              </div>
            ) : (
              <img
                src={thumbUrl(video.rel_path)}
                alt={video.name}
                className="w-full h-full object-cover"
                loading="lazy"
                draggable={false}
                onError={() => setThumbBroken(true)}
              />
            )}
            <div
              className="absolute top-2 left-2 rounded bg-background/90 border border-muted shadow-sm p-1"
              onClick={(e) => {
                e.stopPropagation();
                onToggleSelect(e.shiftKey);
              }}
            >
              <Checkbox checked={selected} />
            </div>
            {dragHandleProps && (
              <div
                className="absolute top-2 right-2 rounded bg-background/90 border border-muted shadow-sm p-0.5 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
                draggable
                onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onClick={(e) => e.stopPropagation()}
                {...dragHandleProps}
              >
                <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
            )}
            {!isImage && (
              <button
                className="absolute bottom-2 left-2 rounded-full bg-black/70 p-1.5 text-white opacity-0 group-hover:opacity-100 hover:bg-black/90 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                  setPlaying(true);
                }}
              >
                <Play className="h-3.5 w-3.5" />
              </button>
            )}
            {durationLabel && (
              <div className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-white">
                {durationLabel}
              </div>
            )}
          </>
        )}
      </div>
      <CardContent className="p-2">
        <p className="text-xs font-medium truncate" title={video.name}>
          {video.name}
        </p>
        <Badge variant="secondary" className="text-[10px] mt-1">
          {video.folder || "root"}
        </Badge>
      </CardContent>
    </Card>
  );
});

function formatDuration(duration?: number | null) {
  if (!duration || !Number.isFinite(duration) || duration <= 0) return null;
  const totalSeconds = Math.max(0, Math.round(duration));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
