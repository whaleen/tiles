import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/api/client";
import { queryKeys } from "@/lib/query-keys";
import type { ProjectSummary } from "@/types";

export function useProjects() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.projects.all,
    queryFn: () => apiGet<ProjectSummary[]>("/api/projects"),
    staleTime: 30_000,
  });

  return {
    projects: data ?? [],
    loading: isLoading,
    refresh: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all }),
  };
}
