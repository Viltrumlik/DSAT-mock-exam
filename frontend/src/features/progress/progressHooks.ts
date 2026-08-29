"use client";

import { useQuery } from "@tanstack/react-query";
import { progressApi } from "./progressApi";
import type { ProgressResponse } from "./progressApi";

export const progressKeys = {
  all: ["progress"] as const,
};

/** The student's per-level attendance + homework progress. */
export function useMyProgress() {
  return useQuery<ProgressResponse>({
    queryKey: progressKeys.all,
    queryFn: () => progressApi.mine(),
  });
}
