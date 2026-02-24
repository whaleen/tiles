import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/api/client";
import { queryKeys } from "@/lib/query-keys";
import type { ProjectDetail } from "@/types";

export function useProjectDetail(project?: string) {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.projects.detail(project ?? ""),
    queryFn: () =>
      apiGet<ProjectDetail>(
        `/api/projects/${encodeURIComponent(project!)}`
      ),
    enabled: !!project,
    staleTime: 30_000,
  });

  return {
    detail: data ?? null,
    loading: isLoading,
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
