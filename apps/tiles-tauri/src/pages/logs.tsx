import { useEffect, useMemo, useState } from "react";
import { useLogs } from "@/hooks/use-logs";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCw, Search, Copy } from "lucide-react";

export function LogsPage() {
  const { logs, loading, error, refresh } = useLogs();
  const [selectedLog, setSelectedLog] = useState<string | null>(null);
  const [selectedTool, setSelectedTool] = useState<string>("all");
  const [logContent, setLogContent] = useState<string>("");
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!selectedLog) {
      setLogContent("");
      return;
    }
    setLogLoading(true);
    setLogError(null);
    invoke<string>("get_log", { filename: selectedLog })
      .then(setLogContent)
      .catch((err: unknown) => setLogError(err instanceof Error ? err.message : "Failed to load log"))
      .finally(() => setLogLoading(false));
  }, [selectedLog]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((log) => {
      if (q && !log.toLowerCase().includes(q)) return false;
      if (selectedTool === "all") return true;
      return parseLogTool(log) === selectedTool;
    });
  }, [logs, search, selectedTool]);

  const tools = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const log of logs) {
      const tool = parseLogTool(log) || "unknown";
      counts[tool] = (counts[tool] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [logs]);

  const latest = useMemo(() => {
    return [...filtered]
      .map((log) => ({ log, ts: parseLogTimestamp(log) }))
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 10);
  }, [filtered]);

  useEffect(() => {
    if (latest.length > 0) {
      setSelectedLog(latest[0].log);
    }
  }, [selectedTool, latest]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <Button size="sm" variant="outline" onClick={refresh}>
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search logs..."
          className="pl-9"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1 border rounded-lg p-4 bg-muted/20 space-y-3">
          <div className="text-sm font-semibold">Tools</div>
          {loading && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading...
            </div>
          )}
          {error && !loading && (
            <div className="text-xs text-destructive">{error}</div>
          )}
          <div className="space-y-2">
            <button
              onClick={() => setSelectedTool("all")}
              className={`w-full text-left px-2 py-2 rounded border ${
                selectedTool === "all"
                  ? "border-primary bg-primary/10"
                  : "hover:bg-accent/50"
              }`}
            >
              <div className="text-xs">All logs</div>
            </button>
            {tools.map(([tool, count]) => (
              <button
                key={tool}
                onClick={() => setSelectedTool(tool)}
                className={`w-full text-left px-2 py-2 rounded border ${
                  selectedTool === tool
                    ? "border-primary bg-primary/10"
                    : "hover:bg-accent/50"
                }`}
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="truncate">{tool}</span>
                  <span className="text-muted-foreground">{count}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-1 border rounded-lg p-4 bg-muted/20 space-y-2">
          <div className="text-sm font-semibold">Latest</div>
          {!loading && latest.length === 0 && (
            <div className="text-xs text-muted-foreground">No logs found.</div>
          )}
          <div className="space-y-2">
            {latest.map(({ log }) => (
              <button
                key={log}
                onClick={() => setSelectedLog(log)}
                className={`w-full text-left px-2 py-2 rounded border ${
                  selectedLog === log
                    ? "border-primary bg-primary/10"
                    : "hover:bg-accent/50"
                }`}
              >
                <div className="text-xs truncate">{log}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-2 border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Log Output</div>
            {selectedLog && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigator.clipboard.writeText(logContent)}
              >
                <Copy className="h-3.5 w-3.5" />
                Copy
              </Button>
            )}
          </div>
          {!selectedLog && (
            <div className="text-xs text-muted-foreground">
              Select a log to view output.
            </div>
          )}
          {selectedLog && (
            <pre className="text-[11px] bg-muted p-3 rounded max-h-[70vh] overflow-auto whitespace-pre-wrap">
              {logLoading && "Loading log..."}
              {logError && `Error: ${logError}`}
              {!logLoading && !logError && logContent}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

function parseLogTool(name: string) {
  const trimmed = name.replace(/\.log$/, "");
  if (trimmed.startsWith("studio_")) {
    const rest = trimmed.slice("studio_".length);
    const [tool] = rest.split("_run_");
    return tool;
  }
  if (trimmed.startsWith("tui_")) {
    const rest = trimmed.slice("tui_".length);
    const parts = rest.split("_");
    return parts[0];
  }
  return "unknown";
}

function parseLogTimestamp(name: string) {
  const trimmed = name.replace(/\.log$/, "");
  const match = trimmed.match(/(\d{9,})$/);
  if (!match) return 0;
  return parseInt(match[1], 10) || 0;
}
