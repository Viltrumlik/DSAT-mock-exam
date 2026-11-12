"use client";

import type { ReactNode } from "react";

import { Alert } from "../consoleKit";
import { money, plural } from "../format";
import { BOX, CAPTION_TEXT, SkippedList, TEXT_BUTTON } from "../panelKit";
import type { Skipped } from "../smsApi";

export interface Figures {
  count: number;
  noPhone: number;
  /** Known once a template is chosen. */
  parts?: number;
  cost?: number;
}

/** "142 students · 3 no phone · 284 parts · ~48 280 so'm". */
export function figuresLine(f: Figures): string {
  const bits = [plural(f.count, "student"), `${f.noPhone} no phone`];
  if (f.parts !== undefined) bits.push(plural(f.parts, "part"));
  if (f.cost !== undefined) bits.push(`~${money(f.cost)}`);
  return bits.join(" · ");
}

function BalanceLine({ cost, balance }: { cost: number; balance: number | null | undefined }) {
  if (balance === null || balance === undefined) return <p className="text-[13px] text-ms-fg-3">balance not known</p>;
  if (cost <= balance) return <p className="text-[13px] font-medium text-ms-positive-fg">balance OK</p>;
  return <p className="text-[13px] font-semibold text-ms-critical-fg">balance short by {money(cost - balance)}</p>;
}

/** What the send comes to, as the server worked it out for exactly what the cards now say. */
export function SummaryCard({
  figures,
  checking,
  error,
  onRetry,
  balance,
  overLimit,
  limit,
  skipped,
  children,
}: {
  figures: Figures | null;
  checking: boolean;
  error: string | null;
  onRetry: () => void;
  balance: number | null | undefined;
  overLimit: boolean;
  limit: number;
  skipped: Skipped | undefined;
  /** The Send button. */
  children: ReactNode;
}) {
  const nobody = figures?.count === 0;
  const leftOut = Object.values(skipped ?? {}).some((people) => (people?.length ?? 0) > 0);

  return (
    <section className={`${BOX} space-y-2 p-3`}>
      {error ? (
        <Alert tone="danger">
          {error}{" "}
          <button type="button" className={TEXT_BUTTON} onClick={onRetry}>
            Try again
          </button>
        </Alert>
      ) : figures ? (
        <p className={`text-[13px] font-semibold tabular-nums text-ms-fg ${checking ? "opacity-60" : ""}`} aria-busy={checking}>
          {figuresLine(figures)}
        </p>
      ) : (
        <p className="text-[13px] text-ms-fg-3">Choose who gets it and what it says.</p>
      )}
      {!error && figures?.cost !== undefined ? <BalanceLine cost={figures.cost} balance={balance} /> : null}
      {!error && overLimit && figures ? (
        <Alert tone="danger">
          More than {limit} recipients ({figures.count}) — narrow the audience.
        </Alert>
      ) : !error && nobody ? (
        <Alert tone="warning">Nobody would receive it — see who is left out below.</Alert>
      ) : null}
      {!error && leftOut ? (
        <details>
          <summary className={`${CAPTION_TEXT} cursor-pointer`}>Left out</summary>
          <div className="mt-1">
            <SkippedList skipped={skipped} />
          </div>
        </details>
      ) : null}
      {children}
    </section>
  );
}
