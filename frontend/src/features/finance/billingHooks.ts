"use client";

import { useQuery } from "@tanstack/react-query";
import { billingApi, type LedgerScope } from "./billingApi";

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
