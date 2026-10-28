import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isStaleBuildError, reloadOnceForStaleBuild } from "../staleBuild";

describe("isStaleBuildError", () => {
  it.each([
    Object.assign(new Error("Loading chunk 4821 failed."), { name: "ChunkLoadError" }),
    new Error("Loading CSS chunk app-layout failed"),
    new TypeError("Failed to fetch dynamically imported module: https://mastersat.uz/_next/static/chunks/abc.js"),
    new TypeError("Importing a module script failed."),
  ])("recognises %s", (error) => {
    expect(isStaleBuildError(error)).toBe(true);
  });

  it.each([new TypeError("Cannot read properties of undefined (reading 'xp')"), null, "ChunkLoadError", {}])(
    "leaves %s alone",
    (error) => {
      expect(isStaleBuildError(error)).toBe(false);
    },
  );
});

describe("reloadOnceForStaleBuild", () => {
  const reload = vi.fn();

  beforeEach(() => {
    window.sessionStorage.clear();
    vi.stubGlobal("location", { ...window.location, reload });
  });
  afterEach(() => {
    reload.mockReset();
    vi.unstubAllGlobals();
  });

  it("reloads the first time", () => {
    expect(reloadOnceForStaleBuild(1_000_000)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not loop when the reload did not help", () => {
    reloadOnceForStaleBuild(1_000_000);
    expect(reloadOnceForStaleBuild(1_010_000)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads again after the cooldown — the next deploy's stale tab", () => {
    reloadOnceForStaleBuild(1_000_000);
    expect(reloadOnceForStaleBuild(1_031_000)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
