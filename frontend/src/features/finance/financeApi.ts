import api from "@/lib/api";

/** Money comes from lc-up (backend/lcup/finance.py): whole UZS, a negative balance is a debt. Admins
 *  see everyone's, a student only their own, and teachers none of it (only a "frozen" badge). */

export interface FinancePayment {
  id: number;
  date: string;
  amount: number;
  /** lc-up's type: "payment" | "refund" | "extra". */
  kind: string;
  method: string;
  /** The month it pays for, "YYYY-MM" ("" when lc-up left it empty). */
  month: string;
  group: string;
}

export interface MyFinance {
  linked: true;
  balance: number | null;
  debt: number | null;
  updated_at: string | null;
  frozen_for_debt: boolean;
  /** From this day of each month an unpaid balance freezes the account. */
  freeze_day: number;
  monthly_cost: number;
  groups: { name: string; monthly_cost: number }[];
  payments: FinancePayment[];
}

export type MyFinanceResponse = MyFinance | { linked: false };

export interface FinanceGroupRow {
  group: string;
  teachers: string[];
  monthly_cost: number;
  students: number;
  debtors: number;
  debt: number;
  income: number;
}

export interface FinanceSummary {
  month: string;
  total_debt: number;
  debtors: number;
  frozen: number;
  exempt: number;
  paid: number;
  refunded: number;
  other: number;
  by_method: Record<string, number>;
  by_group: FinanceGroupRow[];
  freeze: { enabled: boolean; day: number };
}

export interface Debtor {
  link_id: number;
  lcup_student_id: number;
  name: string;
  user: { id: number; name: string; username: string } | null;
  groups: string[];
  teachers: string[];
  in_group: boolean;
  debt: number;
  last_payment_on: string | null;
  frozen: boolean;
  exempt: boolean;
}

export interface MonthPayment extends FinancePayment {
  student: string;
  user_id: number | null;
}

export const financeApi = {
  async mine(): Promise<MyFinanceResponse> {
    return (await api.get<MyFinanceResponse>("/lcup/me/finance/")).data;
  },
  async summary(month?: string): Promise<FinanceSummary> {
    return (await api.get<FinanceSummary>("/lcup/finance/summary/", { params: month ? { month } : {} })).data;
  },
  async debtors(): Promise<Debtor[]> {
    return (await api.get<Debtor[]>("/lcup/finance/debtors/")).data;
  },
  async payments(month?: string): Promise<MonthPayment[]> {
    return (await api.get<MonthPayment[]>("/lcup/finance/payments/", { params: month ? { month } : {} })).data;
  },
  async setExempt(linkId: number, exempt: boolean): Promise<{ link_id: number; exempt: boolean }> {
    return (await api.post(`/lcup/finance/exempt/${linkId}/`, { exempt })).data;
  },
};

/** "1,250,000 UZS" — the codebase groups digits with en-US everywhere. */
export function formatUzs(amount: number): string {
  // `|| 0`: a negative zero (e.g. minus no refunds) would print as "-0".
  return `${(Math.round(amount) || 0).toLocaleString("en-US")} UZS`;
}
