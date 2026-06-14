import { memo, useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Film } from "lucide-react";
import { thumbUrl } from "@/api/client";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { VideoEntry } from "@/types";

export type TimelineClipItem = {
  id: string;
  video: VideoEntry;
  seconds: number;
  sourceSeconds: number;
  trimIn: number;
  trimOut: number;
};

interface TileTimelineTrackProps {
  clips: TimelineClipItem[];
  /** Pixels per second — the shared time scale for the whole timeline. */
  pxPerSecond: number;
  playheadSeconds: number;
  selectedClipId?: string | null;
  transitionType: string;
  transitionSeconds: number;
  onReorder: (clipIds: string[]) => void;
  onSelectClip?: (clipId: string) => void;
  onDuplicateClip?: (clipId: string) => void;
  onDuplicateClipAt?: (clipId: string, index: number) => void;
  onRemoveClip?: (clipId: string) => void;
  onTrimClip?: (clipId: string, trim: { trim_in?: number | null; trim_out?: number | null }) => void;
  onTransitionChange?: (partial: { trans_type?: string; trans_duration?: number }) => void;
}

/**
 * A single tile's lane: clips laid out strictly by time (width = duration ×
 * pxPerSecond), so the lane shares one coordinate system with the ruler and
 * playhead. No label, scroll, or playhead of its own — those live at the
 * timeline level. Transitions are time-positioned boundary markers that don't
 * consume layout width.
 */
