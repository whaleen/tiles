import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/api/client";
import { queryKeys } from "@/lib/query-keys";
import type { OutputEntry } from "@/types";

export function useOutputTree(path: string) {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.outputs.tree(path),
    queryFn: () => {
      const qs = path ? `?path=${encodeURIComponent(path)}` : "";
      return apiGet<OutputEntry[]>(`/api/outputs/tree${qs}`);
    },
    staleTime: 10_000,
  });

  return {
    entries: data ?? [],
    loading: isLoading,
    error: error ? (error as Error).message : null,
    refresh: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.outputs.all }),
  };
}
