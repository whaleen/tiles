import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPut } from "@/api/client";
import { queryKeys } from "@/lib/query-keys";
import type { TileSettings, LayoutInfo } from "@/types";

export function useSettings(project?: string) {
  const queryClient = useQueryClient();

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: queryKeys.settings.project(project),
    queryFn: () => {
      const qs = project ? `?project=${encodeURIComponent(project)}` : "";
      return apiGet<TileSettings>(`/api/settings${qs}`);
    },
    staleTime: 60_000,
  });

  const { data: layouts, isLoading: layoutsLoading } = useQuery({
    queryKey: queryKeys.settings.layouts,
    queryFn: () => apiGet<LayoutInfo[]>("/api/settings/layouts"),
    staleTime: 5 * 60_000,
  });

  async function saveSettings(s: TileSettings, projectOverride?: string) {
    const targetProject = projectOverride ?? project;
    const qs = targetProject
      ? `?project=${encodeURIComponent(targetProject)}`
      : "";
    await apiPut(`/api/settings${qs}`, s);
    queryClient.setQueryData(
      queryKeys.settings.project(targetProject),
      s
    );
  }

  return {
    settings: settings ?? null,
    layouts: layouts ?? [],
    loading: settingsLoading || layoutsLoading,
    saveSettings,
    refresh: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.settings.project(project),
      }),
  };
}
