import { useMemo, useState } from "react";
import { FileText, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { TranscriptSegment } from "@/lib/transcript";

interface TranscriptViewerProps {
  segments: TranscriptSegment[];
  /** When the format carries timestamps, clicking a segment seeks the player. */
  seekable: boolean;
  onSeek?: (seconds: number) => void;
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Read-only, searchable transcript for a single video. Clicking a (timestamped)
 * segment seeks the player to its start — display only, no timeline edits.
 */
export function TranscriptViewer({ segments, seekable, onSeek }: TranscriptViewerProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return segments;
    return segments.filter((s) => s.text.toLowerCase().includes(q));
  }, [segments, query]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <FileText className="h-3.5 w-3.5" />
        Transcript
      </div>
      <div className="relative">
        <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search transcript..."
          className="h-8 pl-7 text-xs"
        />
      </div>
      <div className="max-h-64 overflow-y-auto pr-1 text-xs leading-relaxed">
        {filtered.length === 0 ? (
          <div className="py-2 text-muted-foreground">No matching lines.</div>
        ) : (
          <ul className="space-y-0.5">
            {filtered.map((seg, i) =>
              seekable ? (
                <li key={`${seg.start}-${i}`}>
                  <button
                    type="button"
                    onClick={() => onSeek?.(seg.start)}
                    className="flex w-full gap-2 rounded px-1 py-0.5 text-left hover:bg-accent"
                    title={`Seek to ${formatTime(seg.start)}`}
                  >
                    <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
                      {formatTime(seg.start)}
                    </span>
                    <span>{seg.text}</span>
                  </button>
                </li>
              ) : (
                <li key={i} className="px-1 py-0.5 whitespace-pre-wrap break-words">
                  {seg.text}
                </li>
              )
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
