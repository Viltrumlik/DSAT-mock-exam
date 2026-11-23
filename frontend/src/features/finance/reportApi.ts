"use client";

import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";

/** A period's report (`backend/billing/report.py`, owner 22 Nov 2026: reports leave lc-up too). Whole so'm. */
export interface PeriodReport {
  from: string;
  to: string;
  money_in: { paid: number; refunded: number; payments: number; by_method: { method: string; total: number }[] };
  money_out: { total: number; count: number; by_category: { name: string; total: number; count: number }[] };
  /** Payments, less refunds, less expenses. */
  net: number;
  /** The day the ledger opened from lc-up's balances: before it, earned, students and debt are not whole. */
  ledger_opened: string | null;
  earned: {
    lessons: number;
    first_months: number;
    monthly: number;
    other: number;
    given_back: number;
    total: number;
    adjustments: number;
  };
  students: {
    /** Students in a paid seat, each day up to today. */
    active_per_day: { day: string; count: number }[];
    active_at_end: number;
    new: number;
    left: number;
    froze: number;
    frozen_for_debt_now: number;
  };
  /** Null before the ledger opened: the balances were lc-up's then. */
  debt: { as_of: string; debtors: number | null; total: number | null };
}

export function usePeriodReport(from: string, to: string) {
  return useQuery({
    queryKey: ["billing", "report", from, to] as const,
    queryFn: async () => (await api.get<PeriodReport>("/billing/report/", { params: { from, to } })).data,
  });
}
