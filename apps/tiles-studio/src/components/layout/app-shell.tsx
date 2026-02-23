import { useState } from "react";
import { DashboardPage } from "@/pages/dashboard";
import { LibraryPage } from "@/pages/library";
import { OutputsPage } from "@/pages/outputs";
import { TileBuilderPage } from "@/pages/tile-builder";
import { ImportPage } from "@/pages/import";
import { LogsPage } from "@/pages/logs";
import { AppSidebar } from "@/components/app-sidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export function AppShell() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [project, setProject] = useState<string | undefined>();

  return (
    <SidebarProvider>
      <AppSidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        selectedProject={project}
        onProjectChange={setProject}
      />
      <SidebarInset className="min-w-0">
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-[orientation=vertical]:h-4"
            />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink href="#">Tiles Studio</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>
                    {activeTab === "tile-builder"
                      ? "Tile Builder"
                      : activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 pt-0">
          {activeTab === "dashboard" && (
            <DashboardPage onNavigate={setActiveTab} onProjectChange={setProject} />
          )}
          {activeTab === "library" && <LibraryPage project={project} onNavigate={setActiveTab} />}
          {activeTab === "tile-builder" && <TileBuilderPage project={project} />}
          {activeTab === "import" && <ImportPage project={project} />}
          {activeTab === "outputs" && <OutputsPage project={project} />}
          {activeTab === "logs" && <LogsPage />}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
