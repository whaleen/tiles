import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { waveformUrl } from "@/api/client";

export interface ClipWaveform {
  url: string;
  width: number;
  height: number;
  duration: number;
}

interface WaveformMeta {
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
      if (m && m.width > 0) {
        map[relPath] = {
          url: waveformUrl(relPath),
          width: m.width,
          height: m.height,
          duration: m.duration,
        };
      }
    });
    return map;
  }, [unique, results]);
}