export const TileTimelineTrack = memo(function TileTimelineTrack({
  clips,
  pxPerSecond,
  playheadSeconds,
  selectedClipId,
  transitionType,
  transitionSeconds,
  onReorder,
  onSelectClip,
  onDuplicateClip,
  onDuplicateClipAt,
  onRemoveClip,
  onTrimClip,
  onTransitionChange,
}: TileTimelineTrackProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );
  const duplicateDragRef = useRef(false);

  function handleDragStart(event: DragStartEvent) {
    const activator = event.activatorEvent as
      | MouseEvent
      | PointerEvent
      | KeyboardEvent
      | undefined;
    duplicateDragRef.current = !!activator && "altKey" in activator && activator.altKey;
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = clips.findIndex((clip) => clip.id === active.id);
    const newIndex = clips.findIndex((clip) => clip.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    if (duplicateDragRef.current) {
      duplicateDragRef.current = false;
      onDuplicateClipAt?.(String(active.id), newIndex);
      return;
    }
    const reordered = arrayMove(clips, oldIndex, newIndex);
    onReorder(reordered.map((clip) => clip.id));
  }

  // Cumulative start time of each clip — drives active highlight and the
  // time-positioned transition markers at clip boundaries.
  const starts: number[] = [];
  let acc = 0;
  for (const clip of clips) {
    starts.push(acc);
    acc += clip.seconds;
  }

  return (
    <div className="relative h-full">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          duplicateDragRef.current = false;
        }}
      >
        <SortableContext
          items={clips.map((clip) => clip.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div className="flex h-full items-stretch py-1">
            {clips.map((clip, index) => (
              <TimelineClip
                key={clip.id}
                clip={clip}
                pxPerSecond={pxPerSecond}
                onSelect={onSelectClip}
                onDuplicate={onDuplicateClip}
                onRemove={onRemoveClip}
                onTrim={onTrimClip}
                active={
                  playheadSeconds >= starts[index] &&
                  playheadSeconds < starts[index] + clip.seconds
                }
                selected={selectedClipId === clip.id}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {clips.slice(0, -1).map((clip, index) => (
        <TransitionMarker
          key={`transition-${clip.video.rel_path}`}
          left={(starts[index] + clip.seconds) * pxPerSecond}
          type={transitionType}
          seconds={transitionSeconds}
          onChange={onTransitionChange}
        />
      ))}
    </div>
  );
});

function TimelineClip({
  clip,
  pxPerSecond,
  active,
  selected,
  onSelect,
  onDuplicate,
  onRemove,
  onTrim,
}: {
  clip: TimelineClipItem;
  pxPerSecond: number;
  active: boolean;
  selected: boolean;
  onSelect?: (clipId: string) => void;
  onDuplicate?: (clipId: string) => void;
  onRemove?: (clipId: string) => void;
  onTrim?: (clipId: string, trim: { trim_in?: number | null; trim_out?: number | null }) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: clip.id,
  });
  const [broken, setBroken] = useState(false);
  const trimDragRef = useRef<
    | { edge: "left"; startX: number; startTrimIn: number }
    | { edge: "right"; startX: number; startTrimOut: number }
    | null
  >(null);
  const width = Math.max(3, clip.seconds * pxPerSecond);
  const showLabel = width >= 54;

  function beginLeftTrim(event: React.PointerEvent<HTMLDivElement>) {
    event.stopPropagation();
    event.preventDefault();
    trimDragRef.current = { edge: "left", startX: event.clientX, startTrimIn: clip.trimIn };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function beginRightTrim(event: React.PointerEvent<HTMLDivElement>) {
    event.stopPropagation();
    event.preventDefault();
    trimDragRef.current = { edge: "right", startX: event.clientX, startTrimOut: clip.trimOut };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveTrim(event: React.PointerEvent<HTMLDivElement>) {
    const drag = trimDragRef.current;
    if (!drag) return;
    event.stopPropagation();
    const deltaSeconds = (event.clientX - drag.startX) / pxPerSecond;
    if (drag.edge === "left") {
      const nextIn = Math.max(0, Math.min(clip.trimOut - 0.25, drag.startTrimIn + deltaSeconds));
      onTrim?.(clip.id, { trim_in: nextIn <= 0.05 ? null : nextIn });
      return;
    }
    const nextOut = Math.max(
      clip.trimIn + 0.25,
      Math.min(clip.sourceSeconds, drag.startTrimOut + deltaSeconds)
    );
    onTrim?.(clip.id, { trim_out: nextOut >= clip.sourceSeconds - 0.05 ? null : nextOut });
  }

  function endTrim(event: React.PointerEvent<HTMLDivElement>) {
    if (!trimDragRef.current) return;
    event.stopPropagation();
    trimDragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // pointer capture may already be released
    }
  }

  const node = (
    <div
      ref={setNodeRef}
      style={{
        width,
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.55 : 1,
      }}
      className={`group/clip relative h-full shrink-0 cursor-grab overflow-hidden rounded border bg-background shadow-sm active:cursor-grabbing ${
        selected ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : active ? "ring-2 ring-primary/60" : ""
      }`}
      title={`${clip.video.name} · ${formatDuration(clip.seconds)}`}
      {...attributes}
      {...listeners}
      // Keep clip pointer-down from scrubbing the lane, but still start the drag.
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect?.(clip.id);
        (listeners?.onPointerDown as
          | ((ev: React.PointerEvent<HTMLDivElement>) => void)
          | undefined)?.(event);
      }}
      onClick={(event) => {
        event.stopPropagation();
        onSelect?.(clip.id);
      }}
    >
      {broken ? (
        <div className="flex h-full items-center justify-center">
          <Film className="h-4 w-4 text-muted-foreground/50" />
        </div>
      ) : (
        <img
          src={thumbUrl(clip.video.rel_path)}
          alt={clip.video.name}
          className="h-full w-full object-cover"
          draggable={false}
          onError={() => setBroken(true)}
        />
      )}
      {showLabel && (
        <>
          <div className="absolute right-0.5 top-0.5 rounded bg-black/70 px-1 font-mono text-[9px] text-white">
            {formatDuration(clip.seconds)}
          </div>
          <div className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 py-0.5 text-[9px] text-white">
            {clip.video.name}
          </div>
        </>
      )}
      {onTrim && (
        <>
          <div
            className="absolute left-0 top-0 h-full w-2 cursor-ew-resize bg-primary/0 transition-colors hover:bg-primary/30"
            title="Trim clip start"
            onPointerDown={beginLeftTrim}
            onPointerMove={moveTrim}
            onPointerUp={endTrim}
            onPointerCancel={endTrim}
          />
          <div
            className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-primary/0 transition-colors hover:bg-primary/30"
            title="Trim clip end"
            onPointerDown={beginRightTrim}
            onPointerMove={moveTrim}
            onPointerUp={endTrim}
            onPointerCancel={endTrim}
          />
        </>
      )}
    </div>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{node}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onDuplicate?.(clip.id)}>Duplicate clip</ContextMenuItem>
        <ContextMenuItem onClick={() => onRemove?.(clip.id)} className="text-destructive focus:text-destructive">
          Remove from timeline
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function TransitionMarker({
  left,
  type,
  seconds,
  onChange,
}: {
  left: number;
  type: string;
  seconds: number;
  onChange?: (partial: { trans_type?: string; trans_duration?: number }) => void;
}) {
  const isFade = type === "fade" && seconds > 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`absolute top-1/2 z-10 flex h-6 w-3.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-[9px] shadow-sm transition-colors ${
            isFade
              ? "border-primary/40 bg-primary/20 text-primary hover:bg-primary/30"
              : "border-border bg-background text-muted-foreground hover:bg-muted"
          }`}
          style={{ left }}
          title={isFade ? `Fade ${formatDuration(seconds)}` : "Hard cut"}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {isFade ? "◑" : "|"}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-48" onPointerDown={(event) => event.stopPropagation()}>
        <DropdownMenuLabel className="text-xs">Transition</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => onChange?.({ trans_type: "none", trans_duration: 0 })}>
          Cut
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onChange?.({ trans_type: "fade", trans_duration: seconds || 0.5 })}
        >
          Fade
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="px-2 pb-2">
          <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">
            Fade seconds
          </div>
          <Input
            type="number"
            min={0}
            step={0.1}
            className="h-7 text-xs"
            value={seconds || ""}
            placeholder="0.5"
            onKeyDown={(event) => event.stopPropagation()}
            onChange={(event) => {
              const next = event.target.value ? parseFloat(event.target.value) : 0;
              onChange?.({ trans_type: next > 0 ? "fade" : "none", trans_duration: next });
            }}
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
