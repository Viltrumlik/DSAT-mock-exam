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
  /** Whether the band under the header is theirs: whom the debt SMS warns, `lcup.finance.freezable`. */
  debt_notice: boolean;
  /** From this day of each month an unpaid balance freezes the account. */
  freeze_day: number;
  /** Once the ledger is the master: "lesson" = paid per lesson, frozen the moment the balance drops below zero. */
  rule?: "month" | "lesson";
  /** Per lesson: what one lesson of their (first) group costs. */
  lesson_price?: number | null;
  /** Per lesson: the least one top-up may be. */
  min_topup?: number;
  monthly_cost: number;
  groups: { name: string; monthly_cost: number; lesson_price?: number }[];
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
  freeze: { enabled: boolean; day: number; rule?: "month" | "lesson" };
}

/** A debtor's group, for its course tag: the class's own level when it is paired, and the class to open. */
export interface DebtorGroup {
  name: string;
  level: string;
  classroom_id: number | null;
}

/** One lc-up student who owes — one row per student, never per family. */
export interface Debtor {
  /** Null for someone lc-up never knew (after the cutover): no freeze exemption can be set for them here. */
  link_id: number | null;
  lcup_student_id: number;
  name: string;
  /** `section` is where their page lives (`/ops/<section>/<id>`). */
  user: { id: number; name: string; username: string; section?: string } | null;
  /** The student's own phone (lc-up's, else the account's); "" when none. */
  phone?: string;
  /** Only for `view_people` holders, as on the person page; "" otherwise or when none was given. */
  parent_phone?: string;
  groups: string[];
  group_rows?: DebtorGroup[];
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
