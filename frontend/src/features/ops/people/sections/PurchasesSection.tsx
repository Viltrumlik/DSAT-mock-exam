"use client";

import { Badge, signedAmount } from "@/features/console/ui";
import { dayText } from "@/features/ops/detail/groupFacts";
import { Fieldset, PartBody } from "../Fieldset";
import { usePersonPart, type PersonPurchases } from "../personApi";

/**
 * The profile's Purchases tab, lc-up's "Xaridlar" (22 Nov 2026): what the student bought in the centre's shop with
 * coins or strikes, newest first (`GET …/purchases/`). Read-only: an order is handed over or cancelled in the shop's
 * own queue.
 */

const STATUS_TONE: Record<string, "attention" | "positive" | "neutral"> = { PENDING: "attention", FULFILLED: "positive", CANCELLED: "neutral" };
const CURRENCY: Record<string, string> = { COIN: "coins", STRIKE: "strikes" };

export function PurchasesSection({ id }: { id: number }) {
  const query = usePersonPart<PersonPurchases>(id, "purchases");
  return (
    <Fieldset title="Purchases" description="Bought in the shop with coins or strikes, newest first">
      <PartBody
        query={query}
        isEmpty={(d) => d.orders.length === 0}
        render={(d) => (
          <>
            <div className="overflow-x-auto rounded-ms-ctl border border-ms-grid">
              <table className="w-full min-w-[520px] text-[14px]">
                <thead>
                  <tr>
                    <th scope="col" className="px-3 text-left">Date</th>
                    <th scope="col" className="px-3 text-left">Item</th>
                    <th scope="col" className="px-3 text-right">Price</th>
                    <th scope="col" className="px-3 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {d.orders.map((o) => (
                    <tr key={o.id}>
                      <td className="whitespace-nowrap px-3 tabular-nums">{dayText(o.at)}</td>
                      <td className="px-3 font-medium">
                        {o.item}
                        {o.note ? <span className="block text-[12.5px] font-normal text-ms-fg-3">{o.note}</span> : null}
                      </td>
                      <td className="whitespace-nowrap px-3 text-right tabular-nums">
                        {signedAmount(o.price)} {CURRENCY[o.currency] ?? o.currency.toLowerCase()}
                      </td>
                      <td className="px-3">
                        <Badge tone={STATUS_TONE[o.status] ?? "neutral"}>{o.status_label}</Badge>
                        {o.settled_at ? <span className="ml-2 text-[12.5px] text-ms-fg-3">{dayText(o.settled_at)}</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {d.truncated ? <p className="mt-3 text-xs text-ms-fg-3">Showing the latest 100.</p> : null}
          </>
        )}
      />
    </Fieldset>
  );
}
