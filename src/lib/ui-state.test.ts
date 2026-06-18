import { describe, it, expect } from "vitest";
import { hashWorkspace, uiKeys } from "@/lib/ui-state";

describe("hashWorkspace", () => {
  it("is deterministic for the same path", () => {
    expect(hashWorkspace("/Users/me/Movies/tiles")).toBe(
      hashWorkspace("/Users/me/Movies/tiles")
    );
  });

  it("differs for different paths", () => {
    expect(hashWorkspace("/a/b")).not.toBe(hashWorkspace("/a/c"));
  });

  it("returns 'none' for empty or nullish paths", () => {
    expect(hashWorkspace()).toBe("none");
    expect(hashWorkspace(null)).toBe("none");
    expect(hashWorkspace("")).toBe("none");
  });

  it("produces a base36 token", () => {
    expect(hashWorkspace("/x/y")).toMatch(/^[0-9a-z]+$/);
  });
});

describe("uiKeys", () => {
  it("namespaces global keys", () => {
    expect(uiKeys.global("sidebarOpen")).toBe("tiles.ui.global.sidebarOpen");
  });

  it("scopes workspace keys by hash", () => {
    expect(uiKeys.workspace("ws1", "lastLocation")).toBe(
      "tiles.ui.workspace.ws1.lastLocation"
    );
  });

  it("scopes project keys by workspace + project", () => {
    expect(uiKeys.project("ws1", "grace", "tileBuilder.main.workspace")).toBe(
      "tiles.ui.project.ws1.grace.tileBuilder.main.workspace"
    );
  });
});
