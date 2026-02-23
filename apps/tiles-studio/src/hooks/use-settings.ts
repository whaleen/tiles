import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPut } from "@/api/client";
import type { TileSettings, LayoutInfo } from "@/types";

export function useSettings(project?: string) {
  const [settings, setSettings] = useState<TileSettings | null>(null);
  const [layouts, setLayouts] = useState<LayoutInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSettings = useCallback(() => {
    setLoading(true);
    const qs = project ? `?project=${encodeURIComponent(project)}` : "";
    Promise.all([
      apiGet<TileSettings>(`/api/settings${qs}`),
      apiGet<LayoutInfo[]>("/api/settings/layouts"),
    ])
      .then(([s, l]) => {
        setSettings(s);
        setLayouts(l);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [project]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  async function saveSettings(s: TileSettings, projectOverride?: string) {
    const targetProject = projectOverride ?? project;
    const qs = targetProject ? `?project=${encodeURIComponent(targetProject)}` : "";
    await apiPut(`/api/settings${qs}`, s);
    setSettings(s);
  }

  return { settings, layouts, loading, saveSettings, refresh: fetchSettings };
}
