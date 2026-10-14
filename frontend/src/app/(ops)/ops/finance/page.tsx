"use client";

import { useState } from "react";
import { Tabs } from "@/components/ui";
import {
  DebtorsPanel,
  FinanceOverviewPanel,
  MonthPicker,
  PaymentsPanel,
  currentMonth,
} from "@/features/finance/FinancePanels";

/**
 * Money as lc-up keeps it: who owes and how much, who is frozen for it (or exempt from the
 * freeze), and what was paid each month. lc-up is the ledger — nothing here changes a balance;
 * the one write is exempting a student from the monthly debt freeze. Its own page, not a tab of
 * /ops/lcup: the owner wanted the money apart from the sync.
 */

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "debtors", label: "Debtors" },
  { value: "payments", label: "Payments" },
];

export default function OpsFinancePage() {
  const [tab, setTab] = useState("overview");
  const [month, setMonth] = useState(currentMonth);
  return (
    <div className="space-y-3">
      <header>
        <h1 className="text-lg font-semibold text-foreground">Finance</h1>
        <p className="text-[13px] text-muted-foreground">
          Debts, freezes and payments as lc-up records them. Balances follow the latest sync; exempt a student from the
          monthly debt freeze when they should not be frozen, for example on a grant.
        </p>
      </header>
      <Tabs tabs={TABS} value={tab} onValueChange={setTab} aria-label="Finance sections" />
      {/* Debtors are "right now" — only the overview and the payments belong to a month. */}
      {tab !== "debtors" ? <MonthPicker value={month} onChange={setMonth} /> : null}
      {tab === "overview" ? <FinanceOverviewPanel month={month} /> : null}
      {tab === "debtors" ? <DebtorsPanel /> : null}
      {tab === "payments" ? <PaymentsPanel month={month} /> : null}
    </div>
  );
}
