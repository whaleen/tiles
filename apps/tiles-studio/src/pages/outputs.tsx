import { useMemo, useState } from "react";
import { useOutputTree } from "@/hooks/use-output-tree";
import { apiDelete, outThumbUrl, outVideoUrl } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useRunningActions } from "@/hooks/use-running-actions";
import {
  Film,
  RefreshCw,
  Trash2,
  Search,
  Loader2,
  Play,
  Calendar,
  Tag,
  Clock,
} from "lucide-react";
import { getActionIcon, formatActionName } from "@/lib/action-icons";
import { toast } from "sonner";
import type { OutputEntry } from "@/types";

export function OutputsPage({ project }: { project?: string }) {
  const [search, setSearch] = useState("");
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<OutputEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { running: runningActions } = useRunningActions();

  // The main navigation controls the context (Project vs Global)
  const rootPath = project ? `src/${project}/outputs` : "outputs";
  
  // Fetch ALL videos recursively for the active context
  const {
    entries: allFiles,
    loading,
    error,
    refresh,
  } = useOutputTree(rootPath, true);

  // Filter logic
  const filteredFiles = useMemo(() => {
    let list = allFiles;
    
    // 1. Filter out files that are currently being written to (active runs)
    // We check if the rel_path of a file matches any active run's output path
    const activeOutputs = new Set(runningActions.map(r => r.output).filter(Boolean));
    list = list.filter(file => !activeOutputs.has(file.rel_path));

    // 2. Tool Filter
    if (activeTool) {
      list = list.filter(file => {
        const tool = getToolFromPath(file.rel_path);
        return tool === activeTool;
      });
    }

    // 3. Search Filter
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(file => file.name.toLowerCase().includes(q));
    }

    return list;
  }, [allFiles, activeTool, search, runningActions]);

  // Relevant active runs for this context
  const visibleRunning = useMemo(() => {
    if (!project) return runningActions.filter(r => !r.project || r.output_mode === 'global');
    return runningActions.filter(r => r.project === project);
  }, [runningActions, project]);

  // Extract unique tools from the actual files for the filter bar
  const tools = useMemo(() => {
    const set = new Set<string>();
    allFiles.forEach(file => {
      const tool = getToolFromPath(file.rel_path);
      if (tool) set.add(tool);
    });
    return Array.from(set).sort();
  }, [allFiles]);

  const handleDelete = async (file: OutputEntry) => {
    if (!window.confirm(`Delete ${file.name}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/outputs/${encodeURIComponent(file.rel_path).replace(/%2F/g, "/")}`);
      if (selectedFile?.rel_path === file.rel_path) setSelectedFile(null);
      refresh();
      toast.success("Deleted", { description: file.name });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col h-full space-y-4 overflow-hidden">
      {/* Active Renders Banner */}
      {visibleRunning.length > 0 && (
        <div className="bg-primary/5 border-primary/20 border-2 rounded-xl p-4 animate-in slide-in-from-top-2">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-primary">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm font-bold uppercase tracking-wider">Active Renders</span>
            </div>
            <Badge variant="default" className="rounded-full">{visibleRunning.length} Processing</Badge>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {visibleRunning.map(run => {
              const Icon = getActionIcon(run.action);
              return (
                <div key={run.id} className="bg-background border rounded-lg p-3 flex items-center gap-3 shadow-sm">
                  <div className="bg-primary/10 p-2 rounded-lg">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold truncate">{formatActionName(run.action)}</div>
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Clock className="h-2.5 w-2.5" />
                      Started {timeAgo(run.started_epoch)}
                    </div>
                  </div>
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold tracking-tight">
            {project ? `${project} Outputs` : "Global Outputs"}
          </h1>
          <Badge variant="outline" className="text-xs font-mono">
            {filteredFiles.length} files
          </Badge>
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name..."
              className="pl-9 h-9"
            />
          </div>
          <Button size="sm" variant="outline" onClick={() => refresh()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Tool Filter Bar */}
      {tools.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
          <Button
            size="sm"
            variant={activeTool === null ? "default" : "outline"}
            className="rounded-full px-4 h-8"
            onClick={() => setActiveTool(null)}
          >
            All
          </Button>
          {tools.map(tool => {
            const Icon = getActionIcon(tool);
            return (
              <Button
                key={tool}
                size="sm"
                variant={activeTool === tool ? "default" : "outline"}
                className="rounded-full px-4 h-8 gap-1.5"
                onClick={() => setActiveTool(tool)}
              >
                <Icon className="h-3.5 w-3.5" />
                {formatActionName(tool)}
              </Button>
            );
          })}
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden min-h-0">
        {loading && allFiles.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin opacity-40" />
            <p className="text-sm">Scanning for outputs...</p>
          </div>
        ) : error ? (
          <div className="h-64 flex flex-col items-center justify-center text-destructive p-4 text-center">
            <p className="font-semibold">Failed to load outputs</p>
            <p className="text-sm opacity-80">{error}</p>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center gap-2 text-muted-foreground bg-muted/10 border-2 border-dashed rounded-xl">
            <Film className="h-10 w-10 opacity-20" />
            <p className="text-sm font-medium">No outputs found</p>
            <p className="text-xs opacity-60">Try changing your filters or running a new action.</p>
          </div>
        ) : (
          <div className="h-full overflow-y-auto pr-2 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 pb-10">
            {filteredFiles.map((file) => (
              <OutputCard 
                key={file.rel_path} 
                file={file} 
                isSelected={selectedFile?.rel_path === file.rel_path}
                onSelect={() => setSelectedFile(file)}
                onDelete={() => handleDelete(file)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Detail Overlay / Dialog can be added here for full-screen preview */}
      {selectedFile && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4 animate-in fade-in"
          onClick={() => setSelectedFile(null)}
        >
          <div 
            className="bg-card border rounded-xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4 border-b flex items-center justify-between bg-muted/20">
              <div className="min-w-0">
                <h3 className="text-lg font-bold truncate leading-tight">{selectedFile.name}</h3>
                <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {new Date(selectedFile.modified_epoch * 1000).toLocaleString()}
                  </span>
                  <span className="flex items-center gap-1">
                    <Tag className="h-3 w-3" />
                    {formatActionName(getToolFromPath(selectedFile.rel_path) || "Output")}
                  </span>
                </div>
              </div>
              <Button size="icon" variant="ghost" className="rounded-full" onClick={() => setSelectedFile(null)}>
                <Trash2 className="h-5 w-5 rotate-45" /> {/* Close icon fallback */}
              </Button>
            </div>
            
            <div className="flex-1 bg-black flex items-center justify-center overflow-hidden">
              {selectedFile.kind === 'video' ? (
                <video 
                  src={outVideoUrl(selectedFile.rel_path)} 
                  controls 
                  autoPlay
                  className="max-w-full max-h-full"
                />
              ) : (
                <img 
                  src={outVideoUrl(selectedFile.rel_path)} 
                  className="max-w-full max-h-full object-contain" 
                  alt={selectedFile.name}
                />
              )}
            </div>

            <div className="p-4 bg-muted/10 border-t flex items-center justify-between">
              <div className="text-xs font-mono text-muted-foreground truncate max-w-[60%]">
                {selectedFile.rel_path}
              </div>
              <div className="flex gap-2">
                <Button 
                  size="sm" 
                  variant="destructive" 
                  disabled={deleting}
                  className="gap-1.5"
                  onClick={() => handleDelete(selectedFile)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
                <Button 
                  size="sm" 
                  variant="default"
                  className="gap-1.5"
                  onClick={() => window.open(outVideoUrl(selectedFile.rel_path), '_blank')}
                >
                  <Play className="h-3.5 w-3.5" />
                  Open Raw
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OutputCard({ 
  file, 
  isSelected, 
  onSelect, 
  onDelete 
}: { 
  file: OutputEntry; 
  isSelected: boolean; 
  onSelect: () => void;
  onDelete: () => void;
}) {
  const tool = getToolFromPath(file.rel_path);
  const Icon = getActionIcon(tool || "outputs");

  return (
    <div 
      className={`group relative flex flex-col bg-card border rounded-xl overflow-hidden transition-all hover:ring-2 hover:ring-primary/20 ${
        isSelected ? "ring-2 ring-primary" : ""
      }`}
    >
      {/* Thumbnail */}
      <div 
        className="relative aspect-video bg-muted cursor-pointer overflow-hidden"
        onClick={onSelect}
      >
        <img
          src={file.kind === "image" ? outVideoUrl(file.rel_path) : outThumbUrl(file.rel_path)}
          alt={file.name}
          className="w-full h-full object-cover transition-transform group-hover:scale-105"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <div className="bg-primary text-primary-foreground rounded-full p-2 shadow-lg scale-90 group-hover:scale-100 transition-transform">
            <Play className="h-5 w-5 fill-current" />
          </div>
        </div>
        
        {/* Tool Indicator Badge */}
        {tool && (
          <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 flex items-center gap-1 shadow-sm">
            <Icon className="h-3 w-3 text-white" />
            <span className="text-[10px] font-semibold text-white uppercase tracking-wider">
              {formatActionName(tool)}
            </span>
          </div>
        )}

        {/* Action Buttons (Hover Only) */}
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button 
            size="icon" 
            variant="destructive" 
            className="h-7 w-7 rounded-lg shadow-xl"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Info */}
      <div className="p-3 cursor-pointer" onClick={onSelect}>
        <div className="text-xs font-medium line-clamp-1 group-hover:text-primary transition-colors mb-1">
          {file.name}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Calendar className="h-2.5 w-2.5" />
            {timeAgo(file.modified_epoch)}
          </span>
          <span className="text-[10px] font-mono text-muted-foreground uppercase">
            {file.kind}
          </span>
        </div>
      </div>
    </div>
  );
}

function getToolFromPath(relPath: string): string | null {
  // src/PROJECT/outputs/TOOL/run_ID/file.mp4 -> TOOL
  if (relPath.startsWith("src/")) {
    const parts = relPath.split("/");
    if (parts.length >= 4) return parts[3];
  }
  // outputs/TOOL/run_ID/file.mp4 -> TOOL
  if (relPath.startsWith("outputs/")) {
    const parts = relPath.split("/");
    if (parts.length >= 2) return parts[1];
  }
  return null;
}

function timeAgo(epoch: number) {
  if (!epoch) return "--";
  const diff = Date.now() - epoch * 1000;
  if (diff < 0) return "just now";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
