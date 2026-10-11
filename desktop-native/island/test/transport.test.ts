// The pluggable transports (architecture.md §2.7 "Transport"): WebView2, the macOS WebKit shim,
// the dev harness's parent frame, and memory — and that the islands start on each.
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContentIsland } from "../src/content/island";
import {
  detectTransport,
  FRAME_TO_NATIVE,
  FRAME_TO_WEB,
  memoryTransport,
  parentFrameTransport,
  webkitTransport,
  webview2Transport,
} from "../src/transport";

type W = Window & typeof globalThis & { chrome?: unknown; webkit?: unknown; msIsland?: unknown; __msIslandSinks?: unknown };

afterEach(() => {
  const w = window as W;
  delete w.chrome;
  delete w.webkit;
  delete w.msIsland;
  delete w.__msIslandSinks;
  document.body.replaceChildren();
});

function fakeWebView2() {
  const listeners = new Set<(e: { data: unknown }) => void>();
  const posted: unknown[] = [];
  (window as W).chrome = {
    webview: {
      postMessage: (m: unknown) => posted.push(m),
      addEventListener: (_t: string, l: (e: { data: unknown }) => void) => listeners.add(l),
      removeEventListener: (_t: string, l: (e: { data: unknown }) => void) => listeners.delete(l),
    },
  };
  return { posted, push: (data: unknown) => listeners.forEach((l) => l({ data })), listeners };
}

describe("webview2", () => {
  it("posts objects with chrome.webview.postMessage and receives PostWebMessageAsJson events", () => {
    const wv = fakeWebView2();
    const t = webview2Transport(window);
    const got: unknown[] = [];
    const stop = t.listen((d) => got.push(d));
    t.send({ v: 1, t: "ready" });
    wv.push({ v: 1, t: "focus.release" });
    expect(wv.posted).toEqual([{ v: 1, t: "ready" }]);
    expect(got).toEqual([{ v: 1, t: "focus.release" }]);
    stop();
    expect(wv.listeners.size).toBe(0);
  });

  it("is the first choice when present, and the content island runs on it", () => {
    const wv = fakeWebView2();
    (window as W).webkit = { messageHandlers: { ms: { postMessage: vi.fn() } } };
    const t = detectTransport(window)!;
    expect(t.name).toBe("webview2");
    const island = new ContentIsland(t, { build: "island/test" });
    island.start();
    expect(wv.posted[0]).toEqual({ v: 1, t: "ready", build: "island/test", protocol: 1 });
    wv.push({ v: 1, t: "init", mode: "exam", kind: "pastpaper", subject: "rw", overlays: "native", zoom: 1.4, split: 0.5, highlighterOn: false, eliminatorOn: false, calcReservePx: 0 });
    expect(island.view.zoom).toBe(1.4);
    island.stop();
  });

  it("throws without window.chrome.webview", () => {
    expect(() => webview2Transport(window)).toThrow(/chrome\.webview/);
  });
});

describe("webkit (macOS dev runner)", () => {
  it("posts JSON strings to webkit.messageHandlers.ms and receives through msIsland.receive", () => {
    const postMessage = vi.fn();
    (window as W).webkit = { messageHandlers: { ms: { postMessage } } };
    const t = webkitTransport(window);
    const got: unknown[] = [];
    t.listen((d) => got.push(d));
    t.send({ v: 1, t: "focus", inIsland: true });
    expect(postMessage).toHaveBeenCalledWith('{"v":1,"t":"focus","inIsland":true}');
    window.msIsland!.receive('{"v":1,"t":"focus.release"}');
    expect(got).toEqual(['{"v":1,"t":"focus.release"}']);
    expect(typeof window.msIsland!.build).toBe("string");
  });

  it("is chosen when there is no WebView2", () => {
    (window as W).webkit = { messageHandlers: { ms: { postMessage: vi.fn() } } };
    expect(detectTransport(window)!.name).toBe("webkit");
  });
});

describe("parent frame (dev harness)", () => {
  it("wraps messages in an envelope and ignores anything else", async () => {
    const parent = { postMessage: vi.fn() };
    const fakeWin = Object.assign(new EventTarget(), { parent }) as unknown as Window;
    const t = parentFrameTransport(fakeWin);
    const got: unknown[] = [];
    t.listen((d) => got.push(d));
    t.send({ v: 1, t: "ready" });
    expect(parent.postMessage).toHaveBeenCalledWith({ type: FRAME_TO_NATIVE, msg: { v: 1, t: "ready" } }, "*");
    fakeWin.dispatchEvent(new MessageEvent("message", { data: { type: FRAME_TO_WEB, msg: { v: 1, t: "focus.release" } }, source: parent as unknown as Window }));
    fakeWin.dispatchEvent(new MessageEvent("message", { data: { type: "something-else", msg: 1 }, source: parent as unknown as Window }));
    fakeWin.dispatchEvent(new MessageEvent("message", { data: { type: FRAME_TO_WEB, msg: 2 }, source: null }));
    expect(got).toEqual([{ v: 1, t: "focus.release" }]);
  });

  it("detectTransport returns null for a top-level page with no host", () => {
    expect(detectTransport(window)).toBeNull();
  });
});

describe("memory (tests)", () => {
  it("round-trips through JSON like the real hosts and delivers by hand", () => {
    const t = memoryTransport();
    const got: unknown[] = [];
    t.listen((d) => got.push(d));
    const msg = { v: 1, t: "x", when: undefined, n: 1 };
    t.send(msg);
    expect(t.sent).toEqual([{ v: 1, t: "x", n: 1 }]);
    t.deliver("hello");
    expect(got).toEqual(["hello"]);
    t.clear();
    expect(t.sent).toEqual([]);
  });
});
