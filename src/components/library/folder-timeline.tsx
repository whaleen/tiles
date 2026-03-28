import { memo, useState } from "react";
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
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { thumbUrl } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Film, Play } from "lucide-react";
import type { VideoEntry } from "@/types";

interface FolderTimelineProps {
  videos: VideoEntry[];
  onReorder: (newOrder: string[]) => void;
  onPreview?: () => void;
}

export const FolderTimeline = memo(function FolderTimeline({
  videos,
  onReorder,
  onPreview,
}: FolderTimelineProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const totalDuration = videos.reduce(
    (sum, v) => sum + (v.duration && Number.isFinite(v.duration) ? v.duration : 0),
    0
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = videos.findIndex((v) => v.name === active.id);
    const newIndex = videos.findIndex((v) => v.name === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(videos, oldIndex, newIndex);
    onReorder(reordered.map((v) => v.name));
  }

  if (videos.length === 0) return null;

  return (
    <div className="border rounded-lg bg-muted/20 p-2">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={videos.map((v) => v.name)}
          strategy={horizontalListSortingStrategy}
        >
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {videos.map((v) => (
              <TimelineItem key={v.name} video={v} />
            ))}
            <div className="shrink-0 flex items-center gap-1.5 pl-2 text-[10px] text-muted-foreground font-medium whitespace-nowrap">
              {formatTotalDuration(totalDuration)}
              {onPreview && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-[10px]"
                  onClick={onPreview}
                  title="Preview sequence"
                >
                  <Play className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
});

function TimelineItem({ video }: { video: VideoEntry }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: video.name });
  const [thumbBroken, setThumbBroken] = useState(false);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const durationLabel = formatClipDuration(video.duration);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="shrink-0 w-[120px] cursor-grab active:cursor-grabbing group/item"
      title={video.name}
    >
      <div className="relative aspect-video rounded overflow-hidden bg-muted hover:scale-105 transition-transform">
        {thumbBroken ? (
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
            onError={() => setThumbBroken(true)}
          />
        )}
        {durationLabel && (
          <div className="absolute bottom-0.5 right-0.5 rounded bg-black/75 px-1 py-px text-[9px] font-medium text-white">
            {durationLabel}
          </div>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground truncate mt-0.5 px-0.5">
        {video.name}
      </p>
    </div>
  );
}

function formatClipDuration(duration?: number | null) {
  if (!duration || !Number.isFinite(duration) || duration <= 0) return null;
  const totalSeconds = Math.max(0, Math.round(duration));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatTotalDuration(seconds: number) {
  if (seconds <= 0) return "";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `Total: ${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `Total: ${m}:${String(s).padStart(2, "0")}`;
}
