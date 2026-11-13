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
