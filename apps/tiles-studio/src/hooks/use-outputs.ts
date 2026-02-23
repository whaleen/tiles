import { useEffect, useState, useCallback } from "react";
import { apiGet } from "@/api/client";
import type { OutputRun } from "@/types";

export function useOutputs(project?: string, action?: string) {
  const [outputs, setOutputs] = useState<OutputRun[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchOutputs = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (project) params.set("project", project);
    if (action) params.set("action", action);
    const qs = params.toString();
    apiGet<OutputRun[]>(`/api/outputs${qs ? `?${qs}` : ""}`)
      .then(setOutputs)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [project, action]);

  useEffect(() => {
    fetchOutputs();
  }, [fetchOutputs]);

  return { outputs, loading, refresh: fetchOutputs };
}
