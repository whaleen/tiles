import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/query-keys";
import type { ActionInfo } from "@/types";

export function useActions() {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.actions.all,
    queryFn: () => invoke<ActionInfo[]>("list_actions"),
    staleTime: 60_000,
  });

  return {
    actions: data ?? [],
    loading: isLoading,
    error: error ? (error as Error).message : null,
  };
}
