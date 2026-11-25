import api from "@/lib/api";

/** The centre's own ledger (backend/billing), beside lc-up until the cutover: whole UZS, below zero is a
 *  debt. Admins only. Nothing here changes a balance. */

export interface LedgerDifference {
  /** Null: lc-up holds money for someone the ledger does not know. */
  account_id: number | null;
  name: string;
  ours: number;
  lcup: number;
  diff: number;
}

export interface LedgerComparison {
  day: string;
  /** False when the sync could not be trusted: nothing was compared, and `alerts` says so. */
  ok: boolean;
  counts: Partial<Record<"matched" | "small" | "big" | "unknown" | "missing", number>>;
  rows: LedgerDifference[];
  alerts: string[];
}

export interface LedgerProblem {
  at: string;
  kind: string;
  errors: string[];
  alerts: string[];
}

/** How the ledger charges (owner, 22 Nov 2026): by the month, or per lesson from a balance topped up in advance. */
export interface LedgerRules {
  mode: "month" | "lesson";
  /** A lesson costs the seat's monthly price ÷ this (13), to the nearest 500. */
  lessons_per_month: number;
  /** Per lesson, on an account: what one lesson of its group costs; null with no group. */
  lesson_price?: number | null;
  min_topup: number;
  /** Per lesson only: the least this student's next payment may be (a new student's first: the whole first month). */
  least_payment?: number;
  /** Per lesson only: a new student's first month, or null for someone who is not new. */
  first_month_fee?: number | null;
  /** Per lesson only: the last day the first month covers (it grows while the seat is frozen). */
  first_month_until?: string | null;
}

export interface LedgerSummary {
  rules?: LedgerRules;
  enabled: boolean;
  /** True once payments are entered here and lc-up no longer writes the ledger (after the cutover). */
  ledger_is_ours?: boolean;
  opened_at: string | null;
  last_tick_at: string | null;
  accounts: number;
  former: number;
  comparison: LedgerComparison | null;
  problems: LedgerProblem[];
}

export type LedgerScope = "current" | "former";

export interface LedgerAccountRow {
  id: number;
  name: string;
  phone: string;
  balance: number;
  former: boolean;
}

export interface LedgerEntry {
  id: number;
  day: string;
  kind: string;
  label: string;
  amount: number;
  /** The balance after this row; a voided row does not move it. */
  running: number;
  month: string;
  method: string;
  note: string;
  by: string;
  voided_at: string | null;
  void_reason: string;
  voided_by: string;
  /** Money a person entered and nobody has taken back; what the ledger wrote itself is never voided by hand. */
  can_void: boolean;
  /** The group the money is for (its seat); null / "" for a row written before payments carried one. */
  seat_id?: number | null;
  group?: string;
}

export interface LedgerSeat {
  id: number;
  group_name: string;
  state: string;
  price: number;
  /** This student's own price, replacing the group's; 0 is a grant, null is the group's price. */
  personal_price: number | null;
  /** How its latest stretch is billed; null before it ever paid. */
  rule?: "month" | "lesson" | null;
  /** What one lesson of this seat costs when it pays per lesson. */
  lesson_price?: number;
  price_changes: { at: string; old_price: number | null; new_price: number | null; reason: string; by: string }[];
}

export interface LedgerAccount {
  id: number;
  name: string;
  phone: string;
  balance: number;
  seats: LedgerSeat[];
  rows: LedgerEntry[];
  /** Money is entered here only after the cutover; until then the server refuses it too. */
  payments_open: boolean;
  rules?: LedgerRules;
}

export type EnterableKind = "payment" | "refund" | "adjust";

export interface EnterMoneyBody {
  kind: EnterableKind;
  /** Above zero, except an adjustment, whose sign says which way it goes. */
  amount: number;
  day: string;
  method: string;
  note: string;
  /** One per open form: a retry of the same request is the same row. */
  request_id: string;
  /** The seat (group) a payment or refund is for: required when the student has two or more groups. */
  seat?: number;
}

export const billingApi = {
  async summary(): Promise<LedgerSummary> {
    return (await api.get<LedgerSummary>("/billing/summary/")).data;
  },
  async accounts(scope: LedgerScope): Promise<LedgerAccountRow[]> {
    return (await api.get<{ accounts: LedgerAccountRow[] }>("/billing/accounts/", { params: { scope } })).data.accounts;
  },
  async account(id: number): Promise<LedgerAccount> {
    return (await api.get<LedgerAccount>(`/billing/accounts/${id}/`)).data;
  },
  async enter(accountId: number, body: EnterMoneyBody): Promise<{ balance: number }> {
    return (await api.post<{ balance: number }>(`/billing/accounts/${accountId}/entries/`, body)).data;
  },
  async setSeatPrice(id: number, price: number | null, reason: string): Promise<{ balance: number }> {
    return (await api.post<{ balance: number }>(`/billing/seats/${id}/price/`, { price, reason })).data;
  },
  async voidEntry(id: number, reason: string): Promise<{ balance: number }> {
    return (await api.post<{ balance: number }>(`/billing/entries/${id}/void/`, { reason })).data;
  },
};
