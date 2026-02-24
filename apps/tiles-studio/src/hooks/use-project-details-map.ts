import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { apiGet } from "@/api/client";
import { queryKeys } from "@/lib/query-keys";
import type { ProjectDetail } from "@/types";

export function useProjectDetailsMap(projectNames: string[]) {
  const results = useQueries({
    queries: projectNames.map((name) => ({
      queryKey: queryKeys.projects.detail(name),
      queryFn: () =>
        apiGet<ProjectDetail>(
          `/api/projects/${encodeURIComponent(name)}`
        ),
      staleTime: 30_000,
    })),
  });

  return useMemo(() => {
    const map: Record<string, ProjectDetail> = {};
    for (let i = 0; i < projectNames.length; i++) {
      const r = results[i];
      if (r.data) map[projectNames[i]] = r.data;
    }
    return map;
  }, [projectNames, results]);
}
