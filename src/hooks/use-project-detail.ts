import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/query-keys";
import type { ProjectDetail } from "@/types";

export function useProjectDetail(project?: string) {
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: queryKeys.projects.detail(project ?? ""),
    queryFn: () => invoke<ProjectDetail>("get_project", { name: project! }),
    enabled: !!project,
    staleTime: 30_000,
  });

  return {
    detail: data ?? null,
    loading: isLoading,
    fetching: isFetching,
    error: error ? (error as Error).message : null,
    refresh: () => {
      if (project) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.projects.detail(project),
        });
      }
    },
  };
}
