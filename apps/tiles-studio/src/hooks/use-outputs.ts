import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/api/client";
import { queryKeys } from "@/lib/query-keys";
import type { OutputRun } from "@/types";

export function useOutputs(project?: string, action?: string) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.outputs.list(project, action),
    queryFn: () => {
      const params = new URLSearchParams();
      if (project) params.set("project", project);
      if (action) params.set("action", action);
      const qs = params.toString();
      return apiGet<OutputRun[]>(`/api/outputs${qs ? `?${qs}` : ""}`);
    },
    staleTime: 10_000,
  });

  return {
    outputs: data ?? [],
    loading: isLoading,
    refresh: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.outputs.all }),
  };
}
