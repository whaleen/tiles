import { memo } from "react";
import type { DragEvent } from "react";
import { VideoCard } from "./video-card";
import { MediaContextMenu } from "./media-context-menu";
import { Film } from "lucide-react";
import type { VideoEntry } from "@/types";

// Browse-only masonry grid. Reordering a folder's clips lives in the timeline
// strip (FolderTimeline) — the "timeline editor mode" — not here, so the grid
// can show every clip at its true aspect without fighting drag-sort math.
interface VideoGridProps {
  videos: VideoEntry[];
  selectedPaths: Set<string>;
  onToggleSelect: (relPath: string, shiftKey?: boolean) => void;
  onVideoClick: (video: VideoEntry) => void;
  onVideoDragStart?: (video: VideoEntry, event: DragEvent<HTMLDivElement>) => void;
  onVideoDragEnd?: (event: DragEvent<HTMLDivElement>) => void;
  onRenameVideo?: (video: VideoEntry) => void;
  onMoveVideo?: (video: VideoEntry) => void;
  onDeleteVideo?: (video: VideoEntry) => void;
  onRevealVideo?: (video: VideoEntry) => void;
}

export const VideoGrid = memo(function VideoGrid({
  videos,
  selectedPaths,
  onToggleSelect,
  onVideoClick,
  onVideoDragStart,
  onVideoDragEnd,
  onRenameVideo,
  onMoveVideo,
  onDeleteVideo,
  onRevealVideo,
}: VideoGridProps) {
  if (videos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
        <Film className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm">No videos in this folder</p>
      </div>
    );
  }

  return (
    <div className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 2xl:columns-6 gap-3">
      {videos.map((v) => (
        <MediaContextMenu
          key={v.rel_path}
          media={v}
          onRename={(video) => onRenameVideo?.(video)}
          onMove={(video) => onMoveVideo?.(video)}
          onDelete={(video) => onDeleteVideo?.(video)}
          onReveal={(video) => onRevealVideo?.(video)}
          disabled={!onRenameVideo && !onMoveVideo && !onDeleteVideo && !onRevealVideo}
          wrapperClassName="mb-3 break-inside-avoid"
        >
          <VideoCard
            video={v}
            selected={selectedPaths.has(v.rel_path)}
            onToggleSelect={(shiftKey) => onToggleSelect(v.rel_path, shiftKey)}
            onClick={() => onVideoClick(v)}
            onDragStart={(event) => onVideoDragStart?.(v, event)}
            onDragEnd={onVideoDragEnd}
            naturalAspect
          />
        </MediaContextMenu>
      ))}
    </div>
  );
});
