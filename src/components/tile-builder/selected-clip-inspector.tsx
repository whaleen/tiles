import { Scissors } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { ResolvedTimelineClip } from "@/pages/tile-builder-timeline";

const MIN_CLIP_SECONDS = 0.25;

interface SelectedClipInspectorProps {
  clip: ResolvedTimelineClip;
  onCommitTrim: (trim: { trim_in?: number | null; trim_out?: number | null }) => void;
}

function fmt(n: number): string {
  return Number(n.toFixed(2)).toString();
}

/**
 * Compact inspector for the selected timeline clip instance. Edits the clip's
 * source window (trim_in / trim_out) numerically — composition metadata only,
 * never the source media. Clamping mirrors the drag-handle trim path so the two
 * edit methods behave identically.
 */
export function SelectedClipInspector({ clip, onCommitTrim }: SelectedClipInspectorProps) {
  const source = clip.sourceSeconds;

  function commitStart(raw: string) {
    const v = parseFloat(raw);
    if (!Number.isFinite(v)) return;
    const nextIn = Math.max(0, Math.min(clip.trimOut - MIN_CLIP_SECONDS, v));
    onCommitTrim({ trim_in: nextIn <= 0.05 ? null : nextIn });
  }

  function commitEnd(raw: string) {
    const v = parseFloat(raw);
    if (!Number.isFinite(v)) return;
    const nextOut = Math.max(clip.trimIn + MIN_CLIP_SECONDS, Math.min(source, v));
    onCommitTrim({ trim_out: nextOut >= source - 0.05 ? null : nextOut });
  }

  return (
    <div className="mb-2 flex flex-wrap items-end gap-x-4 gap-y-2 rounded-md border bg-card/40 px-3 py-2 text-xs">
      <div className="flex items-center gap-1.5">
        <Scissors className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="max-w-[180px] truncate font-medium">{clip.video.name}</span>
      </div>
      <label className="flex flex-col gap-0.5">
        <span className="text-[10px] uppercase text-muted-foreground">Source start (s)</span>
        <Input
          key={`in-${clip.id}-${clip.trimIn}`}
          type="number"
          min={0}
          max={fmt(Math.max(0, clip.trimOut - MIN_CLIP_SECONDS))}
          step={0.1}
          defaultValue={fmt(clip.trimIn)}
          onBlur={(e) => commitStart(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="h-7 w-24 text-xs"
        />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-[10px] uppercase text-muted-foreground">Source end (s)</span>
        <Input
          key={`out-${clip.id}-${clip.trimOut}`}
          type="number"
          min={fmt(clip.trimIn + MIN_CLIP_SECONDS)}
          max={fmt(source)}
          step={0.1}
          defaultValue={fmt(clip.trimOut)}
          onBlur={(e) => commitEnd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="h-7 w-24 text-xs"
        />
      </label>
      <div className="flex flex-col gap-0.5 text-muted-foreground">
        <span className="text-[10px] uppercase">Source · clip</span>
        <span className="font-mono">
          {fmt(source)}s · {fmt(clip.seconds)}s
        </span>
      </div>
    </div>
  );
}
