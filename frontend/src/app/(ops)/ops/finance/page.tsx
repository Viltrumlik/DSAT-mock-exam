"use client";

import { Suspense, useState } from "react";
import { Tabs, useTabParam } from "@/features/console/ui";
import { DebtorsPanel, SmsDebtorsLink } from "@/features/finance/DebtorsPanel";
import { FinanceOverviewPanel, MonthPicker, PaymentsPanel, currentMonth } from "@/features/finance/FinancePanels";
import { useDebtors } from "@/features/finance/financeHooks";
import { FINANCE_TAB_IDS, FINANCE_TAB_LABEL, FINANCE_TAB_NEEDS, type FinanceTab } from "@/features/finance/financeTabs";
import { LedgerPanel } from "@/features/finance/LedgerPanel";
import { P } from "@/features/ops/permissions";
import { useCan } from "@/features/ops/useCan";

/**
 * Money as lc-up keeps it: who owes and how much, who is frozen for it (or exempt from the freeze), and what was paid
 * each month. lc-up is the ledger — nothing here changes a balance; the one write is exempting a student from the
 * monthly debt freeze. Its own page, not a tab of /ops/lcup: the owner wanted the money apart from the sync. The
 * Ledger tab is the centre's own ledger, running beside lc-up until the cutover.
 *
 * lc-up's structure, our look (Debtors board, owner 22 Nov 2026): a plain title with the tab's actions beside it,
 * then the tabs — Debtors first, as lc-up's Moliya opens on Qarzdorlar. The open tab is in the address (`?tab=`),
 * so a link and Back land on it; the old `?tab=overview` links still open the overview.
 */

const TAB_IDS = FINANCE_TAB_IDS;
const LABEL = FINANCE_TAB_LABEL;
const NEEDS = FINANCE_TAB_NEEDS;

function FinancePage() {
  const can = useCan();
  const tabIds = TAB_IDS.filter((id) => can(...NEEDS[id]));
  const [tab, setTab] = useTabParam(tabIds, tabIds[0] ?? "overview");
  const [month, setMonth] = useState(currentMonth);
  // The same list the Debtors tab shows (one request, cached): its length is the tab's count — students, not families.
  const debtors = useDebtors(can(P.viewMoney)).data?.length;
  return (
    <div className="flex flex-col gap-5">
      <header className="animate-ms-fade-in flex flex-wrap items-center gap-3">
        <h1 className="text-ms-title text-ms-fg">Finance</h1>
        <span className="flex-1" />
        {tab === "debtors" ? <SmsDebtorsLink /> : null}
      </header>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-ms-border">
        <Tabs<FinanceTab>
          label="Finance sections"
          idPrefix="finance"
          value={tab}
          onChange={setTab}
          tree
          className="min-w-0 border-b-0"
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
      <div role="tabpanel" id={`finance-${tab}-panel`} aria-labelledby={`finance-${tab}`} className="min-w-0 pt-2">
        {tab === "debtors" ? <DebtorsPanel /> : null}
        {tab === "payments" ? <PaymentsPanel month={month} /> : null}
        {tab === "ledger" ? <LedgerPanel /> : null}
        {tab === "overview" ? <FinanceOverviewPanel month={month} debtorsHref="/ops/finance?tab=debtors" /> : null}
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
