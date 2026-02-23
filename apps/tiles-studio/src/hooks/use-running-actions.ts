import { useCallback, useEffect, useState } from "react";
import { apiGet } from "@/api/client";
import type { RunningAction } from "@/types";

export function useRunningActions(pollMs = 2500) {
  const [running, setRunning] = useState<RunningAction[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRunning = useCallback(() => {
    setLoading(true);
    apiGet<RunningAction[]>("/api/actions/running")
      .then(setRunning)
      .catch(() => setRunning([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchRunning();
    const id = window.setInterval(fetchRunning, pollMs);
    return () => window.clearInterval(id);
  }, [fetchRunning, pollMs]);

  return { running, loading, refresh: fetchRunning };
}
