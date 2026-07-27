"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { vocabularyApi } from "../api";
import { vocabularyKeys } from "../queryKeys";
import type { VocabSetDetail } from "../types";
import type { DistractorWord } from "./utils";

/** Below this a set cannot fill four MCQ options from its own words. */
const MIN_SELF_SUFFICIENT = 4;

/**
 * The pool wrong answers are drawn from: the set itself, topped up only when it
 * is too small to supply four distinct options. A bank set tops up from its own
 * section (same register, same difficulty); a custom set has no section, so it
 * tops up from the bank at large.
 */
export function useDistractorPool(set: VocabSetDetail | undefined): DistractorWord[] {
  const needsTopUp = !!set && set.words.length < MIN_SELF_SUFFICIENT;
  const sectionId = set?.section?.id;

  const topUp = useQuery({
    queryKey: vocabularyKeys.wordSearch("", sectionId),
    queryFn: () => vocabularyApi.searchWords({ section: sectionId, limit: 40 }),
    enabled: needsTopUp,
    // Distractors are a nicety — a failed top-up must not retry-storm or block
    // the round, the mode simply runs with fewer options.
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  return useMemo(() => {
    const own: DistractorWord[] = set?.words ?? [];
    if (!needsTopUp || !topUp.data?.length) return own;
    const seen = new Set(own.map((w) => w.id));
    const extra = topUp.data.filter((w) => !seen.has(w.id));
    return [...own, ...extra];
  }, [set?.words, needsTopUp, topUp.data]);
}
