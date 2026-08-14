"use client";

import { useQuery } from "@tanstack/react-query";
import { leaderboardApi, type LeaderboardQuery } from "./leaderboardApi";

const keys = {
  board: (q: LeaderboardQuery) => ["leaderboard", "board", q] as const,
  filters: ["leaderboard", "filters"] as const,
};

export function useLeaderboard(query: LeaderboardQuery) {
  return useQuery({
    queryKey: keys.board(query),
    queryFn: () => leaderboardApi.board(query),
    // A leaderboard is browsed, not watched. Refetching on every filter press is the point;
    // refetching the same slice on every remount is not, and the numbers behind it move on
    // the scale of a lesson rather than a second.
    staleTime: 60_000,
    // Keeps the previous slice on screen while the next one loads, so pressing a filter chip
    // dims the table instead of collapsing the page to a skeleton and back.
    placeholderData: (previous) => previous,
  });
}

export function useLeaderboardFilters() {
  return useQuery({
    queryKey: keys.filters,
    queryFn: () => leaderboardApi.filters(),
    // Branches and regions change when the school opens a building.
    staleTime: 10 * 60 * 1000,
  });
}
