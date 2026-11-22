"use client";

import { useMemo, useState } from "react";
import { CourseTag, Select, courseLevelOf, signedAmount, verdictText } from "@/features/console/ui";
import { methodLabel } from "@/features/finance/FinancePanels";
import { dayText } from "@/features/ops/detail/groupFacts";
import { cn } from "@/lib/cn";
import { formatDateTime } from "../format";
import type { PersonLcup } from "../personApi";
import { freezeTile } from "./LcupSection";

/**
 * The profile's Payments tab, lc-up's "To'lovlar" (StudentProfile board, tab Payments, 22 Nov 2026): this month's
 * fee, what was paid toward it and what is left — only when lc-up gives a monthly cost — then every payment as a
 * ruled table (date, amount signed with its plus, type, method, month, group as a course tag), with a method filter
 * when the payments use more than one. lc-up is the ledger: nothing here changes money. lc-up's link facts (its
 * ID, the debt freeze, the phone form) close the tab, as the old "lc-up & payments" box held them.
 */

const SHOWN = 10;

const KIND_LABEL: Record<string, string> = { payment: "Payment", refund: "Refund", extra: "Extra" };

function linkLabel(status: string): string {
  if (status === "confirmed" || status === "auto") return "Linked";
  if (status === "created") return "Created by lc-up";
  return status ? status.replace(/_/g, " ") : "—";
}

const PROMPT_LABELS: Record<string, string> = {
  pending: "Asked, not answered yet",
  confirmed: "Confirmed",
  not_me: "Said it is not them",
  superseded: "Superseded",
};

/** "YYYY-MM" of today on the admin's calendar. */
function thisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A payment's sign: a refund leaves the balance, everything else comes in. */
const signed = (p: { kind: string; amount: number }) => (p.kind === "refund" ? -Math.abs(p.amount) : Math.abs(p.amount));

