import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/query-keys";
import type { RunningAction } from "@/types";

export function useRunningActions(pollMs = 2500) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.actions.running,
    queryFn: () => invoke<RunningAction[]>("list_running_actions"),
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
