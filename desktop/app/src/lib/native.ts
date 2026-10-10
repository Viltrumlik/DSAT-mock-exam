/**
 * The bridge to the Tauri shell: the native commands and events the app's own window may use.
 * Mirrors the command contract in `desktop/src-tauri/src/main.rs`.
 *
 * In plain-browser dev (no Tauri) every call is stubbed so the whole flow runs without the .exe:
 * `authBegin` fakes the browser round-trip by firing a sign-in code a moment later.
 *
 * Importer: lib/useAuth.tsx. The Tauri packages are imported lazily so the dev bundle never
 * pulls them in and never executes them outside the shell.
 */
import { IS_TAURI } from "./env";

export interface AppInfo {
  version: string;
}

async function core() {
  return import("@tauri-apps/api/core");
}

export const native = {
  async appInfo(): Promise<AppInfo> {
    if (!IS_TAURI) return { version: "dev" };
    const { invoke } = await core();
    return invoke<AppInfo>("app_info");
  },

  /** Begin "Sign in with browser": the shell makes a PKCE verifier and opens the student's browser. */
  async authBegin(): Promise<void> {
    if (!IS_TAURI) {
      // dev: pretend the student signed in and the browser handed a code back.
      setTimeout(
        () => window.dispatchEvent(new CustomEvent<string>("mastersat:dev-auth-code", { detail: "dev-code" })),
        1200,
      );
      return;
    }
    const { invoke } = await core();
    await invoke("auth_begin");
  },

  /** Take the in-flight PKCE verifier (once). It is paired with the code from the deep link. */
  async authTakeVerifier(): Promise<string | null> {
    if (!IS_TAURI) return "dev-verifier";
    const { invoke } = await core();
    return (await invoke<string | null>("auth_take_verifier")) ?? null;
  },

  async openExternal(url: string): Promise<void> {
    if (!IS_TAURI) {
      window.open(url, "_blank", "noopener");
      return;
    }
    const { invoke } = await core();
    await invoke("open_external", { url });
  },

  /**
   * The browser handed a sign-in code back through the `mastersat://auth` deep link; the shell
   * forwards it to the app as an event (wired on the Rust side in Phase 2b). Returns an unlisten.
   */
  onAuthCode(cb: (code: string) => void): () => void {
    if (!IS_TAURI) {
      const h = (e: Event) => cb((e as CustomEvent<string>).detail);
      window.addEventListener("mastersat:dev-auth-code", h as EventListener);
      return () => window.removeEventListener("mastersat:dev-auth-code", h as EventListener);
    }
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const u = await listen<string>("mastersat://auth-code", (e) => cb(e.payload));
      if (cancelled) u();
      else unlisten = u;
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  },
};
