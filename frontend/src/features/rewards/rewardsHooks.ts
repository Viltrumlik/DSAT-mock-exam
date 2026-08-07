"use client";

import { useQuery } from "@tanstack/react-query";
import { rewardsApi } from "./rewardsApi";

const keys = {
  me: ["rewards", "me"] as const,
  rules: ["rewards", "rules"] as const,
  wallet: ["rewards", "wallet"] as const,
};

export function useMyRewards() {
  // Read by the top-bar pill on every page, so it gets a stale window to stop each
  // navigation refetching it. Mutations that earn points invalidate the key, and
  // invalidation refetches regardless of staleness — the total is never left behind.
  return useQuery({ queryKey: keys.me, queryFn: () => rewardsApi.me(), staleTime: 60_000 });
}

export function useMyWallet() {
  return useQuery({ queryKey: keys.wallet, queryFn: () => rewardsApi.wallet() });
}

export function useRewardRules() {
  return useQuery({
    queryKey: keys.rules,
    queryFn: () => rewardsApi.rules(),
    // The rule table changes only when the school retunes it.
    staleTime: 10 * 60 * 1000,
  });
}
