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
import { devLockdown } from "./devLockdown";
import { IS_TAURI } from "./env";

export interface AppInfo {
  version: string;
}

/** A program that must be closed before a midterm (`closable` false: a service the student stops). */
export interface BlockedApp {
  exe: string;
  name: string;
  closable: boolean;
}

/** The machine, as the shell finds it. `ok` is the one gate `lockdown_enter` reads. */
export interface PrecheckReport {
  ok: boolean;
  displays: number;
  remote: boolean;
  vm: boolean;
  apps: BlockedApp[];
}

/**
 * The shell's signature over the server's challenge. snake_case because it is a plain serde
 * struct; `precheck` is the exact JSON STRING that was signed — forward it byte for byte. The
 * nonce is NOT in here: the desktop_session body is `{ nonce, ...proof }`.
 */
export interface LockdownProof {
  key_id: string;
  mac: string;
  app_version: string;
  precheck: string;
}

export interface BatteryStatus {
  percent: number | null;
  charging: boolean;
  has_battery: boolean;
}

/**
 * The shell's word for an absence the page never hears about (focus stolen, a second monitor
 * plugged in). Rust dispatches it as a plain DOM CustomEvent through `eval` — NOT a Tauri event,
 * so `listen()` would never receive it. See desktop/src-tauri/src/main.rs (away watcher).
 */
export const SHELL_AWAY_EVENT = "mastersat:away";

// The shell only speaks on a change, so the last word is kept here for the off-screen guard to
// read at any moment. Installed once at module load, in both modes (dev fires the same event).
let shellAway = false;
if (typeof window !== "undefined") {
  window.addEventListener(SHELL_AWAY_EVENT, (e) => {
    shellAway = !!(e as CustomEvent<{ away?: boolean }>).detail?.away;
  });
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
      // Matches window.emit("auth-code", code) in desktop/src-tauri/src/main.rs.
      const u = await listen<string>("auth-code", (e) => cb(e.payload));
      if (cancelled) u();
      else unlisten = u;
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  },

  // ───────────────────────── midterm lockdown ─────────────────────────
  // Order matters and is enforced by the shell: enter → heartbeat → (challenge) → prove. A proof
  // is refused unless the machine is locked, so a page that never locked cannot mint one.

  /** What would stop this machine locking down. Safe to poll; changes nothing. */
  async lockdownPrecheck(): Promise<PrecheckReport> {
    if (!IS_TAURI) return devLockdown.precheck();
    const { invoke } = await core();
    return invoke<PrecheckReport>("lockdown_precheck");
  },

  /** Close one blocked program the pre-check named (only ones on the shell's list). */
  async lockdownCloseApp(exe: string): Promise<void> {
    if (!IS_TAURI) {
      await new Promise((r) => setTimeout(r, 400));
      devLockdown.closeApp(exe);
      return;
    }
    const { invoke } = await core();
    await invoke("lockdown_close_app", { exe });
  },

  /**
   * Lock the machine — only if the pre-check passes. A failing machine gets the report back with
   * `ok:false` and NOTHING is locked. Goes fullscreen + always-on-top on success.
   */
  async lockdownEnter(): Promise<PrecheckReport> {
    shellAway = false; // the shell resets its away state on enter without saying so
    if (!IS_TAURI) return devLockdown.enter();
    const { invoke } = await core();
    return invoke<PrecheckReport>("lockdown_enter");
  },

  /** Sign the server's challenge for this sitting. Rejects "The app is not locked down." unless locked. */
  async lockdownProve(attemptId: number, nonce: string): Promise<LockdownProof> {
    if (!IS_TAURI) {
      if (!devLockdown.get().locked) throw new Error("The app is not locked down.");
      return { key_id: "dev1", mac: "dev", app_version: "dev", precheck: JSON.stringify(devLockdown.precheck()) };
    }
    const { invoke } = await core();
    // Tauri v2 maps JS camelCase args to Rust snake_case: attemptId → attempt_id.
    return invoke<LockdownProof>("lockdown_prove", { attemptId, nonce });
  },

  /** Release everything. Safe to call when nothing is locked. */
  async lockdownExit(): Promise<void> {
    shellAway = false;
    if (!IS_TAURI) {
      devLockdown.exit();
      return;
    }
    const { invoke } = await core();
    await invoke("lockdown_exit");
  },

  /**
   * "The exam page is alive." The shell releases the lock itself after 10 s without one. Returns
   * whether the machine is STILL locked — false means the watchdog already let go (the page hung
   * long enough), and the caller must lock again. An older shell returned nothing: null.
   */
  async lockdownHeartbeat(): Promise<boolean | null> {
    if (!IS_TAURI) return devLockdown.heartbeat();
    const { invoke } = await core();
    const still = await invoke<boolean | null>("lockdown_heartbeat");
    return typeof still === "boolean" ? still : null;
  },

  /** The laptop's battery; null on a desktop PC or when Windows doesn't know. */
  async batteryStatus(): Promise<BatteryStatus | null> {
    if (!IS_TAURI) return devLockdown.battery();
    const { invoke } = await core();
    return (await invoke<BatteryStatus | null>("battery_status")) ?? null;
  },

  /** The shell's last away report (see SHELL_AWAY_EVENT). Always false in a browser. */
  shellReportsAway(): boolean {
    return shellAway;
  },

  /** Forget a stale away report — the shell resets its own on enter/exit/watchdog silently. */
  resetShellAway(): void {
    shellAway = false;
  },
};
