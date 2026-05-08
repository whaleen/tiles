import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/query-keys";
import type { VideoEntry } from "@/types";

type UseVideosOptions = {
  search?: string;
  folder?: string;
  recursive?: boolean;
};

export function useVideos(project?: string, options: UseVideosOptions | string = {}) {
  const queryClient = useQueryClient();
  const normalizedOptions =
    typeof options === "string" ? { search: options } : options;
  const { search, folder, recursive } = normalizedOptions;
  const key = queryKeys.videos.list(project, search, folder, recursive);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: key,
    queryFn: () =>
      invoke<VideoEntry[]>("list_videos", { project, search, folder, recursive }),
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
