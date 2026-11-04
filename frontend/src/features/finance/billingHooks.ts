"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { billingApi, type EnterMoneyBody, type LedgerScope } from "./billingApi";

const ROOT = ["billing"] as const;

export const billingKeys = {
  summary: [...ROOT, "summary"] as const,
  accounts: (scope: LedgerScope) => [...ROOT, "accounts", scope] as const,
  account: (id: number) => [...ROOT, "account", id] as const,
};

export function useLedgerSummary() {
  return useQuery({ queryKey: billingKeys.summary, queryFn: () => billingApi.summary() });
}

export function useLedgerAccounts(scope: LedgerScope) {
  return useQuery({ queryKey: billingKeys.accounts(scope), queryFn: () => billingApi.accounts(scope) });
}

export function useLedgerAccount(id: number) {
  return useQuery({ queryKey: billingKeys.account(id), queryFn: () => billingApi.account(id) });
}

/** Money moved: this person's rows, the lists and the comparison figures are all read again. */
export function useEnterMoney(accountId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: EnterMoneyBody) => billingApi.enter(accountId, body),
    onSuccess: () => client.invalidateQueries({ queryKey: ROOT }),
  });
}

export function useVoidEntry() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => billingApi.voidEntry(id, reason),
    onSuccess: () => client.invalidateQueries({ queryKey: ROOT }),
  });
}
