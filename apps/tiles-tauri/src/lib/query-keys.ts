export const queryKeys = {
  projects: {
    all: ["projects"] as const,
    detail: (name: string) => ["projects", name] as const,
    meta: (name: string) => ["projects", name, "meta"] as const,
  },
  videos: {
    all: ["videos"] as const,
    list: (project?: string, search?: string) =>
      ["videos", { project, search }] as const,
    info: (relPath: string) => ["videos", "info", relPath] as const,
  },
  outputs: {
    all: ["outputs"] as const,
    list: (project?: string, action?: string) =>
      ["outputs", { project, action }] as const,
    tree: (path: string) => ["outputs", "tree", path] as const,
  },
  actions: {
    all: ["actions"] as const,
    running: ["actions", "running"] as const,
  },
  logs: ["logs"] as const,
  folderOrder: {
    get: (project: string, folder?: string) =>
      ["folderOrder", { project, folder }] as const,
  },
  settings: {
    project: (project?: string) => ["settings", project] as const,
    layouts: ["settings", "layouts"] as const,
  },
};
