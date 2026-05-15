import { memo, useCallback } from "react";
import type { DragEvent } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { VideoCard } from "./video-card";
import { MediaContextMenu } from "./media-context-menu";
import { Film } from "lucide-react";
import type { VideoEntry } from "@/types";

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
  onReorder?: (newOrder: string[]) => void;
  reorderEnabled?: boolean;
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
  onReorder,
  reorderEnabled = false,
}: VideoGridProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !onReorder) return;
      const oldIndex = videos.findIndex((v) => v.rel_path === active.id);
      const newIndex = videos.findIndex((v) => v.rel_path === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      const reordered = arrayMove(videos, oldIndex, newIndex);
      onReorder(reordered.map((v) => v.rel_path));
    },
    [videos, onReorder]
  );

  if (videos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
        <Film className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm">No videos in this folder</p>
      </div>
    );
  }

  if (reorderEnabled && onReorder) {
    return (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={videos.map((v) => v.rel_path)}
          strategy={rectSortingStrategy}
        >
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
            {videos.map((v) => (
              <MediaContextMenu
                key={v.rel_path}
                media={v}
                onRename={(video) => onRenameVideo?.(video)}
                onMove={(video) => onMoveVideo?.(video)}
                onDelete={(video) => onDeleteVideo?.(video)}
                onReveal={(video) => onRevealVideo?.(video)}
                disabled={!onRenameVideo && !onMoveVideo && !onDeleteVideo && !onRevealVideo}
              >
                <SortableVideoCard
                  video={v}
                  selected={selectedPaths.has(v.rel_path)}
                  onToggleSelect={(shiftKey) => onToggleSelect(v.rel_path, shiftKey)}
                  onClick={() => onVideoClick(v)}
                  onDragStart={(event) => onVideoDragStart?.(v, event)}
                  onDragEnd={onVideoDragEnd}
                />
              </MediaContextMenu>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
      {videos.map((v) => (
        <MediaContextMenu
          key={v.rel_path}
          media={v}
          onRename={(video) => onRenameVideo?.(video)}
          onMove={(video) => onMoveVideo?.(video)}
          onDelete={(video) => onDeleteVideo?.(video)}
          onReveal={(video) => onRevealVideo?.(video)}
          disabled={!onRenameVideo && !onMoveVideo && !onDeleteVideo && !onRevealVideo}
        >
          <VideoCard
            video={v}
            selected={selectedPaths.has(v.rel_path)}
            onToggleSelect={(shiftKey) => onToggleSelect(v.rel_path, shiftKey)}
            onClick={() => onVideoClick(v)}
            onDragStart={(event) => onVideoDragStart?.(v, event)}
            onDragEnd={onVideoDragEnd}
          />
        </MediaContextMenu>
      ))}
    </div>
  );
});

function SortableVideoCard({
  video,
  selected,
  onToggleSelect,
  onClick,
  onDragStart,
  onDragEnd,
}: {
  video: VideoEntry;
  selected: boolean;
  onToggleSelect: (shiftKey?: boolean) => void;
  onClick: () => void;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (event: DragEvent<HTMLDivElement>) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: video.rel_path });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <VideoCard
      video={video}
      selected={selected}
      onToggleSelect={onToggleSelect}
      onClick={onClick}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      sortableRef={setNodeRef}
      sortableStyle={style}
      dragHandleProps={{ ...attributes, ...listeners }}
    />
  );
}
