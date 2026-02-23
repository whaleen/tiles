import { useEffect, useState, useCallback } from "react";
import { apiGet } from "@/api/client";
import type { ProjectDetail } from "@/types";

export function useProjectDetail(project?: string) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = useCallback(() => {
    if (!project) {
      setDetail(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    apiGet<ProjectDetail>(`/api/projects/${encodeURIComponent(project)}`)
      .then(setDetail)
      .catch((err) => setError(err.message || "Failed to load project"))
      .finally(() => setLoading(false));
  }, [project]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  return { detail, loading, error, refresh: fetchDetail };
}
