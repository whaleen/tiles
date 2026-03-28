import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/query-keys";
import type { VideoEntry } from "@/types";

export function useVideos(project?: string, search?: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.videos.list(project, search);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: key,
    queryFn: () => invoke<VideoEntry[]>("list_videos", { project, search }),
    staleTime: 10_000,
  });

  const removeVideo = useCallback(
    (relPath: string) => {
      queryClient.setQueryData<VideoEntry[]>(key, (prev) =>
        prev ? prev.filter((v) => v.rel_path !== relPath) : []
      );
    },
    [queryClient, key]
  );

  return {
    videos: data ?? [],
    loading: isLoading,
    fetching: isFetching,
    refresh: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.videos.all }),
    removeVideo,
  };
}
