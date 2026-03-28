import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ProjectSummary } from "@/types";

interface ProjectListProps {
  projects: ProjectSummary[];
  selected?: string;
  onSelect: (name: string | undefined) => void;
  search: string;
  onSearchChange: (val: string) => void;
}

export function ProjectList({
  projects,
  selected,
  onSelect,
  search,
  onSearchChange,
}: ProjectListProps) {
  return (
    <div className="w-56 border-r flex flex-col">
      <div className="p-2">
        <Input
          placeholder="Search..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-8 text-sm"
        />
      </div>
      <ScrollArea className="flex-1">
        <div className="px-3 py-2 text-xs font-semibold text-muted-foreground">
          Projects
        </div>
        <button
          onClick={() => onSelect(undefined)}
          className={cn(
            "w-full text-left px-3 py-1.5 text-sm",
            !selected ? "bg-accent font-medium" : "hover:bg-accent/50"
          )}
        >
          All Projects
        </button>
        {projects.map((p) => (
          <button
            key={p.name}
            onClick={() => onSelect(p.name)}
            className={cn(
              "w-full text-left px-3 py-1.5 text-sm",
              selected === p.name
                ? "bg-accent font-medium"
                : "hover:bg-accent/50"
            )}
          >
            {p.name}
          </button>
        ))}
      </ScrollArea>
    </div>
  );
}
