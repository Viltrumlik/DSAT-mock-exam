import { describe, expect, it } from "vitest";

import { consoleHref } from "../consoleHref";

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
