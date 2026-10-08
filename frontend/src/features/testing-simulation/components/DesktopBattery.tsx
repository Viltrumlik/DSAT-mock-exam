"use client";
import { useEffect, useState } from "react";
import { BatteryCharging, BatteryFull, BatteryLow, BatteryMedium, BatteryWarning, X } from "lucide-react";

import type { BatteryStatus } from "@/lib/desktop/bridge";
import { isLowBattery } from "@/lib/desktop/useBattery";

/** Top-right battery reading, as Bluebook shows it. Renders nothing without a battery. */
export function BatteryIndicator({ battery }: { battery: BatteryStatus | null }) {
  if (!battery || battery.percent == null) return null;
  const low = isLowBattery(battery);
  const Icon = battery.charging
    ? BatteryCharging
    : low
      ? BatteryWarning
      : battery.percent >= 60
        ? BatteryFull
        : battery.percent >= 30
          ? BatteryMedium
          : BatteryLow;
  return (
    <div
      role="status"
      aria-label={`Battery ${battery.percent}%${battery.charging ? ", charging" : ""}`}
      className={`flex flex-col items-center gap-0.5 text-xs font-semibold tabular-nums ${
        low ? "text-red-600" : "text-slate-900"
      }`}
    >
      <Icon className="h-5 w-5" aria-hidden />
      {battery.percent}%
    </div>
  );
}

/** Under the header while the laptop is unplugged below the threshold. Plugging in clears it. */
export function LowBatteryBanner({ battery }: { battery: BatteryStatus | null }) {
  const low = isLowBattery(battery);
  const [dismissed, setDismissed] = useState(false);
  // A new low spell (charged, then unplugged again) warns again.
  useEffect(() => {
    if (!low) setDismissed(false);
  }, [low]);
  if (!low || dismissed || !battery) return null;
  return (
    <div
      role="alert"
      className="flex shrink-0 items-center justify-center gap-3 border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm font-semibold text-amber-900"
    >
      <BatteryWarning className="h-4 w-4" aria-hidden />
      <span>Your battery is low ({battery.percent}%). Plug in your device.</span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss battery warning"
        className="rounded p-1 hover:bg-amber-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
