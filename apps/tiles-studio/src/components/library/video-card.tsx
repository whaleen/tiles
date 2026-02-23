import type { DragEventHandler } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { thumbUrl } from "@/api/client";
import type { VideoEntry } from "@/types";

interface VideoCardProps {
  video: VideoEntry;
  selected: boolean;
  onToggleSelect: () => void;
  onClick: () => void;
  onDragStart?: DragEventHandler<HTMLDivElement>;
  onDragEnd?: DragEventHandler<HTMLDivElement>;
}

export function VideoCard({
  video,
  selected,
  onToggleSelect,
  onClick,
  onDragStart,
  onDragEnd,
}: VideoCardProps) {
  const durationLabel = formatDuration(video.duration);

  return (
    <Card
      className={`group cursor-pointer overflow-hidden transition-all ${
        selected ? "ring-2 ring-primary" : "hover:ring-2 hover:ring-primary/50"
      }`}
      onClick={onClick}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="relative aspect-video bg-muted">
        <img
          src={thumbUrl(video.rel_path)}
          alt={video.name}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
        <div
          className="absolute top-2 left-2 rounded bg-background/90 border border-muted shadow-sm p-1"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
        >
          <Checkbox checked={selected} />
        </div>
        {durationLabel && (
          <div className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-white">
            {durationLabel}
          </div>
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
}

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
