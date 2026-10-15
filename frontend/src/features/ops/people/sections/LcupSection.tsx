"use client";

import { useState } from "react";
import { formatUzs } from "@/features/finance/financeApi";
import { Fieldset, Row, SubHeading, Table, Td } from "../Fieldset";
import { formatDateTime, formatDay } from "../format";
import type { PersonLcup } from "../personApi";

/** lc-up's side of a learner: the link, the balance and the payments. Read-only — lc-up is the ledger. */

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

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function LcupSection({ lcup }: { lcup: PersonLcup }) {
  const [showAll, setShowAll] = useState(false);
  const payments = showAll ? lcup.payments : lcup.payments.slice(0, PAYMENTS_SHOWN);

  return (
    <Fieldset title="lc-up & payments">
      <div>
        <Row label="Link">{linkLabel(lcup.status)}</Row>
        <Row label="lc-up ID">
          <span className="tabular-nums">{lcup.lcup_student_id}</span>
        </Row>
        <Row label="Balance">
          {lcup.balance == null ? (
            "—"
          ) : lcup.balance < 0 ? (
            <span className="tabular-nums text-danger">Owes {formatUzs(-lcup.balance)}</span>
          ) : (
            "Paid up"
          )}
        </Row>
        <Row label="Balance updated">{formatDateTime(lcup.updated_at)}</Row>
        <Row label="Monthly cost">
          <span className="tabular-nums">{formatUzs(lcup.monthly_cost)}</span>
          {lcup.groups.length > 0 ? (
            <span className="text-muted-foreground"> · {lcup.groups.map((g) => g.name).join(", ")}</span>
          ) : null}
        </Row>
        <Row label="Debt freeze">
          {lcup.frozen_for_debt ? `Frozen (day ${lcup.freeze_day} rule)` : lcup.exempt ? "Exempt" : "—"}
        </Row>
        <Row label="Phone form">{lcup.phone_prompt ? (PROMPT_LABELS[lcup.phone_prompt] ?? lcup.phone_prompt) : "—"}</Row>
      </div>

      <div className="mt-4">
        <SubHeading>Payments</SubHeading>
        {lcup.payments.length === 0 ? (
          <p className="text-muted-foreground">No payments yet.</p>
        ) : (
          <>
            <Table head={["Date", "Kind", "Amount", "Month", "Group"]}>
              {payments.map((p) => (
                <tr key={p.id}>
                  <Td className="tabular-nums text-muted-foreground">{formatDay(p.date)}</Td>
                  <Td>{capitalize(p.kind)}</Td>
                  <Td className="tabular-nums">{formatUzs(p.amount)}</Td>
                  <Td className="tabular-nums text-muted-foreground">{p.month || "—"}</Td>
                  <Td className="max-w-[12rem] truncate text-muted-foreground">{p.group || "—"}</Td>
                </tr>
              ))}
            </Table>
            {lcup.payments.length > PAYMENTS_SHOWN ? (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="mt-2 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-primary-hover"
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
