import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

type WorkspaceState =
  | { status: "loading" }
  | { status: "none" }
  | { status: "ready"; path: string };

export function useWorkspace() {
  const [state, setState] = useState<WorkspaceState>({ status: "loading" });
  const queryClient = useQueryClient();

  useEffect(() => {
    invoke<string | null>("get_workspace").then((path) => {
      setState(path ? { status: "ready", path } : { status: "none" });
    });
  }, []);

  const pickWorkspace = useCallback(async () => {
    try {
      const path = await invoke<string>("pick_workspace");
      queryClient.invalidateQueries();
      setState({ status: "ready", path });
    } catch (e) {
      if (e !== "cancelled") throw e;
    }
  }, [queryClient]);

  const confirmWorkspace = useCallback((path: string) => {
    queryClient.invalidateQueries();
    setState({ status: "ready", path });
  }, [queryClient]);

  return { state, pickWorkspace, confirmWorkspace };
}
