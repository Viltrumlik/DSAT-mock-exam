/// <reference types="vite/client" />

/** desktop-native/VERSION as `island/<version>` (vite.config.ts). Sent in `ready.build`. */
declare const __ISLAND_BUILD__: string;
/** The Desmos API key, injected at build time (vite.config.ts). */
declare const __DESMOS_API_KEY__: string;

interface Window {
  /** WebView2 (Windows). */
  chrome?: {
    webview?: {
      postMessage(message: unknown): void;
      addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
      removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
    };
  };
  /** WKWebView (the macOS dev runner). */
  webkit?: { messageHandlers?: { ms?: { postMessage(message: unknown): void } } };
  /** The island's inbound hook for hosts that push with runJavaScript (macOS shim). */
  msIsland?: { receive(data: unknown): void; build: string };
}
