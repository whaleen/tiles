import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/query-keys";
import type { CompositionSummary, TileSettings } from "@/types";

/**
 * Named, reloadable tile-builder documents for a project. Owns *which*
 * composition is active and the New/Save-As/Rename/Delete plumbing; the
 * settings content of the active comp is loaded by `useSettings`.
 *
 * Only meaningful when a project is set — compositions are per-project.
 */
export function useCompositions(project?: string) {
  const queryClient = useQueryClient();
  const enabled = !!project;

  const { data, isLoading } = useQuery({
    // list_compositions also runs the one-time migration from the legacy file.
    queryKey: queryKeys.compositions.list(project ?? ""),
    queryFn: () => invoke<CompositionSummary[]>("list_compositions", { project }),
    enabled,
    staleTime: 30_000,
  });

  const compositions = data ?? [];
  const activeName =
    compositions.find((c) => c.active)?.name ?? compositions[0]?.name ?? null;

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: queryKeys.compositions.list(project ?? ""),
    });

  async function setActive(name: string) {
    if (!project) return;
    await invoke("set_active_composition", { project, name });
    await invalidate();
  }

  // New / Save As — both write a comp then switch to it. `saveAs` forks the
  // current working settings; `create` starts from a blank default.
  async function saveAs(name: string, settings: TileSettings) {
    if (!project) return;
    await invoke("put_composition", { project, name, settings });
    await invoke("set_active_composition", { project, name });
    await invalidate();
  }

  async function rename(from: string, to: string) {
    if (!project) return;
    await invoke("rename_composition", { project, from, to });
    queryClient.removeQueries({
      queryKey: queryKeys.compositions.get(project, from),
    });
    await invalidate();
  }

  async function remove(name: string) {
    if (!project) return;
    await invoke("delete_composition", { project, name });
    queryClient.removeQueries({
      queryKey: queryKeys.compositions.get(project, name),
    });
    await invalidate();
  }

  return {
    compositions,
    activeName,
    loading: isLoading,
    setActive,
    saveAs,
    rename,
    remove,
    refresh: invalidate,
  };
}
