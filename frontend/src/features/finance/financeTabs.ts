import { P } from "@/features/ops/permissions";

/**
 * The Finance page's tabs, apart from the page: Next lets a `page.tsx` export nothing else, and the
 * console's panel draws the same tabs as a tree under Finance (Shell v0.4), in the same words.
 */
export type FinanceTab = "overview" | "debtors" | "payments" | "ledger";

export const FINANCE_TAB_IDS: readonly FinanceTab[] = ["overview", "debtors", "payments", "ledger"];

export const FINANCE_TAB_LABEL: Record<FinanceTab, string> = {
  overview: "Overview",
  debtors: "Debtors",
  payments: "Payments",
  ledger: "Ledger",
};

/**
 * What each tab needs (plan 2026-11-12-crm-roles): the overview is the month's totals (`view_reports`); the other
 * tabs are the money itself (`view_money`). The page shows only the tabs a person may open; so does the panel's tree.
 */
export const FINANCE_TAB_NEEDS: Record<FinanceTab, readonly string[]> = {
  overview: [P.viewReports],
  debtors: [P.viewMoney],
  payments: [P.viewMoney],
  ledger: [P.viewMoney],
};
