import { useCallback, useEffect, useState } from "react";
import { apiGet } from "@/api/client";
import type { OutputEntry } from "@/types";

export function useOutputTree(path: string) {
  const [entries, setEntries] = useState<OutputEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEntries = useCallback(() => {
    setLoading(true);
    setError(null);
    const qs = path ? `?path=${encodeURIComponent(path)}` : "";
    apiGet<OutputEntry[]>(`/api/outputs/tree${qs}`)
      .then(setEntries)
      .catch((err) => setError(err.message || "Failed to load outputs"))
      .finally(() => setLoading(false));
  }, [path]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  return { entries, loading, error, refresh: fetchEntries };
}
