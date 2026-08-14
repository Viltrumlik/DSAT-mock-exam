"use client";

import { useQuery } from "@tanstack/react-query";
import { pastpaperReportApi } from "./pastpaperReportApi";

export function useAttemptReport(attemptId: number | null) {
  return useQuery({
    queryKey: ["pastpaper", "report", attemptId],
    queryFn: () => pastpaperReportApi.report(attemptId as number),
    enabled: attemptId != null,
    // A finished paper's report only moves when an answer key is corrected, which is rare
    // and staff-initiated — but it DOES move, so this is stale-after-a-while rather than
    // cached forever.
    staleTime: 5 * 60 * 1000,
  });
}
