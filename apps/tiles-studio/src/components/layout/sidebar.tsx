import { cn } from "@/lib/utils";
import {
  Home,
  Library,
  LayoutGrid,
  Download,
  FolderOutput,
  ScrollText,
} from "lucide-react";

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const tabs = [
  { id: "dashboard", label: "Dashboard", icon: Home },
  { id: "library", label: "Library", icon: Library },
  { id: "tile-builder", label: "Tile Builder", icon: LayoutGrid },
  { id: "import", label: "Import", icon: Download },
  { id: "outputs", label: "Outputs", icon: FolderOutput },
  { id: "logs", label: "Logs", icon: ScrollText },
];

export function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  return (
    <nav className="w-48 border-r bg-muted/30 p-3 flex flex-col gap-1">
      <div className="text-sm font-semibold text-muted-foreground mb-2 px-2">
        Tiles Studio
      </div>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "flex items-center gap-2 text-left px-3 py-2 rounded-md text-sm transition-colors",
              activeTab === tab.id
                ? "bg-primary text-primary-foreground"
                : "hover:bg-accent text-foreground"
            )}
          >
            <Icon className="h-4 w-4" />
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