export function PaymentsPanel({ lcup }: { lcup: PersonLcup | null }) {
  const [method, setMethod] = useState<string>("all");
  const [showAll, setShowAll] = useState(false);
  const payments = useMemo(() => lcup?.payments ?? [], [lcup]);
  const methods = useMemo(() => [...new Set(payments.map((p) => p.method).filter(Boolean))], [payments]);

  if (!lcup) {
    return <p className="rounded-ms-ctl bg-ms-surface px-4 py-3 text-ms-fg-2">Not linked to lc-up: there are no payments to show.</p>;
  }

  const month = thisMonth();
  const fee = lcup.monthly_cost;
  const paid = payments.filter((p) => p.month === month).reduce((sum, p) => sum + signed(p), 0);
  const left = Math.max(0, fee - paid);
  const filtered = method === "all" ? payments : payments.filter((p) => p.method === method);
  const rows = showAll ? filtered : filtered.slice(0, SHOWN);
  const owes = lcup.balance != null && lcup.balance < 0;
  const freeze = freezeTile(lcup, owes, new Date().getDate());

  return (
    <section aria-label="Payments" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="text-ms-h flex-[1_1_200px] text-ms-fg">Payments</h2>
        {methods.length > 1 ? (
          <Select<string>
            aria-label="Payment method"
            className="w-[200px]"
            value={method}
            onChange={setMethod}
            options={[{ value: "all", label: "Every method" }, ...methods.map((m) => ({ value: m, label: methodLabel(m) }))]}
          />
        ) : null}
      </div>

      {fee > 0 ? (
        <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
          <div className="rounded-ms-ctl bg-ms-surface px-4 py-3">
            <dt className="text-[13px] text-ms-fg-3">{MONTHS[Number(month.slice(5)) - 1]} fee</dt>
            <dd className="m-0 mt-1 text-[20px] font-semibold tabular-nums text-ms-fg">{signedAmount(fee)}</dd>
          </div>
          <div className="rounded-ms-ctl bg-ms-surface px-4 py-3">
            <dt className="text-[13px] text-ms-fg-3">Paid toward it</dt>
            <dd className={cn("m-0 mt-1 text-[20px] font-semibold tabular-nums", paid > 0 ? verdictText("positive") : "text-ms-fg")}>{signedAmount(paid)}</dd>
          </div>
          <div className="rounded-ms-ctl bg-ms-surface px-4 py-3">
            <dt className="text-[13px] text-ms-fg-3">Left to pay</dt>
            <dd className={cn("m-0 mt-1 text-[20px] font-semibold tabular-nums", left > 0 ? verdictText("critical") : "text-ms-fg")}>{signedAmount(left)}</dd>
          </div>
        </dl>
      ) : null}

      {payments.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 rounded-ms-ctl bg-ms-surface px-6 py-10 text-center">
          <h3 className="text-ms-h text-ms-fg">No payments yet</h3>
          <p className="text-[14px] text-ms-fg-2">A payment lc-up records shows here after the next sync.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-ms-ctl border border-ms-grid">
            <table className="w-full min-w-[560px] text-[14px]">
              <thead>
                <tr>
                  <th scope="col" className="px-3 text-left">Date</th>
                  <th scope="col" className="px-3 text-right">Amount, so&apos;m</th>
                  <th scope="col" className="px-3 text-left">Type</th>
                  <th scope="col" className="px-3 text-left">Method</th>
                  <th scope="col" className="px-3 text-left">Month</th>
                  <th scope="col" className="px-3 text-left">Group</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const amount = signed(p);
                  return (
                    <tr key={p.id}>
                      <td className="whitespace-nowrap px-3 tabular-nums">{dayText(p.date)}</td>
                      <td className="whitespace-nowrap px-3 text-right font-semibold tabular-nums" data-verdict={amount < 0 ? "critical" : "positive"}>
                        {signedAmount(amount, { plus: true })}
                      </td>
                      <td className="px-3">{KIND_LABEL[p.kind] ?? p.kind}</td>
                      <td className="px-3">{p.method ? methodLabel(p.method) : "—"}</td>
                      <td className="whitespace-nowrap px-3 tabular-nums text-ms-fg-2">{p.month || "—"}</td>
                      <td className="px-3">
                        {p.group ? (
                          <CourseTag level={courseLevelOf(null, p.group)} size="sm">
                            {p.group}
                          </CourseTag>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length > SHOWN ? (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="self-start text-[14px] font-medium text-ms-primary-text hover:underline">
              {showAll ? "Show fewer" : `Show all ${filtered.length}`}
            </button>
          ) : null}
        </>
      )}

      <div>
        <h3 className="text-ms-over mb-2 text-ms-fg-3">lc-up</h3>
        <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-x-5 gap-y-3 text-[14px]">
          <div>
            <dt className="text-[13px] text-ms-fg-3">Balance, so&apos;m</dt>
            <dd className={cn("m-0 mt-0.5 font-semibold tabular-nums", verdictText(lcup.balance == null ? undefined : lcup.balance < 0 ? "critical" : lcup.balance > 0 ? "positive" : undefined))}>
              {lcup.balance == null ? "—" : signedAmount(lcup.balance)}
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-ms-fg-3">Monthly cost, so&apos;m</dt>
            <dd className="m-0 mt-0.5 font-medium tabular-nums">{signedAmount(lcup.monthly_cost)}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-ms-fg-3">Debt freeze</dt>
            <dd className="m-0 mt-0.5 font-medium">
              {freeze.value} <span className="font-normal text-ms-fg-3">· {freeze.sub}</span>
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-ms-fg-3">Link</dt>
            <dd className="m-0 mt-0.5 font-medium">{linkLabel(lcup.status)}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-ms-fg-3">lc-up ID</dt>
            <dd className="m-0 mt-0.5 font-medium tabular-nums">{lcup.lcup_student_id}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-ms-fg-3">Phone form</dt>
            <dd className="m-0 mt-0.5 font-medium">{lcup.phone_prompt ? (PROMPT_LABELS[lcup.phone_prompt] ?? lcup.phone_prompt) : "—"}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-ms-fg-3">Updated</dt>
            <dd className="m-0 mt-0.5 font-medium tabular-nums">{formatDateTime(lcup.updated_at)}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
