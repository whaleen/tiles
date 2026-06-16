import { memo } from "react";
import type { TimelineClipItem } from "./tile-timeline-track";
import type { ClipWaveform } from "@/hooks/use-waveforms";

interface TileAudioTrackProps {
  clips: TimelineClipItem[];
  /** Pixels per second — the same time scale as the video track above. */
  pxPerSecond: number;
  /** rel_path → waveform image. Missing entry = clip has no audio stream. */
  waveforms: Record<string, ClipWaveform>;
}

/**
 * Read-only audio sub-strip mirroring a tile's video clips. Each clip block is
 * laid out flush at the same width as its video clip (clip.seconds × px), so the
 * two lanes share one time axis. The cached waveform image spans the clip's full
 * source [0, duration]; here we slice [trimIn, trimOut] and scale it to fill the
 * block, independent of any playback-rate change applied to the clip.
 */
export const TileAudioTrack = memo(function TileAudioTrack({
  clips,
  pxPerSecond,
  waveforms,
}: TileAudioTrackProps) {
  return (
    <div className="flex h-full items-stretch py-1">
      {clips.map((clip) => {
        const clipW = Math.max(3, clip.seconds * pxPerSecond);
        const wf = waveforms[clip.video.rel_path];
        // Span of source audio this clip shows, and where it sits in the image.
        const visibleSpan = Math.max(0.001, clip.trimOut - clip.trimIn);
        const fullDuration = wf ? Math.max(0.001, wf.duration) : 1;
        const scaledFull = clipW * (fullDuration / visibleSpan);
        const offsetX = -(clip.trimIn / fullDuration) * scaledFull;
        return (
          <div
            key={clip.id}
            className="relative h-full shrink-0 overflow-hidden rounded border border-border/40 bg-muted/10"
            style={{ width: clipW }}
            title={wf ? clip.video.name : `${clip.video.name} · no audio`}
          >
            {wf ? (
              <img
                src={wf.url}
                draggable={false}
                alt=""
                className="pointer-events-none absolute left-0 top-0 h-full max-w-none opacity-80"
                style={{ width: scaledFull, transform: `translateX(${offsetX}px)` }}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-[9px] text-muted-foreground/50">
                no audio
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});
