import { describe, it, expect, beforeEach } from "vitest";
import { readPersistentState } from "@/hooks/use-persistent-state";

// Minimal in-memory localStorage so the read helper can run in node (no jsdom).
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }
  get length(): number {
    return this.store.size;
  }
}

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
});

describe("readPersistentState", () => {
  it("returns the fallback for a null key (persistence disabled)", () => {
    expect(readPersistentState(null, "fallback")).toBe("fallback");
  });

  it("returns the fallback when the key is absent", () => {
    expect(readPersistentState("missing", 42)).toBe(42);
  });

  it("returns the parsed stored value when present", () => {
    localStorage.setItem("k", JSON.stringify({ a: 1, b: [2, 3] }));
    expect(readPersistentState("k", null)).toEqual({ a: 1, b: [2, 3] });
  });

  it("falls back on malformed JSON instead of throwing", () => {
    localStorage.setItem("bad", "{not valid json");
    expect(readPersistentState("bad", "fallback")).toBe("fallback");
  });
});
