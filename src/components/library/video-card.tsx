import { useState, useRef, useCallback, useEffect, memo } from "react";
import type { DragEventHandler } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { thumbUrl, videoUrl } from "@/api/client";
import { FileText, Film, GripVertical, Play } from "lucide-react";
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
  const [thumbBroken, setThumbBroken] = useState(false);
  const [hoveringPreview, setHoveringPreview] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [previewTime, setPreviewTime] = useState<number | null>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const seekRafRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (seekRafRef.current !== null) cancelAnimationFrame(seekRafRef.current);
    };
  }, []);

  const handlePreviewMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (isImage) return;
    const videoEl = previewRef.current;
    if (!videoEl || !Number.isFinite(videoEl.duration) || videoEl.duration <= 0) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const nextTime = pct * videoEl.duration;
    setPreviewTime(nextTime);

    if (seekRafRef.current !== null) cancelAnimationFrame(seekRafRef.current);
    seekRafRef.current = requestAnimationFrame(() => {
      if (previewRef.current) previewRef.current.currentTime = nextTime;
    });
  }, [isImage]);

  const handlePreviewLeave = useCallback(() => {
    setHoveringPreview(false);
    setPreviewTime(null);
  }, []);

  return (
    <Card
      ref={sortableRef}
      style={sortableStyle}
      className={`group cursor-grab active:cursor-grabbing overflow-hidden rounded-none border-0 p-0 transition-all hover:scale-[1.02] ${
        selected ? "ring-2 ring-primary" : "hover:ring-2 hover:ring-primary/50"
      }`}
      onClick={onClick}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div
        className="relative aspect-video bg-muted"
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onMouseEnter={() => {
          if (!isImage) setHoveringPreview(true);
        }}
        onMouseMove={handlePreviewMove}
        onMouseLeave={handlePreviewLeave}
      >
        {thumbBroken ? (
          <div className="w-full h-full flex items-center justify-center">
            <Film className="h-8 w-8 text-muted-foreground/50" />
          </div>
        ) : (
          <>
            <img
              src={thumbUrl(video.rel_path)}
              alt={video.name}
              className={`w-full h-full object-cover ${hoveringPreview && previewReady ? "opacity-0" : "opacity-100"}`}
              loading="lazy"
              draggable={false}
              onError={() => setThumbBroken(true)}
            />
            {!isImage && hoveringPreview && (
              <video
                ref={previewRef}
                src={videoUrl(video.rel_path)}
                className={`absolute inset-0 w-full h-full object-cover pointer-events-none ${previewReady ? "opacity-100" : "opacity-0"}`}
                muted
                playsInline
                preload="metadata"
                draggable={false}
                onLoadedMetadata={() => {
                  setPreviewReady(true);
                  if (previewRef.current) previewRef.current.currentTime = 0;
                }}
                onError={() => setPreviewReady(false)}
              />
            )}
          </>
        )}
        {previewTime !== null && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-white">
            {formatDuration(previewTime)}
          </div>
        )}
        <div
          className="absolute top-2 left-2 rounded bg-background/90 border border-muted shadow-sm p-1"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(e.shiftKey);
          }}
          onDragStart={(e) => e.stopPropagation()}
        >
          <Checkbox checked={selected} />
        </div>
        {dragHandleProps && (
          <div
            className="absolute top-2 right-2 rounded bg-background/90 border border-muted shadow-sm p-0.5 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => e.stopPropagation()}
            {...dragHandleProps}
          >
            <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
        )}
        {!isImage && (
          <div className="absolute bottom-2 left-2 rounded-full bg-black/70 p-1.5 text-white opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            <Play className="h-3.5 w-3.5" />
          </div>
        )}
        {video.has_transcript && (
          <div className="absolute bottom-2 left-2 rounded bg-black/75 p-1" title="Transcript available">
            <FileText className="h-3 w-3 text-white" />
          </div>
        )}
        {durationLabel && previewTime === null && (
          <div className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-white">
            {durationLabel}
          </div>
        )}
      </div>
      <CardContent className="p-2">
        <p className="text-xs font-medium truncate" title={video.name}>
          {video.name}
        </p>
        <div className="mt-1 flex items-center gap-1.5 min-w-0">
          <Badge variant="secondary" className="max-w-full truncate text-[10px]">
            {video.folder || "root"}
          </Badge>
          {durationLabel && (
            <Badge variant="outline" className="shrink-0 text-[10px] font-mono">
              {durationLabel}
            </Badge>
          )}
        </div>
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
