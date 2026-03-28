import { useState, lazy, Suspense } from "react";
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
import { Loader2 } from "lucide-react";

const DashboardPage = lazy(() =>
  import("@/pages/dashboard").then((m) => ({ default: m.DashboardPage }))
);
const LibraryPage = lazy(() =>
  import("@/pages/library").then((m) => ({ default: m.LibraryPage }))
);
const TileBuilderPage = lazy(() =>
  import("@/pages/tile-builder").then((m) => ({ default: m.TileBuilderPage }))
);
const ImportPage = lazy(() =>
  import("@/pages/import").then((m) => ({ default: m.ImportPage }))
);
const OutputsPage = lazy(() =>
  import("@/pages/outputs").then((m) => ({ default: m.OutputsPage }))
);
const LogsPage = lazy(() =>
  import("@/pages/logs").then((m) => ({ default: m.LogsPage }))
);

function PageFallback() {
  return (
    <div className="flex items-center justify-center h-64 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  );
}

export function AppShell() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [project, setProject] = useState<string | undefined>();

  return (
    <SidebarProvider className="h-svh overflow-hidden">
      <AppSidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        selectedProject={project}
        onProjectChange={setProject}
      />
      <SidebarInset className="min-w-0 h-svh overflow-hidden">
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
        <div className="flex min-w-0 flex-1 min-h-0 flex-col gap-4 overflow-hidden p-4 pt-0">
          <Suspense fallback={<PageFallback />}>
            {activeTab === "dashboard" && (
              <DashboardPage onNavigate={setActiveTab} onProjectChange={setProject} />
            )}
            {activeTab === "library" && <LibraryPage project={project} />}
            {activeTab === "tile-builder" && <TileBuilderPage project={project} />}
            {activeTab === "import" && <ImportPage project={project} />}
            {activeTab === "outputs" && <OutputsPage project={project} />}
            {activeTab === "logs" && <LogsPage />}
          </Suspense>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
