import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/query-keys";
import type { VideoInfo } from "@/types";

export function useVideoInfo(relPath: string | undefined) {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.videos.info(relPath ?? ""),
    queryFn: () => invoke<VideoInfo>("get_video_info", { path: relPath! }),
    enabled: !!relPath,
    staleTime: 60_000,
  });

  return {
    ...(data ?? {}),
    loading: isLoading,
    error: error ? (error as Error).message : null,
  };
}
