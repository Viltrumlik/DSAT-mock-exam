// The island <-> native transport (architecture.md §2.7), pluggable so the same page runs in
// every host:
//
//   webview2  Windows. Native -> web: PostWebMessageAsJson, read on window.chrome.webview
//             'message'. Web -> native: window.chrome.webview.postMessage(obj).
//   webkit    macOS dev runner. Web -> native: webkit.messageHandlers.ms.postMessage(json);
//             native -> web: runJavaScript("window.msIsland.receive(<json>)").
//   parent    The page sits in an <iframe> (dev.html harness): window.parent.postMessage.
//   memory    Tests: messages are queued in memory and delivered by hand.
//
// A transport only moves values. Validation against protocol/schema.json happens in
// channel.ts, in both directions.

export type TransportName = "webview2" | "webkit" | "parent" | "memory";

export interface IslandTransport {
  readonly name: TransportName;
  /** Island -> native. `msg` is a plain JSON-able object. */
  send(msg: unknown): void;
  /** Native -> island. Returns an unsubscribe function. */
  listen(cb: (data: unknown) => void): () => void;
}

/** Envelope used by the iframe transport so stray window messages are ignored. */
export const FRAME_TO_NATIVE = "ms-island:to-native";
export const FRAME_TO_WEB = "ms-island:to-web";

/** `msIsland.receive` fan-out shared by the webkit transport and manual pushes. */
function installReceiveHook(win: Window): Set<(data: unknown) => void> {
  const existing = (win as Window & { __msIslandSinks?: Set<(data: unknown) => void> }).__msIslandSinks;
  if (existing) return existing;
  const sinks = new Set<(data: unknown) => void>();
  (win as Window & { __msIslandSinks?: Set<(data: unknown) => void> }).__msIslandSinks = sinks;
  win.msIsland = {
    build: typeof __ISLAND_BUILD__ === "string" ? __ISLAND_BUILD__ : "island/dev",
    receive(data: unknown) {
      for (const sink of sinks) sink(data);
    },
  };
  return sinks;
}

export function webview2Transport(win: Window): IslandTransport {
  const wv = win.chrome?.webview;
  if (!wv) throw new Error("window.chrome.webview is not available");
  return {
    name: "webview2",
    send(msg) {
      wv.postMessage(msg);
    },
    listen(cb) {
      const listener = (event: { data: unknown }) => cb(event.data);
      wv.addEventListener("message", listener);
      return () => wv.removeEventListener("message", listener);
    },
  };
}

export function webkitTransport(win: Window): IslandTransport {
  const handler = win.webkit?.messageHandlers?.ms;
  if (!handler) throw new Error("webkit.messageHandlers.ms is not available");
  const sinks = installReceiveHook(win);
  return {
    name: "webkit",
    send(msg) {
      // A string, so the Dart side receives exactly the JSON it validates (decodeIncoming).
      handler.postMessage(JSON.stringify(msg));
    },
    listen(cb) {
      sinks.add(cb);
      return () => sinks.delete(cb);
    },
  };
}

export function parentFrameTransport(win: Window): IslandTransport {
  const parent = win.parent;
  return {
    name: "parent",
    send(msg) {
      parent.postMessage({ type: FRAME_TO_NATIVE, msg }, "*");
    },
    listen(cb) {
      const listener = (event: MessageEvent) => {
        if (event.source !== parent) return;
        const data = event.data as { type?: unknown; msg?: unknown } | null;
        if (data && data.type === FRAME_TO_WEB) cb(data.msg);
      };
      win.addEventListener("message", listener);
      return () => win.removeEventListener("message", listener);
    },
  };
}

/** In-memory transport for tests: `sent` collects island -> native, `deliver` pushes native -> island. */
export interface MemoryTransport extends IslandTransport {
  readonly sent: unknown[];
  deliver(data: unknown): void;
  clear(): void;
}

export function memoryTransport(): MemoryTransport {
  const sinks = new Set<(data: unknown) => void>();
  const sent: unknown[] = [];
  return {
    name: "memory",
    sent,
    send(msg) {
      // Round-trip through JSON exactly like the real hosts do.
      sent.push(JSON.parse(JSON.stringify(msg)));
    },
    listen(cb) {
      sinks.add(cb);
      return () => sinks.delete(cb);
    },
    deliver(data) {
      for (const sink of [...sinks]) sink(data);
    },
    clear() {
      sent.length = 0;
    },
  };
}

/** Pick the host's transport. WebView2 wins, then WebKit, then an embedding frame. */
export function detectTransport(win: Window = window): IslandTransport | null {
  if (win.chrome?.webview) return webview2Transport(win);
  if (win.webkit?.messageHandlers?.ms) return webkitTransport(win);
  if (win.parent && win.parent !== win) return parentFrameTransport(win);
  return null;
}
