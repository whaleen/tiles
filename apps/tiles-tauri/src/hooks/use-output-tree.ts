import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/query-keys";
import type { OutputEntry } from "@/types";

export function useOutputTree(path: string, recursive: boolean = false) {
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: [...queryKeys.outputs.tree(path), recursive],
    queryFn: () => invoke<OutputEntry[]>("list_output_tree", { path, recursive }),
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
