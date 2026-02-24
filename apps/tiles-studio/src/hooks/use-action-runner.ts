import { useMemo, useRef, useState } from "react";
import { apiPost } from "@/api/client";
import { queryClient } from "@/lib/query-client";
import { queryKeys } from "@/lib/query-keys";
import type { ActionRunRequest, ActionRunResult } from "@/types";

export function useActionRunner(scopeKey = "__default__") {
  const [runningCount, setRunningCount] = useState(0);
  const [result, setResult] = useState<ActionRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeScopeRef = useRef<string | null>(null);
  const requestSeqRef = useRef(0);

  async function runAction(req: ActionRunRequest) {
    const requestId = ++requestSeqRef.current;
    activeScopeRef.current = scopeKey;
    setRunningCount((prev) => prev + 1);
    setResult(null);
    setError(null);
    try {
      const res = await apiPost<ActionRunResult>("/api/actions/run", req);
      if (requestId === requestSeqRef.current) {
        setResult(res);
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.actions.running });
      queryClient.invalidateQueries({ queryKey: queryKeys.outputs.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.videos.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.logs });
      playPing();
      return res;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      if (requestId === requestSeqRef.current) {
        setError(msg);
      }
      return null;
    } finally {
      setRunningCount((prev) => Math.max(0, prev - 1));
    }
  }

  const running = useMemo(
    () => runningCount > 0 && activeScopeRef.current === scopeKey,
    [runningCount, scopeKey]
  );

  return { running, result, error, runAction };
}

function playPing() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
    osc.stop(ctx.currentTime + 0.22);
    osc.onended = () => {
      ctx.close().catch(() => undefined);
    };
  } catch {
    // ignore audio errors
  }
}
