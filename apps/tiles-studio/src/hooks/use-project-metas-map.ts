import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { apiGet } from "@/api/client";
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
      queryFn: () =>
        apiGet<ProjectMeta>(
          `/api/projects/${encodeURIComponent(name)}/meta`
        ),
      staleTime: 30_000,
    })),
  });

  return useMemo(() => {
    const map: Record<string, ProjectMeta> = {};
    for (let i = 0; i < projectNames.length; i++) {
      const r = results[i];
      map[projectNames[i]] = r.data ? normalizeMeta(r.data) : EMPTY_META;
    }
    return map;
  }, [projectNames, results]);
}
