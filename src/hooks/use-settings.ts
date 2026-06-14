import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/query-keys";
import type { TileSettings, LayoutInfo } from "@/types";

/**
 * The working tile-builder settings document.
 *
 * When a project AND a composition are given, this reads/writes that named
 * composition (`src/<project>/.tiles/comps/<name>.json`). Otherwise it falls back to
 * the legacy single settings file (global builder, or before a comp resolves).
 */
export function useSettings(project?: string, composition?: string | null) {
  const queryClient = useQueryClient();

  const useComp = !!project && !!composition;
  const settingsKey = useComp
    ? queryKeys.compositions.get(project!, composition!)
    : queryKeys.settings.project(project);

  const { data: settings, isLoading: settingsLoading, isFetching: settingsFetching } = useQuery({
    queryKey: settingsKey,
    queryFn: () =>
      useComp
        ? invoke<TileSettings>("get_composition", { project, name: composition })
        : invoke<TileSettings>("get_settings", { project }),
    // In project mode, wait for a composition name before loading anything.
    enabled: project ? !!composition : true,
    staleTime: 60_000,
  });

  const { data: layouts, isLoading: layoutsLoading, isFetching: layoutsFetching } = useQuery({
    queryKey: queryKeys.settings.layouts,
    queryFn: () => invoke<LayoutInfo[]>("list_layouts"),
    staleTime: 5 * 60_000,
  });

  async function saveSettings(s: TileSettings, projectOverride?: string) {
    const targetProject = projectOverride ?? project;
    // Save to the active composition when one is in play for this project.
    if (project && composition && (!projectOverride || projectOverride === project)) {
      await invoke("put_composition", { project, name: composition, settings: s });
      queryClient.setQueryData(queryKeys.compositions.get(project, composition), s);
      return;
    }
    await invoke("put_settings", { project: targetProject, settings: s });
    queryClient.setQueryData(queryKeys.settings.project(targetProject), s);
  }

  return {
    settings: settings ?? null,
    layouts: layouts ?? [],
    loading: settingsLoading || layoutsLoading,
    fetching: settingsFetching || layoutsFetching,
    saveSettings,
    refresh: () => queryClient.invalidateQueries({ queryKey: settingsKey }),
  };
}
