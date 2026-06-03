import { useState } from "react"
import { ChevronsUpDown, Folder, Plus } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { invoke } from "@tauri-apps/api/core"

import { useProjects } from "@/hooks/use-projects"
import { useProjectMetasMap } from "@/hooks/use-project-metas-map"
import { thumbUrl, outThumbUrl } from "@/api/client"

function mediaCoverUrl(relPath: string) {
  return relPath.startsWith("src/") || relPath.startsWith("outputs/")
    ? outThumbUrl(relPath)
    : thumbUrl(relPath);
}
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

function TriggerThumb({ coverImageRel }: { coverImageRel?: string | null }) {
  if (coverImageRel) {
    return (
      <img
        src={mediaCoverUrl(coverImageRel)}
        className="flex aspect-square size-8 rounded-lg object-cover"
        alt=""
      />
    )
  }
  return (
    <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
      <Folder className="size-4" />
    </div>
  )
}

function ItemThumb({ coverImageRel }: { coverImageRel?: string | null }) {
  if (coverImageRel) {
    return (
      <img
        src={mediaCoverUrl(coverImageRel)}
        className="size-6 rounded-sm object-cover"
        alt=""
      />
    )
  }
  return (
    <div className="flex size-6 items-center justify-center rounded-sm border">
      <Folder className="size-4 shrink-0" />
    </div>
  )
}

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

  const projectNames = projects.map((p) => p.name)
  const { map: metasMap } = useProjectMetasMap(projectNames)

  const { data: workspaceMeta } = useQuery({
    queryKey: ["workspace", "meta"],
    queryFn: () => invoke<{ coverImageRel?: string | null }>("get_workspace_meta"),
    staleTime: 30_000,
  })

  const label = selectedProject || "Workspace Home"
  const activeCover = selectedProject
    ? metasMap[selectedProject]?.cover_image_rel
    : workspaceMeta?.coverImageRel

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
              <TriggerThumb coverImageRel={activeCover} />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{label}</span>
                <span className="truncate text-xs text-sidebar-foreground/70">
                  {selectedProject ? "Project" : "All projects"}
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
              <ItemThumb coverImageRel={workspaceMeta?.coverImageRel} />
              Workspace Home
            </DropdownMenuItem>
            {projects.map((project, index) => (
              <DropdownMenuItem
                key={project.name}
                onClick={() => onProjectChange(project.name)}
                className="gap-2 p-2"
              >
                <ItemThumb coverImageRel={metasMap[project.name]?.cover_image_rel} />
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
