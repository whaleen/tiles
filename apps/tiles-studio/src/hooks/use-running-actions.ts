import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/api/client";
import { queryKeys } from "@/lib/query-keys";
import type { RunningAction } from "@/types";

export function useRunningActions(pollMs = 2500) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.actions.running,
    queryFn: () => apiGet<RunningAction[]>("/api/actions/running"),
    refetchInterval: pollMs,
    staleTime: 0,
  });

  return {
    running: data ?? [],
    loading: isLoading,
    refresh: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.actions.running }),
  };
}
