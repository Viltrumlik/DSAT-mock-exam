"use client";

import { Suspense, useState } from "react";
import { Tabs, useTabParam } from "@/features/console/ui";
import {
  DebtorsPanel,
  FinanceOverviewPanel,
  MonthPicker,
  PaymentsPanel,
  currentMonth,
} from "@/features/finance/FinancePanels";
import { useFinanceSummary } from "@/features/finance/financeHooks";
import { LedgerPanel } from "@/features/finance/LedgerPanel";
import { P } from "@/features/ops/permissions";
import { useCan } from "@/features/ops/useCan";

/**
 * Money as lc-up keeps it: who owes and how much, who is frozen for it (or exempt from the
 * freeze), and what was paid each month. lc-up is the ledger — nothing here changes a balance;
 * the one write is exempting a student from the monthly debt freeze. Its own page, not a tab of
 * /ops/lcup: the owner wanted the money apart from the sync. The Ledger tab is the centre's own
 * ledger, running beside lc-up until the cutover.
 *
 * In the console's look (PR 12a): its header, the tabs in the address (`?tab=debtors`) so a link
 * and Back land on the tab, and the month picker beside them where a tab belongs to a month.
 */

type FinanceTab = "overview" | "debtors" | "payments" | "ledger";
const TAB_IDS: readonly FinanceTab[] = ["overview", "debtors", "payments", "ledger"];
const LABEL: Record<FinanceTab, string> = { overview: "Overview", debtors: "Debtors", payments: "Payments", ledger: "Ledger" };
/** The overview is the month's totals (`view_reports`); the other tabs are the money itself (`view_money`). */
const NEEDS: Record<FinanceTab, string> = { overview: P.viewReports, debtors: P.viewMoney, payments: P.viewMoney, ledger: P.viewMoney };

function FinancePage() {
  const can = useCan();
  const tabIds = TAB_IDS.filter((id) => can(NEEDS[id]));
  const [tab, setTab] = useTabParam(tabIds, tabIds[0] ?? "overview");
  const [month, setMonth] = useState(currentMonth);
  // The overview reads the same summary, so this is one request; it gives the Debtors tab its count.
  const summary = useFinanceSummary(month, can(P.viewReports));
  const debtors = summary.data?.debtors;
  return (
    <div className="flex flex-col gap-4">
      <header className="animate-ms-fade-in flex flex-col gap-1">
        <h1 className="text-ms-title text-ms-fg">Finance</h1>
        <p className="max-w-3xl text-[14px] text-ms-fg-2">
          Debts, freezes and payments as lc-up records them. Balances follow the latest sync; exempt a student from the
          monthly debt freeze when they should not be frozen, for example on a grant.
        </p>
      </header>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-ms-border">
        <Tabs<FinanceTab>
          label="Finance sections"
          idPrefix="finance"
          value={tab}
          onChange={setTab}
          className="border-b-0"
          tabs={tabIds.map((id) => ({
            id,
            label: LABEL[id],
            count: id === "debtors" && debtors ? debtors : undefined,
            tone: id === "debtors" && debtors ? "critical" : undefined,
          }))}
        />
        {/* Debtors and the ledger are "right now" — only the overview and the payments belong to a month. */}
        {tab === "overview" || tab === "payments" ? (
          <div className="pb-1.5">
            <MonthPicker value={month} onChange={setMonth} />
          </div>
        ) : null}
      </div>
      <div role="tabpanel" id={`finance-${tab}-panel`} aria-labelledby={`finance-${tab}`} className="min-w-0">
        {tab === "overview" ? <FinanceOverviewPanel month={month} debtorsHref="/ops/finance?tab=debtors" /> : null}
        {tab === "debtors" ? <DebtorsPanel /> : null}
        {tab === "payments" ? <PaymentsPanel month={month} /> : null}
        {tab === "ledger" ? <LedgerPanel /> : null}
      </div>
    </div>
  );
}

export default function OpsFinancePage() {
  // useSearchParams (the open tab) needs a Suspense boundary above it, or the production build's prerender fails.
  return (
    <Suspense fallback={null}>
      <FinancePage />
    </Suspense>
  );
}
