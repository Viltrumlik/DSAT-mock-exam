"use client";

import { useQuery } from "@tanstack/react-query";
import { rewardsApi } from "./rewardsApi";

const keys = {
  me: ["rewards", "me"] as const,
  rules: ["rewards", "rules"] as const,
  wallet: ["rewards", "wallet"] as const,
};

export function useMyRewards() {
  return useQuery({ queryKey: keys.me, queryFn: () => rewardsApi.me() });
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
