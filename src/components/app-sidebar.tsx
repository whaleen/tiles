import * as React from "react"
import {
  Library,
  LayoutGrid,
  Download,
  FolderOutput,
  ScrollText,
  Settings,
  Loader2,
  CheckCircle2,
  XCircle,
  X,
} from "lucide-react"
import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { ProjectSwitcher } from "@/components/project-switcher"
import { useAppVersion } from "@/hooks/use-app-version"
import { useDownloads } from "@/contexts/download-context"
import type { DownloadJob } from "@/contexts/download-context"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"

function jobLabel(job: DownloadJob) {
  if (job.status === "downloading") {
    return `${job.completed + job.failed} / ${job.total}`;
  }
  const parts = [];
  if (job.completed > 0) parts.push(`${job.completed} downloaded`);
  if (job.failed > 0) parts.push(`${job.failed} failed`);
  return parts.join(" · ") || "done";
}

function DownloadTray() {
  const { jobs, dismiss, activeCount } = useDownloads();
  const { isMobile } = useSidebar();

  if (jobs.length === 0) return null;

  const label = activeCount > 0
    ? `${activeCount} downloading…`
    : `${jobs.length} download${jobs.length !== 1 ? "s" : ""} done`;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton>
              {activeCount > 0
                ? <Loader2 className="animate-spin" />
                : <CheckCircle2 className="text-green-500" />
              }
              <span>{label}</span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-72"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel>Downloads</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {jobs.map((job) => (
              <div key={job.id} className="flex items-start gap-2 px-2 py-2">
                <div className="mt-0.5 shrink-0">
                  {job.status === "downloading" && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                  {job.status === "done" && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                  {job.status === "failed" && <XCircle className="h-3.5 w-3.5 text-destructive" />}
                </div>
                <div className="min-w-0 flex-1 text-sm">
                  <div className="truncate font-medium">{job.project}</div>
                  <div className="truncate text-xs text-muted-foreground">{job.folder} · {jobLabel(job)}</div>
                </div>
                {job.status !== "downloading" && (
                  <button
                    onClick={() => dismiss(job.id)}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() =>
                window.dispatchEvent(new CustomEvent("tiles:navigate", { detail: { tab: "import" } }))
              }
            >
              <Download className="h-3.5 w-3.5" />
              Go to Import
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

const tabs = [
  { id: "library", label: "Library", icon: Library },
  { id: "tile-builder", label: "Tile Builder", icon: LayoutGrid },
  { id: "import", label: "Import", icon: Download },
  { id: "outputs", label: "Outputs", icon: FolderOutput },
  { id: "logs", label: "Logs", icon: ScrollText },
  { id: "settings", label: "Settings", icon: Settings },
]

export function AppSidebar({
  activeTab,
  onTabChange,
  selectedProject,
  onProjectChange,
  onChangeWorkspace,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  activeTab: string
  onTabChange: (tab: string) => void
  selectedProject?: string
  onProjectChange: (project?: string) => void
  onChangeWorkspace?: () => void
}) {
  const version = useAppVersion()
  const user = {
    name: "Local",
    email: "local",
    avatar: "",
  }
  const navItems = tabs.map((tab) => ({
    id: tab.id,
    title: tab.label,
    icon: tab.icon,
    isActive: activeTab === tab.id,
  }))

  const handleProjectChange = (project?: string) => {
    onProjectChange(project)
    if (project) onTabChange("library")
  }

  return (
    <Sidebar variant="inset" collapsible="icon" {...props}>
      <SidebarHeader>
        <ProjectSwitcher
          selectedProject={selectedProject}
          onProjectChange={handleProjectChange}
        />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navItems} onSelect={onTabChange} />
      </SidebarContent>
      <SidebarFooter>
        <DownloadTray />
        <NavUser user={user} onChangeWorkspace={onChangeWorkspace} />
        {version && (
          <div className="px-3 pb-1 group-data-[collapsible=icon]:hidden">
            <span className="text-xs text-muted-foreground/60">v{version}</span>
          </div>
        )}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
