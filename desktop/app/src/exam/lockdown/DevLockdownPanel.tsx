/**
 * Dev-only controls for the midterm lockdown: precheck scenarios, battery, the server's flags, an
 * away spell, the shell's watchdog letting go, dropped requests and refused binds — every path of
 * the lockdown walkable under `vite dev` with no Rust and no server. Mounted only when
 * DEV_MOCK && import.meta.env.DEV (never in the real .exe).
 *
 * Importer: exam/midterm/MidtermScreen.tsx.
 */
import { useEffect, useState } from "react";

import { devLockdown, type DevBattery, type DevBindFault, type DevScenario } from "@/lib/devLockdown";

const SCENARIOS: [DevScenario, string][] = [
  ["clean", "Clean machine"],
  ["two_screens", "2 screens"],
  ["telegram", "Telegram open"],
  ["tray_app", "Tray app (not closable)"],
  ["remote", "Remote Desktop"],
  ["vm", "Virtual machine"],
  ["throws", "Shell check fails"],
];

const BATTERIES: [DevBattery, string][] = [
  ["full", "80%"],
  ["low", "18% unplugged"],
  ["low_charging", "18% charging"],
  ["none", "Desktop PC"],
];

const FAULTS: [DevBindFault, string][] = [
  ["none", "—"],
  ["desktop_challenge_invalid", "challenge expired"],
  ["desktop_proof_invalid", "proof invalid"],
  ["desktop_update_required", "update required (426)"],
  ["desktop_not_live", "not live (409)"],
];

export function DevLockdownPanel() {
  const [, force] = useState(0);
  const [open, setOpen] = useState(true);
  useEffect(() => devLockdown.subscribe(() => force((n) => n + 1)), []);
  const s = devLockdown.get();

  const btn = "rounded-md border border-slate-600 px-2 py-1 text-[11px] font-semibold hover:bg-slate-700";
  const sel = "w-full rounded-md border border-slate-600 bg-slate-800 px-1.5 py-1 text-[11px]";
  const row = "flex items-center justify-between gap-2";

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-3 left-3 z-[100] rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-white shadow-lg"
      >
        Lockdown (dev) {s.locked ? "🔒" : "🔓"}
      </button>
    );
  }

  return (
    <div className="fixed bottom-3 left-3 z-[100] w-64 space-y-2 rounded-xl bg-slate-900/95 p-3 text-white shadow-2xl">
      <div className={row}>
        <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-300">Lockdown (dev)</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${s.locked ? "bg-emerald-600" : "bg-slate-600"}`}>
          {s.locked ? "LOCKED" : "unlocked"}
        </span>
        <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-white">
          ×
        </button>
      </div>

      <label className="block text-[10px] font-bold uppercase text-slate-400">
        Pre-check
        <select className={sel} value={s.scenario} onChange={(e) => devLockdown.set({ scenario: e.target.value as DevScenario, closed: [] })}>
          {SCENARIOS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-[10px] font-bold uppercase text-slate-400">
        Battery
        <select className={sel} value={s.battery} onChange={(e) => devLockdown.set({ battery: e.target.value as DevBattery })}>
          {BATTERIES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-1 text-[11px]">
        {(
          [
            ["desktopRequired", "Bind required"],
            ["requiresCode", "Code (123456)"],
            ["shortModule", "20 s modules"],
            ["guardPaused", "Shell events only"],
          ] as const
        ).map(([k, l]) => (
          <label key={k} className="flex items-center gap-1.5">
            <input type="checkbox" checked={s[k]} onChange={(e) => devLockdown.set({ [k]: e.target.checked })} />
            {l}
          </label>
        ))}
      </div>

      <div className="flex flex-wrap gap-1">
        <button type="button" className={btn} onClick={() => devLockdown.awayFor(2000)}>
          Away 2s
        </button>
        <button type="button" className={btn} onClick={() => devLockdown.awayFor(8000)}>
          Away 8s
        </button>
        <button type="button" className={btn} onClick={() => devLockdown.exit()} title="As if the page stalled > 10 s">
          Watchdog lets go
        </button>
        <button type="button" className={btn} onClick={() => devLockdown.set({ dropNext: s.dropNext + 3 })}>
          Drop next 3 {s.dropNext ? `(${s.dropNext})` : ""}
        </button>
        <button type="button" className={btn} onClick={() => devLockdown.set({ replaceSession: true })}>
          Other window binds
        </button>
      </div>

      <label className="block text-[10px] font-bold uppercase text-slate-400">
        Next bind refused
        <select className={sel} value={s.bindFault} onChange={(e) => devLockdown.set({ bindFault: e.target.value as DevBindFault })}>
          {FAULTS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
