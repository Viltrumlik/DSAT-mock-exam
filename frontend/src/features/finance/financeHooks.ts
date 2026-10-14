"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { financeApi } from "./financeApi";

const ROOT = ["finance"] as const;

export const financeKeys = {
  mine: [...ROOT, "mine"] as const,
  summary: (month: string) => [...ROOT, "summary", month] as const,
  debtors: [...ROOT, "debtors"] as const,
  payments: (month: string) => [...ROOT, "payments", month] as const,
};

/** A student's own money (and the frozen screen's amount). */
export function useMyFinance(enabled = true) {
  return useQuery({ queryKey: financeKeys.mine, queryFn: () => financeApi.mine(), enabled });
}

export function useFinanceSummary(month: string) {
  return useQuery({ queryKey: financeKeys.summary(month), queryFn: () => financeApi.summary(month) });
}

export function useDebtors() {
  return useQuery({ queryKey: financeKeys.debtors, queryFn: () => financeApi.debtors() });
}

export function useMonthPayments(month: string) {
  return useQuery({ queryKey: financeKeys.payments(month), queryFn: () => financeApi.payments(month) });
}

export function useSetExempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ linkId, exempt }: { linkId: number; exempt: boolean }) => financeApi.setExempt(linkId, exempt),
    onSuccess: () => qc.invalidateQueries({ queryKey: ROOT }),
  });
}
