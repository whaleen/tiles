import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/query-keys";
import type { OutputRun } from "@/types";

export function useOutputs(project?: string, action?: string) {
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching } = useQuery({
    queryKey: queryKeys.outputs.list(project, action),
    queryFn: () => invoke<OutputRun[]>("list_outputs", { project, action }),
    staleTime: 10_000,
  });

  return {
    outputs: data ?? [],
    loading: isLoading,
    fetching: isFetching,
    refresh: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.outputs.all }),
  };
}
