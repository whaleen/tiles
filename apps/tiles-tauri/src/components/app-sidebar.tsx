import * as React from "react"
import {
  Home,
  Library,
  LayoutGrid,
  Download,
  FolderOutput,
  ScrollText,
  Folder,
} from "lucide-react"
import { NavMain } from "@/components/nav-main"
import { NavProjects } from "@/components/nav-projects"
import { NavUser } from "@/components/nav-user"
import { ProjectSwitcher } from "@/components/project-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"
import { useProjects } from "@/hooks/use-projects"

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
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  activeTab: string
  onTabChange: (tab: string) => void
  selectedProject?: string
  onProjectChange: (project?: string) => void
}) {
  const { projects } = useProjects()
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
  const projectItems = projects.map((project) => ({
    name: project.name,
    url: "#",
    icon: Folder,
  }))
  return (
    <Sidebar variant="inset" collapsible="icon" {...props}>
      <SidebarHeader>
        <ProjectSwitcher
          selectedProject={selectedProject}
          onProjectChange={onProjectChange}
        />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navItems} onSelect={onTabChange} />
        {projectItems.length > 0 && (
          <NavProjects
            projects={projectItems}
            activeProject={selectedProject}
            onSelect={onProjectChange}
          />
        )}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
