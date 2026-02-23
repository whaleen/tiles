import type { DragEvent } from "react";
import { VideoCard } from "./video-card";
import type { VideoEntry } from "@/types";

interface VideoGridProps {
  videos: VideoEntry[];
  selectedPaths: Set<string>;
  onToggleSelect: (relPath: string) => void;
  onVideoClick: (video: VideoEntry) => void;
  onVideoDragStart?: (video: VideoEntry, event: DragEvent<HTMLDivElement>) => void;
  onVideoDragEnd?: (event: DragEvent<HTMLDivElement>) => void;
}

export function VideoGrid({
  videos,
  selectedPaths,
  onToggleSelect,
  onVideoClick,
  onVideoDragStart,
  onVideoDragEnd,
}: VideoGridProps) {
  if (videos.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
        No videos found
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
      {videos.map((v) => (
        <VideoCard
          key={v.rel_path}
          video={v}
          selected={selectedPaths.has(v.rel_path)}
          onToggleSelect={() => onToggleSelect(v.rel_path)}
          onClick={() => onVideoClick(v)}
          onDragStart={(event) => onVideoDragStart?.(v, event)}
          onDragEnd={onVideoDragEnd}
        />
      ))}
    </div>
  );
}
