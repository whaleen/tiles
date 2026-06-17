import {
  useCallback,
  useEffect,
  useState,
  lazy,
  Suspense,
  type Dispatch,
  type SetStateAction,
} from "react";

function readSidebarCookie(): boolean {
  const match = document.cookie.split("; ").find((c) => c.startsWith("sidebar_state="));
  if (!match) return true;
  return match.split("=")[1] === "true";
}
import { DownloadProvider } from "@/contexts/download-context";
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
import { ErrorBoundary } from "@/components/error-boundary";
import { FeedbackDialog } from "@/components/feedback/feedback-dialog";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { useProjects } from "@/hooks/use-projects";
import { hashWorkspace, uiKeys } from "@/lib/ui-state";

type StoredLocation = { activeTab: string; project: string | null };
const DEFAULT_LOCATION: StoredLocation = { activeTab: "dashboard", project: null };

const WorkspaceHomePage = lazy(() =>
  import("@/pages/workspace-home").then((m) => ({ default: m.WorkspaceHomePage }))
);
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
const SettingsPage = lazy(() =>
  import("@/pages/settings").then((m) => ({ default: m.SettingsPage }))
);

function PageFallback() {
  return (
    <div className="flex items-center justify-center h-64 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  );
}

export function AppShell({
  onChangeWorkspace,
  onSetWorkspace,
  workspacePath,
}: {
  onChangeWorkspace?: () => void;
  onSetWorkspace?: (path: string) => void;
  workspacePath?: string;
}) {
  // Restore the last UI location (active tab + project) per workspace, so
  // reopening tiles lands where you left off. Scoped by workspace hash; falls
  // back to Workspace Home when there's nothing stored.
  const locationKey = workspacePath
    ? uiKeys.workspace(hashWorkspace(workspacePath), "lastLocation")
    : null;
  const [location, setLocation] = usePersistentState<StoredLocation>(locationKey, DEFAULT_LOCATION);
  const activeTab = location.activeTab;
  const project = location.project ?? undefined;

  const setActiveTab = useCallback<Dispatch<SetStateAction<string>>>(
    (tab) =>
      setLocation((prev) => ({
        ...prev,
        activeTab: typeof tab === "function" ? tab(prev.activeTab) : tab,
      })),
    [setLocation]
  );
  const setProject = useCallback<Dispatch<SetStateAction<string | undefined>>>(
    (next) =>
      setLocation((prev) => {
        const resolved =
          typeof next === "function" ? next(prev.project ?? undefined) : next;
        return { ...prev, project: resolved ?? null };
      }),
    [setLocation]
  );

  const [settingsProject, setSettingsProject] = useState<string | undefined>();
  const workspaceName = workspacePath?.split(/[\\/]/).filter(Boolean).at(-1) || "Workspace";

  // Defensively drop a restored project that no longer exists in this
  // workspace, falling back to Workspace Home.
  const { projects, loading: projectsLoading } = useProjects();
  useEffect(() => {
    if (projectsLoading || !location.project) return;
    if (!projects.some((p) => p.name === location.project)) {
      setLocation(() => DEFAULT_LOCATION);
    }
  }, [projectsLoading, projects, location.project, setLocation]);

  useEffect(() => {
    function handleNavigate(event: Event) {
      const detail = (event as CustomEvent<{ tab?: string; project?: string | null }>).detail;
      if (!detail?.tab) return;
      setActiveTab(detail.tab);
      if ("project" in detail) setProject(detail.project ?? undefined);
    }
    window.addEventListener("tiles:navigate", handleNavigate);
    return () => window.removeEventListener("tiles:navigate", handleNavigate);
  }, [setActiveTab, setProject]);

  if (!project) {
    return (
      <DownloadProvider>
        <div className="min-h-svh">
          <ErrorBoundary resetKey={`workspace-home:${activeTab}`}>
            <Suspense fallback={<PageFallback />}>
              {activeTab === "settings" ? (
                <div className="min-h-svh bg-background p-6">
                  <div className="mx-auto mb-4 flex w-full max-w-3xl justify-between">
                    <button className="text-sm text-muted-foreground hover:text-foreground" onClick={() => setActiveTab("dashboard")} type="button">
                      ← Workspace
                    </button>
                  </div>
                  <SettingsPage />
                </div>
              ) : (
                <WorkspaceHomePage
                  workspacePath={workspacePath}
                  onChangeWorkspace={onChangeWorkspace}
                  onSetWorkspace={onSetWorkspace}
                  onOpenProject={(name, tab = "library") => {
                    setProject(name);
                    setActiveTab(tab);
                  }}
                  onOpenProjectSettings={(name) => {
                    setSettingsProject(name);
                    setProject(name);
                    setActiveTab("dashboard");
                  }}
                />
              )}
            </Suspense>
          </ErrorBoundary>
          <FeedbackDialog activeTab={activeTab} project={project} workspacePath={workspacePath} />

        </div>
      </DownloadProvider>
    );
  }

  return (
    <DownloadProvider>
    <SidebarProvider defaultOpen={readSidebarCookie()} className="h-svh overflow-hidden">
      <AppSidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        selectedProject={project}
        onProjectChange={setProject}
        onChangeWorkspace={onChangeWorkspace}
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
                  <BreadcrumbLink
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      setProject(undefined);
                      setActiveTab("dashboard");
                    }}
                  >
                    {workspaceName}
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>
                    {activeTab === "dashboard"
                      ? "Workspace Home"
                      : activeTab === "tile-builder"
                        ? "Tile Builder"
                        : activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <div className="flex min-w-0 flex-1 min-h-0 flex-col gap-4 overflow-y-auto p-4 pt-0">
          <ErrorBoundary resetKey={`${activeTab}:${project ?? "__all__"}`}>
            <Suspense fallback={<PageFallback />}>
              {activeTab === "dashboard" && (
                <DashboardPage
                  onNavigate={setActiveTab}
                  onProjectChange={setProject}
                  settingsProject={settingsProject}
                  onSettingsProjectChange={setSettingsProject}
                />
              )}
              {activeTab === "library" && <LibraryPage key={project ?? "__all__"} project={project} />}
              {activeTab === "tile-builder" && <TileBuilderPage key={project ?? "__all__"} project={project} />}
              {activeTab === "import" && <ImportPage key={project ?? "__all__"} project={project} />}
              {activeTab === "outputs" && <OutputsPage key={project ?? "__all__"} project={project} />}
              {activeTab === "logs" && <LogsPage />}
              {activeTab === "settings" && <SettingsPage />}
            </Suspense>
          </ErrorBoundary>
        </div>
      </SidebarInset>
      <FeedbackDialog activeTab={activeTab} project={project} workspacePath={workspacePath} />
    </SidebarProvider>
    </DownloadProvider>
  );
}
