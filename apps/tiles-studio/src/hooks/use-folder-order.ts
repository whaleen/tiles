import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPut } from "@/api/client";
import { queryKeys } from "@/lib/query-keys";
import type { FolderOrder } from "@/types";

export function useFolderOrder(project?: string, folder?: string) {
  const queryClient = useQueryClient();

  const enabled = !!project;
  const queryKey = queryKeys.folderOrder.get(project ?? "", folder);

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("project", project!);
      if (folder) params.set("folder", folder);
      return apiGet<FolderOrder>(`/api/folders/order?${params.toString()}`);
    },
    enabled,
    staleTime: 30_000,
  });

  async function saveOrder(newOrder: string[]) {
    if (!project) return;
    const params = new URLSearchParams();
    params.set("project", project);
    if (folder) params.set("folder", folder);
    const body: FolderOrder = { video_order: newOrder };
    await apiPut(`/api/folders/order?${params.toString()}`, body);
    queryClient.setQueryData(queryKey, body);
  }

  return {
    order: data?.video_order ?? [],
    loading: isLoading,
    saveOrder,
  };
}
