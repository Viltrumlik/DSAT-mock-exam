"use client";

import { Suspense } from "react";
import { QuestionOfTheDayRunner } from "@/features/dailyQuestions/QuestionOfTheDayRunner";

/** /question-of-the-day — today's questions in the runner; `?subject=math|english` opens one. */
export default function QuestionOfTheDayPage() {
  // useSearchParams needs a Suspense boundary for the static build.
  return (
    <Suspense fallback={null}>
      <QuestionOfTheDayRunner />
    </Suspense>
  );
}
