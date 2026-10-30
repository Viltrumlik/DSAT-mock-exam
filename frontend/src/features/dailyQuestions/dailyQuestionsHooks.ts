"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dailyQuestionsApi, type DailyQuestion, type DailyQuestionsToday } from "./dailyQuestionsApi";

const keys = {
  today: ["daily-questions", "today"] as const,
};

/**
 * Today's card. The first fetch of the day is what deals the questions, so it is not
 * refetched on every focus — but it is refetched after a while, so a tab left open past
 * midnight picks up the new day instead of offering yesterday's question.
 */
export function useTodaysQuestions() {
  return useQuery({
    queryKey: keys.today,
    queryFn: () => dailyQuestionsApi.today(),
    staleTime: 10 * 60 * 1000,
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
