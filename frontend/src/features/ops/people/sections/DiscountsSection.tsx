"use client";

import { useState } from "react";
import { P } from "@/features/ops/permissions";
import { useCan } from "@/features/ops/useCan";
import { NotKept } from "@/features/ops/detail/NotKept";
import { dayText } from "@/features/ops/detail/groupFacts";
import { Button, signedAmount } from "@/features/console/ui";
import type { LedgerSeat } from "@/features/finance/billingApi";
import { useLedgerAccount } from "@/features/finance/billingHooks";
import { SeatPriceForm } from "@/features/finance/LedgerEntryForm";
import { PartBody } from "../Fieldset";

/**
 * The profile's Discounts tab, lc-up's "Chegirma" (22 Nov 2026): the centre's own ledger keeps a price agreed for
 * one student in one group (`billing.Seat.personal_price`, 0 a grant) and who changed it, when and why. That is the
 * discount this system has; lc-up's from–to dates and the teacher-share switch are not kept. Whoever sets prices
 * (`set_prices`) changes one here with the ledger's own form.
 */

function priceWord(price: number | null): string {
  if (price === null) return "group price";
  return price === 0 ? "grant" : `${signedAmount(price)} so'm`;
}

export function DiscountsSection({ accountId }: { accountId: number | null }) {
  if (accountId === null) {
    return <NotKept>No discounts: this student has no account in the centre&apos;s ledger yet.</NotKept>;
  }
  return <Discounts accountId={accountId} />;
}

function Discounts({ accountId }: { accountId: number }) {
  const can = useCan();
  const [editing, setEditing] = useState<number | null>(null);
  const query = useLedgerAccount(accountId);
  return (
    <section aria-label="Discounts" className="flex flex-col gap-3">
      <h2 className="text-ms-h text-ms-fg">Discounts</h2>
      <p className="text-[13px] text-ms-fg-3">A price agreed for this student in one group, from the centre&apos;s ledger.</p>
      <PartBody
        query={query}
        isEmpty={() => false}
        render={(account) => {
          const seats = account.seats.filter((s: LedgerSeat) => s.state !== "left" || s.personal_price !== null);
          if (!seats.length) return <p className="text-ms-fg-2">Not in any group in the ledger.</p>;
          return (
            <div className="overflow-x-auto rounded-ms-ctl border border-ms-grid">
              <table className="w-full min-w-[560px] text-[14px]">
                <thead>
                  <tr>
                    <th scope="col" className="px-3 text-left">Group</th>
                    <th scope="col" className="px-3 text-right">Group price, so&apos;m</th>
                    <th scope="col" className="px-3 text-right">Their price</th>
                    <th scope="col" className="px-3 text-left">Last change</th>
                    <th scope="col" className="w-0 px-3" />
                  </tr>
                </thead>
                <tbody>
                  {seats.map((seat) => {
                    const change = seat.price_changes[0];
                    return (
                      <tr key={seat.id}>
                        <td className="px-3 font-medium">
                          {seat.group_name}
                          {editing === seat.id ? (
                            <div className="mt-2 whitespace-normal">
                              <SeatPriceForm seat={seat} onClose={() => setEditing(null)} />
                            </div>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-3 text-right tabular-nums">{signedAmount(seat.price)}</td>
                        <td className="whitespace-nowrap px-3 text-right font-semibold tabular-nums" data-verdict={seat.personal_price !== null ? "attention" : undefined}>
                          {seat.personal_price === null ? "Group price" : priceWord(seat.personal_price)}
                        </td>
                        <td className="px-3 text-ms-fg-2">
                          {change ? `${dayText(change.at)} · ${change.by || "—"} · ${priceWord(change.old_price)} → ${priceWord(change.new_price)} · ${change.reason}` : "—"}
                        </td>
                        <td className="w-0 whitespace-nowrap px-3 text-right">
                          {can(P.setPrices) && editing !== seat.id ? (
                            <Button size="sm" variant="ghost" onClick={() => setEditing(seat.id)}>
                              Personal price
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        }}
      />
    </section>
  );
}
