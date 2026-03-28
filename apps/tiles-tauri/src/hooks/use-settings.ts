import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/query-keys";
import type { TileSettings, LayoutInfo } from "@/types";

export function useSettings(project?: string) {
  const queryClient = useQueryClient();

  const { data: settings, isLoading: settingsLoading, isFetching: settingsFetching } = useQuery({
    queryKey: queryKeys.settings.project(project),
    queryFn: () => invoke<TileSettings>("get_settings", { project }),
    staleTime: 60_000,
  });

  const { data: layouts, isLoading: layoutsLoading, isFetching: layoutsFetching } = useQuery({
    queryKey: queryKeys.settings.layouts,
    queryFn: () => invoke<LayoutInfo[]>("list_layouts"),
    staleTime: 5 * 60_000,
  });

  async function saveSettings(s: TileSettings, projectOverride?: string) {
    const targetProject = projectOverride ?? project;
    await invoke("put_settings", { project: targetProject, settings: s });
    queryClient.setQueryData(
      queryKeys.settings.project(targetProject),
      s
    );
  }

  return {
    settings: settings ?? null,
    layouts: layouts ?? [],
    loading: settingsLoading || layoutsLoading,
    fetching: settingsFetching || layoutsFetching,
    saveSettings,
    refresh: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.settings.project(project),
      }),
  };
}
