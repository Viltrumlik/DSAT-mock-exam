"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

/**
 * Press Convert. Invalidates both reward keys rather than writing the response into the
 * cache: the top-bar pill reads `me` and the page reads `wallet`, and a mint moves the
 * coin figure on both. Leaving one to its 60s stale window would show a student two
 * different coin balances on the same screen.
 */
export function useConvertPoints() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => rewardsApi.convert(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.me });
      qc.invalidateQueries({ queryKey: keys.wallet });
    },
  });
}

export function useRewardRules() {
  return useQuery({
    queryKey: keys.rules,
    queryFn: () => rewardsApi.rules(),
    // The rule table changes only when the school retunes it.
    staleTime: 10 * 60 * 1000,
  });
}
