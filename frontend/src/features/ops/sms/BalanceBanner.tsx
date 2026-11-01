"use client";

import { Alert } from "@/components/ui";
import { money } from "./format";
import type { Forecast } from "./smsApi";

/**
 * Red, above every SMS tab, while the balance will not cover the next 24 hours (owner, 2026-11-01:
 * the panel only, no SMS or Telegram). 1 November's run met an empty balance with no warning; now
 * it is said the day before, with what the money is for.
 */
export function BalanceBanner({ forecast }: { forecast: Forecast }) {
  if (!forecast.short) return null;
  return (
    <Alert tone="danger">
      {`Balance ${money(forecast.balance)} does not cover the next 24 hours (~${money(forecast.total)}): ` +
        `debt warnings ${money(forecast.debt)}, campaigns ${money(forecast.campaigns)}, automations ${money(forecast.automations)}.`}
    </Alert>
  );
}
