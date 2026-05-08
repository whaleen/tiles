import { useProjects } from "@/hooks/use-projects";
import { Button } from "@/components/ui/button";
import { CreateProjectDialog } from "@/components/create-project-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Home,
  Library,
  LayoutGrid,
  FolderOutput,
  ScrollText,
  Download,
  FolderOpen,
  Plus,
} from "lucide-react";

const tabMeta: Record<string, { label: string; icon: typeof Library }> = {
  dashboard: { label: "Dashboard", icon: Home },
  library: { label: "Library", icon: Library },
  "tile-builder": { label: "Tile Builder", icon: LayoutGrid },
  import: { label: "Import", icon: Download },
  outputs: { label: "Outputs", icon: FolderOutput },
  logs: { label: "Logs", icon: ScrollText },
};

interface ProjectBarProps {
  activeTab: string;
  selectedProject?: string;
  onProjectChange: (project?: string) => void;
  variant?: "bar" | "inline";
  className?: string;
  showLabel?: boolean;
}

export function ProjectBar({
  activeTab,
  selectedProject,
  onProjectChange,
  variant = "bar",
  className,
  showLabel = true,
}: ProjectBarProps) {
  const { projects } = useProjects();
  const meta = tabMeta[activeTab] || { label: activeTab, icon: Library };
  const PageIcon = meta.icon;

  const wrapperClass =
    variant === "inline"
      ? "flex items-center gap-4 w-full"
      : "sticky top-0 z-20 bg-background/95 backdrop-blur border-b px-4 py-2 flex items-center gap-4";

  return (
    <div className={`${wrapperClass} ${className || ""}`.trim()}>
      {showLabel && (
        <div className="flex items-center gap-2 text-sm font-semibold">
          <PageIcon className="h-4 w-4" />
          {meta.label}
        </div>
      )}
      {activeTab !== "dashboard" && (
        <div className="ml-auto flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
          <Select
            value={selectedProject || "all"}
            onValueChange={(v) => onProjectChange(v === "all" ? undefined : v)}
          >
            <SelectTrigger className="h-8 w-[200px]">
              <SelectValue placeholder="Project" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.name} value={p.name}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <CreateProjectDialog
            onProjectCreated={onProjectChange}
            trigger={(
              <Button variant="outline" size="sm">
                <Plus className="h-4 w-4" />
              </Button>
            )}
          />
        </div>
      )}
    </div>
  );
}
