import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { waveformUrl } from "@/api/client";

export interface ClipWaveform {
  /** Image URL — empty when the source has no audio stream. */
  url: string;
  /** Whether the source has an audio stream (false = silent clip). */
  hasAudio: boolean;
  width: number;
  height: number;
  duration: number;
}

interface WaveformMeta {
  has_audio: boolean;
  width: number;
  height: number;
  duration: number;
}

/**
 * Audio waveform images for the given clips. Each is rendered once by the
 * backend (ffmpeg `showwavespic`, cached) covering [0, duration] of the source
 * and served as a plain image. The audio sub-strip slices [trimIn, trimOut] per
 * clip. Clips with no audio stream are simply absent from the returned map.
 * Returns rel_path → metadata+url.
 */
export function useWaveforms(relPaths: string[]): Record<string, ClipWaveform> {
  const unique = useMemo(
    () => [...new Set(relPaths.filter(Boolean))].sort(),
    [relPaths]
  );

  const results = useQueries({
    queries: unique.map((relPath) => ({
      queryKey: ["waveform", relPath],
      queryFn: () => invoke<WaveformMeta>("get_waveform", { path: relPath }),
      staleTime: Infinity,
      retry: false,
    })),
  });

  return useMemo(() => {
    const map: Record<string, ClipWaveform> = {};
    unique.forEach((relPath, i) => {
      const m = results[i]?.data;
      // Keep both states explicit: a successful probe with no audio stream
      // (has_audio: false) is distinct from a query with no data (still loading
      // or a genuine generation failure), which stays absent from the map.
      if (m) {
        map[relPath] = {
          url: m.has_audio ? waveformUrl(relPath) : "",
          hasAudio: m.has_audio,
          width: m.width,
          height: m.height,
          duration: m.duration,
        };
      }
    });
    return map;
  }, [unique, results]);
}
