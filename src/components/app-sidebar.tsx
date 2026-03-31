import * as React from "react"
import {
  Home,
  Library,
  LayoutGrid,
  Download,
  FolderOutput,
  ScrollText,
} from "lucide-react"
import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { ProjectSwitcher } from "@/components/project-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"

const tabs = [
  { id: "dashboard", label: "Dashboard", icon: Home },
  { id: "library", label: "Library", icon: Library },
  { id: "tile-builder", label: "Tile Builder", icon: LayoutGrid },
  { id: "import", label: "Import", icon: Download },
  { id: "outputs", label: "Outputs", icon: FolderOutput },
  { id: "logs", label: "Logs", icon: ScrollText },
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
        <NavUser user={user} onChangeWorkspace={onChangeWorkspace} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
