/**
 * Dev-only stand-in for the Windows shell's lockdown and the midterm server's refusals, so every
 * lockdown path — a failing pre-check, closing Telegram, the lock, the watchdog, an away spell,
 * a refused bind, a dropped connection — can be walked through under plain `vite dev` with no
 * Rust and no server. Only reached when DEV_MOCK is true (the real .exe is always IS_TAURI).
 *
 * Importers: lib/native.ts (the shell stubs), exam/mock.ts (the server's refusals),
 * exam/lockdown/DevLockdownPanel.tsx (the controls).
 */
import type { BatteryStatus, PrecheckReport } from "./native";

export type DevScenario = "clean" | "two_screens" | "telegram" | "tray_app" | "remote" | "vm" | "throws";
export type DevBattery = "none" | "full" | "low" | "low_charging";
export type DevBindFault = "none" | "desktop_challenge_invalid" | "desktop_proof_invalid" | "desktop_update_required" | "desktop_not_live";

export interface DevLockdownState {
  scenario: DevScenario;
  closed: string[];
  battery: DevBattery;
  locked: boolean;
  lastBeat: number;
  /** The server's MIDTERM_DESKTOP_REQUIRED for this sitting. */
  desktopRequired: boolean;
  requiresCode: boolean;
  /** Module 1 runs 20 seconds, to watch the paper submit itself at 0:00. */
  shortModule: boolean;
  /**
   * The off-screen guard hears ONLY the shell's away events (the panel's buttons), not browser
   * focus/visibility — a backgrounded dev tab or devtools focus would read as a permanent absence.
   */
  guardPaused: boolean;
  /** The next N requests fail as if the network dropped. */
  dropNext: number;
  /** The next bind is refused with this reason. */
  bindFault: DevBindFault;
  /** The next lockdown-guarded request answers desktop_session_replaced. */
  replaceSession: boolean;
}

const state: DevLockdownState = {
  scenario: "clean",
  closed: [],
  battery: "full",
  locked: false,
  lastBeat: 0,
  desktopRequired: true,
  requiresCode: false,
  shortModule: false,
  guardPaused: false,
  dropNext: 0,
  bindFault: "none",
  replaceSession: false,
};

const listeners = new Set<() => void>();
let watchdog: ReturnType<typeof setInterval> | null = null;

function emit() {
  for (const l of listeners) l();
}

export const devLockdown = {
  get: (): DevLockdownState => state,
  set(patch: Partial<DevLockdownState>) {
    Object.assign(state, patch);
    emit();
  },
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },

  precheck(): PrecheckReport {
    if (state.scenario === "throws") throw new Error("dev: the shell could not run the check");
    const apps =
      state.scenario === "telegram" && !state.closed.includes("telegram.exe")
        ? [{ exe: "telegram.exe", name: "Telegram", closable: true }]
        : state.scenario === "tray_app"
          ? [{ exe: "teamviewer_service.exe", name: "TeamViewer", closable: false }]
          : [];
    const displays = state.scenario === "two_screens" ? 2 : 1;
    const remote = state.scenario === "remote";
    const vm = state.scenario === "vm";
    return { ok: displays <= 1 && !remote && !vm && apps.length === 0, displays, remote, vm, apps };
  },

  closeApp(exe: string) {
    state.closed = [...state.closed, exe];
    emit();
  },

  enter(): PrecheckReport {
    const report = devLockdown.precheck();
    if (report.ok) {
      state.locked = true;
      state.lastBeat = Date.now();
      // The shell's watchdog: 10 s without a heartbeat releases the lock (pause JS to see it).
      if (!watchdog) {
        watchdog = setInterval(() => {
          if (state.locked && Date.now() - state.lastBeat > 10_000) {
            state.locked = false;
            emit();
          }
        }, 1000);
      }
      emit();
    }
    return report;
  },

  exit() {
    state.locked = false;
    emit();
  },

  heartbeat(): boolean {
    if (state.locked) state.lastBeat = Date.now();
    return state.locked;
  },

  battery(): BatteryStatus | null {
    switch (state.battery) {
      case "none":
        return null;
      case "full":
        return { percent: 80, charging: false, has_battery: true };
      case "low":
        return { percent: 18, charging: false, has_battery: true };
      case "low_charging":
        return { percent: 18, charging: true, has_battery: true };
    }
  },

  /** A dev "away" spell: the shell reports the window lost, then back after `ms`. */
  awayFor(ms: number) {
    window.dispatchEvent(new CustomEvent("mastersat:away", { detail: { away: true } }));
    setTimeout(() => window.dispatchEvent(new CustomEvent("mastersat:away", { detail: { away: false } })), ms);
  },

  /** Consume one queued network drop. */
  takeDrop(): boolean {
    if (state.dropNext <= 0) return false;
    state.dropNext -= 1;
    emit();
    return true;
  },
};
