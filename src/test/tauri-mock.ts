// Minimal stand-in for `@tauri-apps/api/core` used by Vitest (see vitest.config
// alias). Pure-logic tests don't exercise the Tauri bridge, so invoke is a noop.
export function invoke<T>(): Promise<T> {
  return Promise.resolve(undefined as T);
}
