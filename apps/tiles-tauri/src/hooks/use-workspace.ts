import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

type WorkspaceState =
  | { status: "loading" }
  | { status: "none" }
  | { status: "ready"; path: string };

export function useWorkspace() {
  const [state, setState] = useState<WorkspaceState>({ status: "loading" });

  useEffect(() => {
    invoke<string | null>("get_workspace").then((path) => {
      setState(path ? { status: "ready", path } : { status: "none" });
    });
  }, []);

  const pickWorkspace = useCallback(async () => {
    try {
      const path = await invoke<string>("pick_workspace");
      setState({ status: "ready", path });
    } catch (e) {
      if (e !== "cancelled") throw e;
    }
  }, []);

  return { state, pickWorkspace };
}
