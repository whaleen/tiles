import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/api/client";
import { queryKeys } from "@/lib/query-keys";

export function useLogs() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.logs,
    queryFn: () => apiGet<string[]>("/api/logs"),
    staleTime: 0,
  });

  return {
    logs: data ?? [],
    loading: isLoading,
    error: error ? (error as Error).message : null,
    refresh: () => queryClient.invalidateQueries({ queryKey: queryKeys.logs }),
  };
}
