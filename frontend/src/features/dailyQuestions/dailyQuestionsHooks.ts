"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dailyQuestionsApi, type DailyQuestion, type DailyQuestionsToday } from "./dailyQuestionsApi";

const keys = {
  today: ["daily-questions", "today"] as const,
};

/** Tashkent is UTC+5 all year (no DST) — the day the server deals by. */
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A little past midnight, so the server's clock has certainly turned over too. */
const ROLLOVER_GRACE_MS = 5_000;

/** Milliseconds from `now` until the next midnight in Tashkent, plus a small grace. */
export function msUntilTashkentMidnight(now: number = Date.now()): number {
  const local = now + TASHKENT_OFFSET_MS;
  return DAY_MS - (((local % DAY_MS) + DAY_MS) % DAY_MS) + ROLLOVER_GRACE_MS;
}

/**
 * Today's card. The first fetch of the day is what deals the questions, so it is not
 * refetched on every focus. A tab left open past midnight is refetched AT midnight
 * (Tashkent) — `staleTime` alone only marks the data stale and would keep offering
 * yesterday's question until the student's answer bounced as expired. A tab hidden at
 * midnight catches up on focus: staleness is capped at the midnight after the data was
 * fetched, so a 23:58 fetch is already stale at 00:01 rather than at 00:08.
 */
export function useTodaysQuestions() {
  return useQuery({
    queryKey: keys.today,
    queryFn: () => dailyQuestionsApi.today(),
    staleTime: (query) =>
      Math.min(10 * 60 * 1000, msUntilTashkentMidnight(query.state.dataUpdatedAt || Date.now())),
    refetchInterval: () => msUntilTashkentMidnight(),
  });
}

export function useAnswerDailyQuestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, answer }: { id: number; answer: unknown }) => dailyQuestionsApi.answer(id, answer),
    onSuccess: (answered: DailyQuestion) => {
      qc.setQueryData<DailyQuestionsToday>(keys.today, (prev) =>
        prev
          ? { ...prev, questions: prev.questions.map((q) => (q.id === answered.id ? answered : q)) }
          : prev,
      );
      // A right answer moved the XP and points chips at the top of the dashboard.
      if (answered.result?.is_correct) qc.invalidateQueries({ queryKey: ["rewards"] });
    },
    onError: () => {
      // "Already answered" (another tab) or "expired" (past midnight): the card is stale.
      qc.invalidateQueries({ queryKey: keys.today });
    },
  });
}
