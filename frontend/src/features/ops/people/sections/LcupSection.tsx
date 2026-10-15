"use client";

import { useState } from "react";
import { CalendarClock, Receipt, ShieldAlert, Wallet } from "lucide-react";
import { Badge, type BadgeVariant } from "@/components/ui";
import { formatUzs } from "@/features/finance/financeApi";
import { Fieldset, Row, StatTile, SubHeading, Table, Td, WIDE_ONLY, type Tone } from "../Fieldset";
import { formatDateTime, formatDay } from "../format";
import type { PersonLcup } from "../personApi";

/** lc-up's side of a learner: what they owe, what they pay each month, and every payment. Read-only — lc-up is the ledger. */

const PAYMENTS_SHOWN = 10;

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

const KIND: Record<string, { label: string; variant: BadgeVariant }> = {
  payment: { label: "Payment", variant: "success" },
  refund: { label: "Refund", variant: "warning" },
  extra: { label: "Extra", variant: "info" },
};

/**
 * What the debt freeze does to this learner, said as it is: "Not frozen" in green beside a
 * 650,000 UZS debt read as all clear, when the freeze was switched off — or about to act.
 */
export function freezeTile(
  lcup: PersonLcup,
  owes: boolean,
  today: number,
): { value: string; tone: Tone; sub: string } {
  const day = lcup.freeze_day;
  if (lcup.frozen_for_debt) return { value: "Frozen", tone: "warning", sub: `unpaid after day ${day}` };
  if (lcup.exempt) return { value: "Exempt", tone: "info", sub: "never frozen for debt" };
  if (!lcup.freeze_on) return { value: "Switched off", tone: "neutral", sub: "no one is frozen for debt" };
  if (!owes) return { value: "Not frozen", tone: "success", sub: "nothing owed" };
  if (today >= day) return { value: "Freezes next sync", tone: "danger", sub: `still owing after day ${day}` };
  return { value: `Freezes on day ${day}`, tone: "warning", sub: "if still unpaid by then" };
}

export function LcupSection({ lcup }: { lcup: PersonLcup }) {
  const [showAll, setShowAll] = useState(false);
  const payments = showAll ? lcup.payments : lcup.payments.slice(0, PAYMENTS_SHOWN);
  const owes = lcup.balance != null && lcup.balance < 0;

  return (
    <Fieldset title="lc-up & payments" icon={Wallet} tone={owes ? "danger" : "success"} description="From lc-up, the centre's ledger">
      <div className="grid gap-3 sm:grid-cols-3">
        {lcup.balance == null ? (
          <StatTile label="Balance" value="—" icon={Wallet} sub="lc-up has not said" />
        ) : owes ? (
          <StatTile label="Owes" value={formatUzs(-lcup.balance!)} icon={Wallet} tone="danger" sub={`updated ${formatDateTime(lcup.updated_at)}`} />
        ) : (
          <StatTile label="Balance" value="Paid up" icon={Wallet} tone="success" sub={`updated ${formatDateTime(lcup.updated_at)}`} />
        )}
        <StatTile
          label="Monthly cost"
          value={formatUzs(lcup.monthly_cost)}
          icon={CalendarClock}
          tone="primary"
          sub={lcup.groups.map((g) => g.name).join(", ") || "no live group"}
        />
        <StatTile label="Debt freeze" icon={ShieldAlert} {...freezeTile(lcup, owes, new Date().getDate())} />
      </div>

      <div className="mt-5">
        <Row label="Link">
          <Badge variant={lcup.status === "created" ? "info" : "neutral"}>{linkLabel(lcup.status)}</Badge>
        </Row>
        <Row label="lc-up ID">
          <span className="tabular-nums">{lcup.lcup_student_id}</span>
        </Row>
        <Row label="Phone form">{lcup.phone_prompt ? (PROMPT_LABELS[lcup.phone_prompt] ?? lcup.phone_prompt) : "—"}</Row>
      </div>

      <div className="mt-6">
        <SubHeading>
          <span className="inline-flex items-center gap-1.5">
            <Receipt aria-hidden className="h-3.5 w-3.5" />
            Payments
          </span>
        </SubHeading>
        {lcup.payments.length === 0 ? (
          <p className="rounded-lg bg-surface-2 px-4 py-3 text-muted-foreground">No payments yet.</p>
        ) : (
          <>
            {/* A phone keeps Date and Amount (a refund's "−" says its kind); the badge needs the room. */}
            <Table head={["Date", { label: "Kind", className: WIDE_ONLY }, { label: "Amount", className: "text-right" }, { label: "Month", className: WIDE_ONLY }, { label: "Group", className: WIDE_ONLY }]}>
              {payments.map((p) => {
                const kind = KIND[p.kind] ?? { label: p.kind, variant: "neutral" as BadgeVariant };
                return (
                  <tr key={p.id}>
                    <Td className="tabular-nums text-muted-foreground">{formatDay(p.date)}</Td>
                    <Td className={WIDE_ONLY}>
                      <Badge variant={kind.variant}>{kind.label}</Badge>
                    </Td>
                    <Td className={`text-right font-semibold tabular-nums ${p.kind === "refund" ? "text-warning-foreground" : "text-foreground"}`}>
                      {p.kind === "refund" ? "−" : ""}
                      {formatUzs(p.amount)}
                    </Td>
                    <Td className={`${WIDE_ONLY} tabular-nums text-muted-foreground`}>{p.month || "—"}</Td>
                    <Td className={`${WIDE_ONLY} max-w-[12rem] truncate text-muted-foreground`}>{p.group || "—"}</Td>
                  </tr>
                );
              })}
            </Table>
            {lcup.payments.length > PAYMENTS_SHOWN ? (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="mt-3 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-primary-hover"
              >
                {showAll ? "Show fewer" : `Show all ${lcup.payments.length}`}
              </button>
            ) : null}
          </>
        )}
      </div>
    </Fieldset>
  );
}
