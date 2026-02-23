import { useEffect, useState, useCallback } from "react";
import { apiGet } from "@/api/client";
import type { VideoEntry } from "@/types";

export function useVideos(project?: string, search?: string) {
  const [videos, setVideos] = useState<VideoEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchVideos = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (project) params.set("project", project);
    if (search) params.set("search", search);
    const qs = params.toString();
    apiGet<VideoEntry[]>(`/api/videos${qs ? `?${qs}` : ""}`)
      .then(setVideos)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [project, search]);

  useEffect(() => {
    fetchVideos();
  }, [fetchVideos]);

  return { videos, loading, refresh: fetchVideos };
}
