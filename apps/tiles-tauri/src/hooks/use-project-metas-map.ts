import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/query-keys";
import type { ProjectMeta } from "@/types";

const EMPTY_META: ProjectMeta = {
  display_name: null,
  cover_image_rel: null,
  description: null,
  tags: [],
};

function normalizeMeta(meta: ProjectMeta | null | undefined): ProjectMeta {
  return {
    display_name: meta?.display_name || null,
    cover_image_rel: meta?.cover_image_rel || null,
    description: meta?.description || null,
    tags: meta?.tags || [],
  };
}

export function useProjectMetasMap(projectNames: string[]) {
  const results = useQueries({
    queries: projectNames.map((name) => ({
      queryKey: queryKeys.projects.meta(name),
      queryFn: () => invoke<ProjectMeta>("get_project_meta", { name }),
      staleTime: 30_000,
    })),
  });

  const map = useMemo(() => {
    const m: Record<string, ProjectMeta> = {};
    for (let i = 0; i < projectNames.length; i++) {
      const r = results[i];
      m[projectNames[i]] = r.data ? normalizeMeta(r.data) : EMPTY_META;
    }
    return m;
  }, [projectNames, results]);

  const loading = results.some((r) => r.isLoading);

  return { map, loading };
}
