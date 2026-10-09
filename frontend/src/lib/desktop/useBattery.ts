"use client";
import { useEffect, useState } from "react";

import { type BatteryStatus, desktop, isDesktopShell } from "./bridge";

/** Bluebook-style warning threshold: under a quarter, unplugged. */
export const LOW_BATTERY_PERCENT = 25;

const POLL_MS = 30_000;

/** Whether to warn: a laptop, on battery, under the threshold. */
export function isLowBattery(b: BatteryStatus | null | undefined): boolean {
  return Boolean(b && b.has_battery && !b.charging && b.percent != null && b.percent < LOW_BATTERY_PERCENT);
}

/**
 * The laptop's battery, read from Windows through the app's shell. Null in a browser and on
 * a desktop PC — there is nothing to show either way.
 */
export function useBattery(): BatteryStatus | null {
  const [battery, setBattery] = useState<BatteryStatus | null>(null);
  useEffect(() => {
    if (!isDesktopShell()) return;
    let cancelled = false;
    const read = async () => {
      try {
        const b = await desktop.battery();
        if (!cancelled) setBattery(b && b.has_battery ? b : null);
      } catch {
        /* the indicator just keeps its last reading */
      }
    };
    void read();
    const t = setInterval(read, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);
  return battery;
}
