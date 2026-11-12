import { describe, expect, it } from "vitest";

import { canOpenConsole, consoleHref } from "../consoleHref";

describe("consoleHref", () => {
  it("crosses from the Admin host to the Builder host on the live site", () => {
    expect(consoleHref("builder", { protocol: "https:", host: "admin.mastersat.uz" })).toBe("https://questions.mastersat.uz/builder");
  });

  it("crosses back from the Builder host to the Admin host", () => {
    expect(consoleHref("admin", { protocol: "https:", host: "questions.mastersat.uz" })).toBe("https://admin.mastersat.uz/ops");
  });

  it("stays on one origin anywhere else", () => {
    expect(consoleHref("builder", { protocol: "http:", host: "localhost:3472" })).toBe("/builder");
    expect(consoleHref("admin", { protocol: "https:", host: "mastersat.uz" })).toBe("/ops");
  });
});

describe("canOpenConsole", () => {
  it("keeps a test admin in the Builder — AuthGuard sends them away from Admin", () => {
    expect(canOpenConsole("admin", { role: "test_admin" })).toBe(false);
    expect(canOpenConsole("builder", { role: "test_admin" })).toBe(true);
  });

  it("lets the rest of the staff into both", () => {
    for (const role of ["super_admin", "admin", "teacher", "test_auditor"]) {
      expect(canOpenConsole("admin", { role })).toBe(true);
      expect(canOpenConsole("builder", { role })).toBe(true);
    }
  });
});
