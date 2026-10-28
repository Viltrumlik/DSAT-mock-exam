import { afterEach, describe, expect, it, vi } from "vitest";
import { reportClientError } from "../clientErrorReport";

describe("reportClientError", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts the page, the error and its kind, surviving a reload", () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    reportClientError(new TypeError("Cannot read properties of undefined (reading 'xp')"), "crash");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/health/client-error/");
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ kind: "crash", name: "TypeError", url: window.location.href });
    expect(body.message).toContain("reading 'xp'");
  });

  it("never throws when the network does", () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(() => reportClientError(new Error("x"), "stale")).not.toThrow();
    vi.stubGlobal("fetch", () => {
      throw new Error("no fetch");
    });
    expect(() => reportClientError(new Error("x"), "stale")).not.toThrow();
  });
});
