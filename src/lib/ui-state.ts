/**
 * Namespaced key builders for persisted UI state (localStorage-backed via
 * `usePersistentState`). Keep all UI-memory keys flowing through here so they
 * stay namespaced and scoped, instead of scattering one-off `localStorage`
 * calls across components.
 *
 * Scopes:
 *  - global    — not workspace-specific (e.g. a global toggle)
 *  - workspace — per workspace, keyed by a hash of its path
 *  - project   — per project within a workspace
 *
 * UI memory lives in frontend storage. True app settings (workspace path,
 * credentials, provider config) stay in Tauri prefs, not here.
 */
const UI_ROOT = "tiles.ui";

/** Stable short hash of a workspace path, so different workspaces don't collide. */
export function hashWorkspace(path?: string | null): string {
  if (!path) return "none";
  let h = 5381;
  for (let i = 0; i < path.length; i++) {
    h = ((h << 5) + h + path.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

export const uiKeys = {
  global: (field: string) => `${UI_ROOT}.global.${field}`,
  workspace: (workspaceHash: string, field: string) =>
    `${UI_ROOT}.workspace.${workspaceHash}.${field}`,
  project: (workspaceHash: string, project: string, field: string) =>
    `${UI_ROOT}.project.${workspaceHash}.${project}.${field}`,
};
