"use client";

/**
 * The full question behind a "most missed" row.
 *
 * The analysis rows cannot supply this and are not meant to: an assessment row carries a
 * prompt the server truncated (`prompt_truncated`), a past-paper row carries the stem alone,
 * and neither carries the choices, the figure, the answer key or the explanation. A teacher
 * who wants to WORK the question needs all of that, so the pop-up reads the question from the
 * same authoring endpoint each of the teacher's two question surfaces already reads it from:
 *
 *   past paper  — `useTeacherPaper`, the past-paper reader's own hook and query key, so
 *                 opening a question a teacher has already read costs nothing.
 *   assessment  — `assessmentsAdminApi.adminGetSet`, which is what /teacher/assessments/
 *                 [setId]/practice loads.
 *
 * Both are staff-only reads that open no attempt and start no sitting, and both have always
 * answered with `correct_answer` and `explanation` attached. Nothing here changes a student
 * payload, and nothing here writes: a teacher answering in the pop-up is thinking, not
 * sitting the paper.
 *
 * The fetch is keyed off the row the teacher opened, so a homework's question bodies are
 * asked for only once a row is clicked — never while the block is merely on screen, and never
 * at all before the deadline, when there are no rows to click.
 */

import { useQuery } from "@tanstack/react-query";
import { assessmentsAdminApi } from "@/lib/api";
import type { AssessmentChoice, AssessmentQuestion, AssessmentQuestionType } from "@/features/assessments/types";
import { normalizeAssessmentQuestion } from "@/features/reviewCenter/normalize";
import { useTeacherPaper } from "@/features/teacher/pastpapers/hooks";
import {
  answerKeyFromAssessmentQuestion,
  answerKeyFromReviewQuestion,
  type AnswerKey,
} from "@/features/teacher/questionWork";
import type { MissedSource } from "./rows";

/** One question, in the shape the runner's own components draw. */
export interface PopupQuestion {
  prompt: string;
  /** The second prompt that sits directly above the choices, when the author wrote one. */
  questionPrompt?: string;
  image: string | null;
  /** What `AnswerInput` should render — the question's real type, not a guess at two. */
  inputType: AssessmentQuestionType;
  choices: AssessmentChoice[];
  optionImages: Record<string, string | null>;
  answerKey: AnswerKey;
}

export type QuestionBody =
  | { status: "loading" }
  | { status: "error"; retry: () => void }
  /** The set or paper loaded and this question is no longer in it — a gap, not a failure. */
  | { status: "removed" }
  | { status: "ready"; question: PopupQuestion };

type AdminSet = { questions?: AssessmentQuestion[] | null };

const SET_KEY = (setId: number) => ["teacher", "assessment-set", setId] as const;

export function useQuestionBody(
  source: MissedSource | null,
  questionId: number | null,
): QuestionBody {
  const setId = source?.kind === "assessment" ? source.setId : 0;
  const paperId = source?.kind === "pastpaper" ? source.paperId : 0;

  const set = useQuery({
    queryKey: SET_KEY(setId),
    queryFn: () => assessmentsAdminApi.adminGetSet(setId) as Promise<AdminSet>,
    enabled: setId > 0,
    staleTime: 60_000,
  });
  // The reader's own hook, so its `enabled` guard and its cache are the ones already in use.
  const paper = useTeacherPaper(paperId);

  const query = source?.kind === "assessment" ? set : paper;
  if (source == null || questionId == null) return { status: "loading" };
  if (query.isError) return { status: "error", retry: () => void query.refetch() };
  // A DISABLED query is pending forever — `isPending` is true and `fetchStatus` is "idle",
  // because nothing was ever asked for. That happens when the row's set or paper id came back
  // as 0, and drawing a skeleton for it would be a dead end painted as loading.
  if (query.isPending && query.fetchStatus === "idle") return { status: "removed" };
  if (query.isPending || !query.data) return { status: "loading" };

  if (source.kind === "assessment") {
    const rows = Array.isArray(set.data?.questions) ? set.data!.questions! : [];
    const index = rows.findIndex((q) => Number(q.id) === questionId);
    if (index < 0) return { status: "removed" };
    const raw = rows[index];
    // Rendered through the shared normalizer (prompt, figure, choices, option images) but
    // keyed through the ASSESSMENT adapter: the two backends grade the same-looking answer
    // differently, and a Check that disagrees with the real grader is worse than no Check.
    const view = normalizeAssessmentQuestion(raw, index);
    return {
      status: "ready",
      question: {
        prompt: view.prompt,
        questionPrompt: view.questionPrompt,
        image: view.image ?? null,
        inputType: raw.question_type,
        choices: view.choices.map((c) => ({ id: c.id, text: c.text })),
        optionImages: Object.fromEntries(view.choices.map((c) => [c.id, c.image ?? null])),
        answerKey: answerKeyFromAssessmentQuestion(raw),
      },
    };
  }

  const found = (paper.data?.questions ?? []).find((q) => q.key === `q-${questionId}`);
  if (!found) return { status: "removed" };
  return {
    status: "ready",
    question: {
      prompt: found.prompt,
      questionPrompt: found.questionPrompt,
      image: found.image ?? null,
      // A past paper has two shapes only: a four-choice question, or a grid-in. The reader
      // makes the same call, so the pop-up and the reader draw one question identically.
      inputType: found.isChoice ? "multiple_choice" : "numeric",
      choices: found.choices.map((c) => ({ id: c.id, text: c.text })),
      optionImages: Object.fromEntries(found.choices.map((c) => [c.id, c.image ?? null])),
      answerKey: answerKeyFromReviewQuestion(found),
    },
  };
}
