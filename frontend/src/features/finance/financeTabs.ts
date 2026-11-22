import { P } from "@/features/ops/permissions";

/**
 * The Finance page's tabs, apart from the page: Next lets a `page.tsx` export nothing else, and the
 * console's sidebar and ⌘K list the same tabs, in the same words.
 *
 * In lc-up's order (Debtors board, owner 22 Nov 2026: lc-up's Moliya opens straight on Qarzdorlar): Debtors first,
 * then the payments, the centre's own ledger, and the month's totals. lc-up's "Extra income" and "Expenses" are not
 * kept here, so they are not tabs.
 */
export type FinanceTab = "overview" | "debtors" | "payments" | "ledger";

export const FINANCE_TAB_IDS: readonly FinanceTab[] = ["debtors", "payments", "ledger", "overview"];

export const FINANCE_TAB_LABEL: Record<FinanceTab, string> = {
  overview: "Overview",
  debtors: "Debtors",
  payments: "Payments",
  ledger: "Ledger",
};

/**
 * What each tab needs (plan 2026-11-12-crm-roles): the overview is the month's totals (`view_reports`); the other
 * tabs are the money itself (`view_money`). The page shows only the tabs a person may open; so does the sidebar.
 */
export const FINANCE_TAB_NEEDS: Record<FinanceTab, readonly string[]> = {
  overview: [P.viewReports],
  debtors: [P.viewMoney],
  payments: [P.viewMoney],
  ledger: [P.viewMoney],
};
