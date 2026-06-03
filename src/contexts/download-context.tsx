import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { bumpMediaCache } from "@/api/client";
import type { UrlImportDownloadResult } from "@/types";

export interface DownloadJob {
  id: string;
  project: string;
  folder: string;
  total: number;
  completed: number;
  failed: number;
  status: "downloading" | "done" | "failed";
  startedAt: number;
}

export interface DownloadOptions {
  quality: string;
  write_subtitles: boolean;
  write_auto_captions: boolean;
  subtitle_languages: string;
  write_info_json: boolean;
  write_thumbnail: boolean;
  cookies_from_browser: string | null;
  include_images: boolean;
  tool?: string;
}

interface DownloadContextValue {
  jobs: DownloadJob[];
  enqueue: (project: string, folder: string, urls: string[], options: DownloadOptions) => void;
  dismiss: (id: string) => void;
  activeCount: number;
}

const DownloadContext = createContext<DownloadContextValue>({
  jobs: [],
  enqueue: () => {},
  dismiss: () => {},
  activeCount: 0,
});

export function useDownloads() {
  return useContext(DownloadContext);
}

export function DownloadProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<DownloadJob[]>([]);

  const enqueue = useCallback(
    (project: string, folder: string, urls: string[], options: DownloadOptions) => {
      const id = `dl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setJobs((prev) => [
        ...prev,
        { id, project, folder, total: urls.length, completed: 0, failed: 0, status: "downloading", startedAt: Date.now() },
      ]);

      void (async () => {
        for (const url of urls) {
          try {
            const result = await invoke<UrlImportDownloadResult>("download_url_import", {
              req: { project, folder, urls: [url], options },
            });
            setJobs((prev) =>
              prev.map((j) =>
                j.id === id
                  ? { ...j, completed: j.completed + result.downloaded.length, failed: j.failed + result.failures.length }
                  : j
              )
            );
          } catch {
            setJobs((prev) =>
              prev.map((j) => (j.id === id ? { ...j, failed: j.failed + 1 } : j))
            );
          }
        }
        bumpMediaCache();
        setJobs((prev) =>
          prev.map((j) =>
            j.id === id ? { ...j, status: j.completed === 0 && j.failed > 0 ? "failed" : "done" } : j
          )
        );
      })();
    },
    []
  );

  const dismiss = useCallback((id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  const activeCount = jobs.filter((j) => j.status === "downloading").length;

  return (
    <DownloadContext.Provider value={{ jobs, enqueue, dismiss, activeCount }}>
      {children}
    </DownloadContext.Provider>
  );
}
