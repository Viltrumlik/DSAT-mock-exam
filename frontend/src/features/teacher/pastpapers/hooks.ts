"use client";

import { useQuery } from "@tanstack/react-query";
import { listTeacherPapers, loadTeacherPaper } from "./api";

const KEY = ["teacher", "pastpapers"] as const;

export function useTeacherPapers() {
  return useQuery({ queryKey: KEY, queryFn: listTeacherPapers, staleTime: 60_000 });
}

export function useTeacherPaper(paperId: number) {
  return useQuery({
    queryKey: [...KEY, paperId],
    queryFn: () => loadTeacherPaper(paperId),
    enabled: Number.isFinite(paperId) && paperId > 0,
    staleTime: 60_000,
  });
}
