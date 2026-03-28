import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/query-keys";

export function useLogs() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.logs,
    queryFn: () => invoke<string[]>("list_logs"),
    staleTime: 0,
  });

  return {
    logs: data ?? [],
    loading: isLoading,
    error: error ? (error as Error).message : null,
    refresh: () => queryClient.invalidateQueries({ queryKey: queryKeys.logs }),
  };
}
