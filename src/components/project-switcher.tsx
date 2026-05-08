import { useState } from "react"
import { ChevronsUpDown, Folder, Plus } from "lucide-react"

import { useProjects } from "@/hooks/use-projects"
import { CreateProjectDialog } from "@/components/create-project-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"

export function ProjectSwitcher({
  selectedProject,
  onProjectChange,
}: {
  selectedProject?: string
  onProjectChange: (project?: string) => void
}) {
  const { isMobile } = useSidebar()
  const { projects } = useProjects()
  const [createOpen, setCreateOpen] = useState(false)

  const label = selectedProject || "All Projects"

  return (
    <>
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <Folder className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{label}</span>
                <span className="truncate text-xs text-sidebar-foreground/70">
                  Projects
                </span>
              </div>
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Projects
            </DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => onProjectChange(undefined)}
              className="gap-2 p-2"
            >
              <div className="flex size-6 items-center justify-center rounded-sm border">
                <Folder className="size-4 shrink-0" />
              </div>
              All Projects
            </DropdownMenuItem>
            {projects.map((project, index) => (
              <DropdownMenuItem
                key={project.name}
                onClick={() => onProjectChange(project.name)}
                className="gap-2 p-2"
              >
                <div className="flex size-6 items-center justify-center rounded-sm border">
                  <Folder className="size-4 shrink-0" />
                </div>
                {project.name}
                <DropdownMenuShortcut>Ctrl+{index + 1}</DropdownMenuShortcut>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2 p-2"
              onSelect={() => {
                window.setTimeout(() => setCreateOpen(true), 0)
              }}
            >
              <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                <Plus className="size-4" />
              </div>
              <div className="font-medium text-muted-foreground">Add project</div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
    <CreateProjectDialog
      open={createOpen}
      onOpenChange={setCreateOpen}
      onProjectCreated={onProjectChange}
    />
    </>
  )
}
