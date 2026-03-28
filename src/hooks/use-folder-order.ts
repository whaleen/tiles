import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/query-keys";
import type { FolderOrder } from "@/types";

export function useFolderOrder(project?: string, folder?: string) {
  const queryClient = useQueryClient();

  const enabled = !!project;
  const queryKey = queryKeys.folderOrder.get(project ?? "", folder);

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => invoke<FolderOrder>("get_folder_order", { project: project!, folder }),
    enabled,
    staleTime: 30_000,
  });

  async function saveOrder(newOrder: string[]) {
    if (!project) return;
    const order: FolderOrder = { video_order: newOrder };
    await invoke("put_folder_order", { project, folder, order });
    queryClient.setQueryData(queryKey, order);
  }

  return {
    order: data?.video_order ?? [],
    loading: isLoading,
    saveOrder,
  };
}
