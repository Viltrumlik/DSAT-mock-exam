"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";

/**
 * The centre's expenses (`backend/billing/views_expenses.py`, owner 22 Nov 2026: expenses leave lc-up too). Reading
 * needs `view_money`; entering, voiding and the category list need `manage_expenses`. Whole so'm, always above zero.
 */

export interface ExpenseRow {
  id: number;
  day: string;
  amount: number;
  category: { id: number; name: string };
  method: string;
  spent_by: { id: number | null; name: string };
  reason: string;
  created_by: string;
  created_at: string;
  voided_at: string | null;
  voided_by: string;
  void_reason: string;
}

export interface ExpenseListing {
  from: string;
  to: string;
  archived: boolean;
  rows: ExpenseRow[];
  count: number;
  truncated: boolean;
  total: number;
  by_category: { id: number; name: string; total: number; count: number }[];
}

export interface ExpenseCategory {
  id: number;
  name: string;
  retired: boolean;
  used: number;
}

export interface ExpenseMeta {
  categories: ExpenseCategory[];
  staff: { id: number; name: string }[];
  methods: { value: string; label: string }[];
  /** Holds `manage_expenses`. */
  can_manage: boolean;
  /** The cutover is done: expenses are entered here, not in lc-up. */
  open: boolean;
  me: number;
}

export interface ExpenseFilter {
  from: string;
  to: string;
  category: string;
  spentBy: string;
  archived: boolean;
}

export interface NewExpense {
  day: string;
  amount: number;
  category: number;
  method: string;
  spent_by: number;
  reason: string;
  request_id: string;
}

const ROOT = ["billing", "expenses"] as const;

export const expenseKeys = {
  meta: [...ROOT, "meta"] as const,
  list: (f: ExpenseFilter) => [...ROOT, "list", f] as const,
};

export const expensesApi = {
  async list(f: ExpenseFilter): Promise<ExpenseListing> {
    const params: Record<string, string> = { from: f.from, to: f.to };
    if (f.category) params.category = f.category;
    if (f.spentBy) params.spent_by = f.spentBy;
    if (f.archived) params.archived = "1";
    return (await api.get<ExpenseListing>("/billing/expenses/", { params })).data;
  },
  async meta(): Promise<ExpenseMeta> {
    return (await api.get<ExpenseMeta>("/billing/expenses/meta/")).data;
  },
  async add(body: NewExpense): Promise<ExpenseRow> {
    return (await api.post<ExpenseRow>("/billing/expenses/", body)).data;
  },
  async void(id: number, reason: string): Promise<ExpenseRow> {
    return (await api.post<ExpenseRow>(`/billing/expenses/${id}/void/`, { reason })).data;
  },
  async addCategory(name: string): Promise<ExpenseCategory> {
    return (await api.post<ExpenseCategory>("/billing/expense-categories/", { name })).data;
  },
  async changeCategory(id: number, body: { name?: string; retired?: boolean }): Promise<ExpenseCategory> {
    return (await api.patch<ExpenseCategory>(`/billing/expense-categories/${id}/`, body)).data;
  },
};

export function useExpenseMeta() {
  return useQuery({ queryKey: expenseKeys.meta, queryFn: () => expensesApi.meta() });
}

export function useExpenses(filter: ExpenseFilter) {
  return useQuery({ queryKey: expenseKeys.list(filter), queryFn: () => expensesApi.list(filter) });
}

/** Any change: the lists, their totals and the category counts are read again. */
function useExpenseChange<A, R>(call: (args: A) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({ mutationFn: call, onSuccess: () => client.invalidateQueries({ queryKey: ROOT }) });
}

export const useAddExpense = () => useExpenseChange((body: NewExpense) => expensesApi.add(body));
export const useVoidExpense = () =>
  useExpenseChange(({ id, reason }: { id: number; reason: string }) => expensesApi.void(id, reason));
export const useAddCategory = () => useExpenseChange((name: string) => expensesApi.addCategory(name));
export const useChangeCategory = () =>
  useExpenseChange(({ id, ...body }: { id: number; name?: string; retired?: boolean }) => expensesApi.changeCategory(id, body));
