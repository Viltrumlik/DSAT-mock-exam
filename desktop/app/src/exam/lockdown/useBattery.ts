/**
 * The laptop's battery, read from Windows through the shell (dev: the dev panel's choice). Null on
 * a desktop PC — there is nothing to show. Ported from the site's lib/desktop/useBattery.ts.
 *
 * Importers: exam/lockdown/LockdownScreens.tsx (pre-check row), exam/midterm/MidtermScreen.tsx.
 */
import { useEffect, useState } from "react";

import { devLockdown } from "@/lib/devLockdown";
import { DEV_MOCK } from "@/lib/env";
import { native, type BatteryStatus } from "@/lib/native";

/** Bluebook-style warning threshold: under a quarter, unplugged. */
export const LOW_BATTERY_PERCENT = 25;

const POLL_MS = 30_000;

/** Whether to warn: a laptop, on battery, under the threshold. */
export function isLowBattery(b: BatteryStatus | null | undefined): boolean {
  return Boolean(b && b.has_battery && !b.charging && b.percent != null && b.percent < LOW_BATTERY_PERCENT);
}

export function useBattery(): BatteryStatus | null {
  const [battery, setBattery] = useState<BatteryStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      try {
        const b = await native.batteryStatus();
        if (!cancelled) setBattery(b && b.has_battery ? b : null);
      } catch {
        /* the indicator just keeps its last reading */
      }
    };
    void read();
    const t = setInterval(read, POLL_MS);
    // Dev: reflect the panel's battery choice at once instead of on the next 30 s poll.
    const unsub = DEV_MOCK ? devLockdown.subscribe(() => void read()) : () => {};
    return () => {
      cancelled = true;
      clearInterval(t);
      unsub();
    };
  }, []);
  return battery;
}
