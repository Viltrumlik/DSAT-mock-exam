"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { financeApi } from "./financeApi";

const ROOT = ["finance"] as const;
const LCUP_SYNC_MS = 15 * 60 * 1000;

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

/** What the band under the header says is owed, null when it has nothing to say. Read again as often
 *  as lc-up syncs, so a payment clears it without a reload. */
export function useDebtNotice(enabled: boolean): number | null {
  const { data } = useQuery({
    queryKey: financeKeys.mine,
    queryFn: () => financeApi.mine(),
    enabled,
    refetchInterval: LCUP_SYNC_MS,
  });
  return enabled && data?.linked && data.debt_notice && data.debt ? data.debt : null;
}

/** `enabled` false for a viewer without `view_reports`: the totals' endpoint refuses them. */
export function useFinanceSummary(month: string, enabled = true) {
  return useQuery({ queryKey: financeKeys.summary(month), queryFn: () => financeApi.summary(month), enabled });
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
