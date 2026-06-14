import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

/**
 * Real per-clip durations (seconds) for the given src-relative paths.
 *
 * `list_videos` doesn't probe durations, so this is the one duration source the
 * timeline (and anything else) reads. It's a single batched call to the backend
 * `get_video_durations`, which ffprobes lazily and caches per file by mtime — so
 * each file is probed once, never the whole library. Returns a rel_path → seconds
 * map (omitting unknowns).
 */
export function useVideoDurations(relPaths: string[]) {
  const unique = useMemo(
    () => [...new Set(relPaths.filter(Boolean))].sort(),
    [relPaths]
  );

  const { data } = useQuery({
    queryKey: ["videoDurations", unique],
    queryFn: () => invoke<(number | null)[]>("get_video_durations", { paths: unique }),
    enabled: unique.length > 0,
    staleTime: 5 * 60_000,
  });

  return useMemo(() => {
    const map: Record<string, number> = {};
    if (data) {
      unique.forEach((relPath, i) => {
        const d = data[i];
        if (typeof d === "number" && Number.isFinite(d) && d > 0) {
          map[relPath] = d;
        }
      });
    }
    return map;
  }, [unique, data]);
}
