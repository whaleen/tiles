import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/query-keys";
import type { ProjectSummary } from "@/types";

export function useProjects() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.projects.all,
    queryFn: () => invoke<ProjectSummary[]>("list_projects"),
    staleTime: 30_000,
  });

  return {
    projects: data ?? [],
    loading: isLoading,
    refresh: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all }),
  };
}
