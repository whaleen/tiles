import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/api/client";
import { queryKeys } from "@/lib/query-keys";
import type { VideoEntry } from "@/types";

export function useVideos(project?: string, search?: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.videos.list(project, search);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: key,
    queryFn: () => {
      const params = new URLSearchParams();
      if (project) params.set("project", project);
      if (search) params.set("search", search);
      const qs = params.toString();
      return apiGet<VideoEntry[]>(`/api/videos${qs ? `?${qs}` : ""}`);
    },
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
