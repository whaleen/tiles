import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/api/client";
import { queryKeys } from "@/lib/query-keys";
import type { VideoInfo } from "@/types";

export function useVideoInfo(relPath: string | undefined) {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.videos.info(relPath ?? ""),
    queryFn: () =>
      apiGet<VideoInfo>(
        `/api/videos/info?path=${encodeURIComponent(relPath!)}`
      ),
    enabled: !!relPath,
    staleTime: 60_000,
  });

  return {
    ...(data ?? {}),
    loading: isLoading,
    error: error ? (error as Error).message : null,
  };
}
