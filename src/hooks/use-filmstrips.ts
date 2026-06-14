import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { filmstripUrl } from "@/api/client";

export interface ClipFilmstrip {
  url: string;
  frameCount: number;
  columns: number;
  frameWidth: number;
  frameHeight: number;
  duration: number;
}

interface FilmstripMeta {
  frame_count: number;
  columns: number;
  frame_width: number;
  frame_height: number;
  duration: number;
}

/**
 * Scrub filmstrips (sprite sheets) for the given clips. Each is generated once
 * by the backend (ffmpeg, cached) and the sprite served as a plain image, so the
 * preview can blit the cell under the playhead instead of seeking a video —
 * instant, no WebKit paused-seek repaint problem. Returns rel_path → metadata+url.
 */
export function useFilmstrips(relPaths: string[]): Record<string, ClipFilmstrip> {
  const unique = useMemo(
    () => [...new Set(relPaths.filter(Boolean))].sort(),
    [relPaths]
  );

  const results = useQueries({
    queries: unique.map((relPath) => ({
      queryKey: ["filmstrip", relPath],
      queryFn: () => invoke<FilmstripMeta>("get_filmstrip", { path: relPath }),
      staleTime: Infinity,
      retry: false,
    })),
  });

  return useMemo(() => {
    const map: Record<string, ClipFilmstrip> = {};
    unique.forEach((relPath, i) => {
      const m = results[i]?.data;
      if (m && m.frame_count > 0) {
        map[relPath] = {
          url: filmstripUrl(relPath),
          frameCount: m.frame_count,
          columns: m.columns,
          frameWidth: m.frame_width,
          frameHeight: m.frame_height,
          duration: m.duration,
        };
      }
    });
    return map;
  }, [unique, results]);
}
