import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/api/client";
import { queryKeys } from "@/lib/query-keys";
import type { ActionInfo } from "@/types";

export function useActions() {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.actions.all,
    queryFn: () => apiGet<ActionInfo[]>("/api/actions"),
    staleTime: 60_000,
  });

  return {
    actions: data ?? [],
    loading: isLoading,
    error: error ? (error as Error).message : null,
  };
}
