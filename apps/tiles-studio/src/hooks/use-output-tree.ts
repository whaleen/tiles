import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/api/client";
import { queryKeys } from "@/lib/query-keys";
import type { OutputEntry } from "@/types";

export function useOutputTree(path: string, recursive: boolean = false) {
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: [...queryKeys.outputs.tree(path), recursive],
    queryFn: () => {
      const params = new URLSearchParams();
      if (path) params.append("path", path);
      if (recursive) params.append("recursive", "true");
      
      const qs = params.toString() ? `?${params.toString()}` : "";
      return apiGet<OutputEntry[]>(`/api/outputs/tree${qs}`);
    },
    staleTime: 10_000,
  });

  return {
    entries: data ?? [],
    loading: isLoading,
    fetching: isFetching,
    error: error ? (error as Error).message : null,
    refresh: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.outputs.all }),
  };
}
