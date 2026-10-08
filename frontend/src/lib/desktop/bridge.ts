/**
 * The website's side of the MasterSAT app for Windows (`desktop/` in the repo root).
 *
 * The app is a Tauri window that loads these very pages from https://mastersat.uz, so the
 * site runs in two places: a browser, where everything here is a no-op, and the app, where
 * these calls reach the native shell — the part that can do what a page cannot (lock the
 * keyboard, keep the screen awake, hide the window from screenshots, read the battery).
 *
 * Every call goes through `invoke`, which the shell injects into its own windows only. The
 * shell accepts them from https://mastersat.uz alone (its Tauri capability), so another site
 * opened inside the app cannot drive the lockdown.
 *
 * Command names and payloads are the contract with `desktop/src-tauri/src/commands.rs`.
 */

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

interface TauriInternals {
  invoke: Invoke;
}

function internals(): TauriInternals | null {
  if (typeof window === "undefined") return null;
  const t = (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
  return t && typeof t.invoke === "function" ? t : null;
}

/** True inside the MasterSAT Windows app; false in every browser. */
export function isDesktopShell(): boolean {
  return internals() !== null;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const t = internals();
  if (!t) throw new Error(`Not running in the MasterSAT app (${cmd})`);
  return t.invoke<T>(cmd, args);
}

// ── the machine check ─────────────────────────────────────────────────────────

/** A program that must be closed before a midterm (it could show answers or share the screen). */
export interface BlockedApp {
  /** Process image name, e.g. "Telegram.exe" — what `closeApp` takes. */
  exe: string;
  /** What to call it on screen, e.g. "Telegram". */
  name: string;
  /** False for a program the app cannot close itself (it runs as a Windows service). */
  closable: boolean;
}

export interface PrecheckReport {
  /** Every check passed: the app may lock down. */
  ok: boolean;
  displays: number;
  /** Remote Desktop session. */
  remote: boolean;
  /** Running inside a virtual machine. */
  vm: boolean;
  apps: BlockedApp[];
}

export interface LockdownProof {
  key_id: string;
  mac: string;
  app_version: string;
  /** The exact JSON string that was signed — sent to the server unchanged. */
  precheck: string;
}

export interface BatteryStatus {
  /** 0–100, or null when Windows does not know. */
  percent: number | null;
  charging: boolean;
  /** False on a desktop PC (no battery at all). */
  has_battery: boolean;
}

export interface AppInfo {
  version: string;
}

export const desktop = {
  appInfo: () => invoke<AppInfo>("app_info"),

  /** Check the machine without locking anything (the pre-check screen polls this). */
  precheck: () => invoke<PrecheckReport>("lockdown_precheck"),
  /** Close a blocked program on the student's behalf. */
  closeApp: (exe: string) => invoke<void>("lockdown_close_app", { exe }),
  /** Lock the machine down. Refused (ok:false, nothing locked) unless the pre-check passes. */
  enter: () => invoke<PrecheckReport>("lockdown_enter"),
  /** Sign the server's challenge. Fails unless the lockdown is active. */
  prove: (attemptId: number, nonce: string) => invoke<LockdownProof>("lockdown_prove", { attemptId, nonce }),
  /** Release everything. Safe to call when nothing is locked. */
  exit: () => invoke<void>("lockdown_exit"),
  /** "This page is alive." Without it for 10 seconds the shell releases the lockdown itself. */
  heartbeat: () => invoke<void>("lockdown_heartbeat"),

  battery: () => invoke<BatteryStatus | null>("battery_status"),

  /** Start "Sign in with browser": the shell makes the PKCE verifier and opens the browser. */
  beginBrowserSignIn: () => invoke<void>("auth_begin"),
  /** The verifier for the code that just came back (once; null if there is none). */
  takeVerifier: () => invoke<string | null>("auth_take_verifier"),

  /** Open a page in the student's own browser (a full report, the download page). */
  openExternal: (url: string) => invoke<void>("open_external", { url }),
};

// ── the shell's own "the student left" signal ─────────────────────────────────
// Some absences never reach the page as blur/visibility events — a second monitor plugged in,
// a blocked program starting up. The shell reports those by dispatching this event; the
// off-screen guard treats `away` exactly like a lost focus, so the server's three-strike rule
// applies unchanged.

export const SHELL_AWAY_EVENT = "mastersat:away";

let shellAway = false;

if (typeof window !== "undefined") {
  window.addEventListener(SHELL_AWAY_EVENT, (e) => {
    shellAway = Boolean((e as CustomEvent<{ away?: boolean }>).detail?.away);
  });
}

/** Whether the shell currently says the student is away from the exam. */
export function shellReportsAway(): boolean {
  return shellAway;
}
