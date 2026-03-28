import { useQueries } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/query-keys";
import type { FolderOrder } from "@/types";

export function useFolderOrders(folders: string[]) {
  const unique = [...new Set(folders.filter((f) => f.length > 0))];

  const queries = useQueries({
    queries: unique.map((fullPath) => {
      const parts = fullPath.split("/");
      const project = parts[0];
      const folder = parts.slice(1).join("/") || undefined;
      return {
        queryKey: queryKeys.folderOrder.get(project, folder),
        queryFn: () => invoke<FolderOrder>("get_folder_order", { project, folder }),
        staleTime: 30_000,
      };
    }),
  });

  const orders: Record<string, string[]> = {};
  for (let i = 0; i < unique.length; i++) {
    const data = queries[i]?.data;
    if (data?.video_order && data.video_order.length > 0) {
      orders[unique[i]] = data.video_order;
    }
  }

  const loading = queries.some((q) => q.isLoading);

  return { orders, loading };
}
