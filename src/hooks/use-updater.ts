import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useState } from "react";

type UpdateState =
  | { status: "idle" }
  | { status: "available"; version: string; body: string | null }
  | { status: "downloading"; progress: number }
  | { status: "ready" }
  | { status: "error"; message: string };

export function useUpdater() {
  const [state, setState] = useState<UpdateState>({ status: "idle" });

  useEffect(() => {
    if (import.meta.env.DEV) return;

    check()
      .then((update) => {
        if (update?.available) {
          setState({ status: "available", version: update.version, body: update.body ?? null });
        }
      })
      .catch((e) => {
        setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
      });
  }, []);

  const install = useCallback(async () => {
    if (state.status !== "available") return;

    try {
      const update = await check();
      if (!update?.available) return;

      let downloaded = 0;
      let total = 0;

      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
          setState({ status: "downloading", progress: 0 });
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setState({ status: "downloading", progress: total > 0 ? Math.round((downloaded / total) * 100) : 0 });
        } else if (event.event === "Finished") {
          setState({ status: "ready" });
        }
      });
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [state]);

  const relaunchApp = useCallback(() => relaunch(), []);

  return { state, install, relaunchApp };
}
