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

export interface LedgerSummary {
  enabled: boolean;
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
}

export interface LedgerAccount {
  id: number;
  name: string;
  phone: string;
  balance: number;
  seats: { id: number; group_name: string; state: string; price: number }[];
  rows: LedgerEntry[];
  /** Money is entered here only after the cutover; until then the server refuses it too. */
  payments_open: boolean;
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
  async voidEntry(id: number, reason: string): Promise<{ balance: number }> {
    return (await api.post<{ balance: number }>(`/billing/entries/${id}/void/`, { reason })).data;
  },
};
