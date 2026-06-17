import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

function read<T>(key: string | null, fallback: T): T {
  if (!key) return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * `useState` whose value is persisted to `localStorage` under `key`.
 *
 * - Pass `key === null` to disable persistence (e.g. before the workspace is
 *   known); the value then behaves as plain in-memory state.
 * - When `key` changes (e.g. switching workspace), the value is re-read from the
 *   new key, so each scope restores its own state independently.
 * - Persistence is best-effort: storage errors fall back to in-memory state.
 *
 * Build keys with the `uiKeys` helpers so everything stays namespaced. Future
 * options (custom serialization, versioning) can be added as a third argument
 * without breaking existing callers.
 */
export function usePersistentState<T>(
  key: string | null,
  defaultValue: T
): [T, Dispatch<SetStateAction<T>>] {
  const defaultRef = useRef(defaultValue);
  defaultRef.current = defaultValue;

  const [value, setValue] = useState<T>(() => read(key, defaultValue));
  const keyRef = useRef(key);
  const skipNextWrite = useRef(false);

  // Re-read when the key changes so each scope (workspace/project) restores
  // its own persisted value rather than carrying the previous scope's.
  useEffect(() => {
    if (keyRef.current === key) return;
    keyRef.current = key;
    skipNextWrite.current = true;
    setValue(read(key, defaultRef.current));
  }, [key]);

  // Persist on change (best-effort). Skip the write triggered by a key switch,
  // which would otherwise echo the new scope's value straight back.
  useEffect(() => {
    if (!key) return;
    if (skipNextWrite.current) {
      skipNextWrite.current = false;
      return;
    }
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore — in-memory state still works
    }
  }, [key, value]);

  return [value, setValue];
}
