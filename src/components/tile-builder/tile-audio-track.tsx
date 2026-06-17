import { memo } from "react";
import { AudioLines } from "lucide-react";
import {
  clipPixelWidth,
  type ResolvedTimelineClip,
} from "@/pages/tile-builder-timeline";
import type { ClipWaveform } from "@/hooks/use-waveforms";

interface TileAudioTrackProps {
  /** Resolved clips from the shared timeline resolver — same objects the video
   *  track, preview, and render consume. */
  clips: ResolvedTimelineClip[];
  /** Pixels per second — the same time scale as the video track above. */
  pxPerSecond: number;
  /** rel_path → waveform asset (source-owned). Absent = still loading/failed;
   *  present with hasAudio false = source has no audio stream. */
  waveforms: Record<string, ClipWaveform>;
}

/**
 * Display-only audio sub-strip mirroring a tile's video clips. Geometry comes
 * entirely from the shared resolver: block width is `clipPixelWidth` (the same
 * width the video clip uses, already speed-adjusted), and the waveform is
 * sliced to the clip's resolved source window [sourceStart, sourceEnd] — which
 * already accounts for trim and per-clip max-duration capping — scaled to fill
 * the block. Because width is timeline-time and the window is source-time, this
 * stays correct when a clip's speed makes the two differ.
 *
 * Static by construction: depends only on clips, scale, and the source-owned
 * waveform assets — never on the per-frame playhead.
 */
export const TileAudioTrack = memo(function TileAudioTrack({
  clips,
  pxPerSecond,
  waveforms,
}: TileAudioTrackProps) {
  return (
    <div className="flex h-full items-stretch py-1">
      {clips.map((clip) => {
        const clipW = clipPixelWidth(clip, pxPerSecond);
        const wf = waveforms[clip.relPath];
        // The cached waveform image spans the full source [0, sourceSeconds].
        // Show the resolved [sourceStart, sourceEnd] window scaled to fill clipW.
        const fullDuration = Math.max(0.001, clip.sourceSeconds);
        const windowSpan = Math.max(0.001, clip.sourceEnd - clip.sourceStart);
        const scaledFull = clipW * (fullDuration / windowSpan);
        const offsetX = -(clip.sourceStart / fullDuration) * scaledFull;
        const hasWaveform = wf?.hasAudio && wf.url;
        const noAudio = wf && !wf.hasAudio;
        return (
          <div
            key={clip.id}
            className="relative h-full shrink-0 overflow-hidden rounded border border-border/40 bg-muted/10"
            style={{ width: clipW }}
            title={noAudio ? `${clip.video.name} · no audio` : clip.video.name}
          >
            {hasWaveform ? (
              <img
                src={wf.url}
                draggable={false}
                alt=""
                className="pointer-events-none absolute left-0 top-0 h-full max-w-none opacity-80"
                style={{ width: scaledFull, transform: `translateX(${offsetX}px)` }}
              />
            ) : noAudio ? (
              <div className="flex h-full items-center justify-center gap-1 text-[9px] text-muted-foreground/50">
                <AudioLines className="h-3 w-3 opacity-40" />
                no audio
              </div>
            ) : (
              // Still loading (or generation failed): stay quiet, never a broken image.
              <div className="h-full w-full" />
            )}
          </div>
        );
      })}
    </div>
  );
});
