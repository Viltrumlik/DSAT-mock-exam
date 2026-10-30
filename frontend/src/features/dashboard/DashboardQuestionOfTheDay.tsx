"use client";

/**
 * The Question of the Day card (owner, 2026-10-30).
 *
 * One question per subject the student studies, at their class's level, picked from last
 * month's hardest. One try; the answer key and the explanation come back with the verdict.
 * Right first time earns the `DAILY_QUESTION` reward (2 XP + 2 points by default).
 *
 * The card renders nothing while loading and nothing when there is nothing to answer — the
 * flag is off, the student has no levelled class, or their level's list is empty. A failed
 * fetch is NOT "nothing to answer" and says so, with a retry.
 */

import { useState } from "react";
import { CheckCircle2, Lightbulb, Sparkles, XCircle } from "lucide-react";
import { Button, SegmentedControl } from "@/components/ui";
import { AnswerInput, type OptionImageMap } from "@/features/assessments/components/QuestionInputs";
import type { AssessmentChoice } from "@/features/assessments/types";
import type { DailyQuestion, DailyQuestionReward } from "@/features/dailyQuestions/dailyQuestionsApi";
import { useAnswerDailyQuestion, useTodaysQuestions } from "@/features/dailyQuestions/dailyQuestionsHooks";
import { resolveImageUrl } from "@/features/testing-simulation/utils/image";
import { normalizeApiError } from "@/lib/apiError";
import { AssessmentText } from "@/lib/assessmentText";
import { cn } from "@/lib/cn";

const SUBJECT_LABEL: Record<string, string> = { english: "English", math: "Math" };

function levelLabel(level: string): string {
  return level ? level[0].toUpperCase() + level.slice(1) : "";
}

function rewardLabel(r: DailyQuestionReward): string {
  return `+${r.xp} XP · +${r.points} points`;
}

function parseChoices(raw: unknown): AssessmentChoice[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => {
      if (!x || typeof x !== "object") return null;
      const id = String((x as Record<string, unknown>).id ?? "").trim();
      return id ? { id, text: String((x as Record<string, unknown>).text ?? "") } : null;
    })
    .filter((x): x is AssessmentChoice => x !== null);
}

/** "B", "0.5 or 1/2", "True" — the answer key as a student reads it. */
export function formatAnswer(value: unknown): string {
  if (Array.isArray(value)) return value.map(formatAnswer).filter(Boolean).join(" or ");
  if (typeof value === "boolean") return value ? "True" : "False";
  if (value === null || value === undefined) return "";
  return String(value);
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

export function DashboardQuestionOfTheDay() {
  const today = useTodaysQuestions();
  const [activeId, setActiveId] = useState<string | null>(null);
  // Drafts live here, not in the panel: the panel remounts on a subject switch, and a student
  // who glances at Math must come back to the English answer they had already picked.
  const [drafts, setDrafts] = useState<Record<number, unknown>>({});

  if (today.isPending) return null;

  if (today.isError) {
    return (
      <section className="mb-[22px] rounded-3xl border border-border bg-card p-5">
        <p className="text-sm font-semibold text-muted-foreground">
          The Question of the Day didn&apos;t load.{" "}
          <button
            type="button"
            className="font-bold text-primary underline"
            onClick={() => void today.refetch()}
          >
            Try again
          </button>
        </p>
      </section>
    );
  }

  const { questions, reward, enabled } = today.data;
  if (!enabled || questions.length === 0) return null;

  const current = questions.find((q) => String(q.id) === activeId) ?? questions[0];
  const allDone = questions.every((q) => q.status === "answered");

  return (
    <section
      aria-labelledby="qotd-title"
      className="mb-[22px] rounded-3xl border border-border bg-card p-5 shadow-card sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-soft text-primary">
            <Sparkles className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h2 id="qotd-title" className="text-[17px] font-extrabold leading-tight">
              Question of the Day
            </h2>
            <p className="text-[12.5px] text-muted-foreground">
              One try · right first time earns {rewardLabel(reward)}
            </p>
          </div>
        </div>
        {questions.length > 1 ? (
          <SegmentedControl
            ariaLabel="Subject"
            size="sm"
            value={String(current.id)}
            onChange={setActiveId}
            options={questions.map((q) => ({
              value: String(q.id),
              label: (
                <span className="inline-flex items-center gap-1.5">
                  {SUBJECT_LABEL[q.subject] ?? q.subject} · {levelLabel(q.level)}
                  {q.status === "answered" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-success-foreground" aria-label="answered" />
                  ) : null}
                </span>
              ),
            }))}
          />
        ) : (
          <span className="rounded-full bg-surface-2 px-3 py-1 text-[12px] font-bold text-muted-foreground">
            {SUBJECT_LABEL[current.subject] ?? current.subject} · {levelLabel(current.level)}
          </span>
        )}
      </div>

      <QuestionPanel
        key={current.id}
        item={current}
        reward={reward}
        draft={drafts[current.id] ?? null}
        onDraft={(value) => setDrafts((prev) => ({ ...prev, [current.id]: value }))}
      />

      {allDone ? (
        <p className="mt-4 text-center text-[13px] font-semibold text-muted-foreground">
          That&apos;s today done — a new question comes tomorrow.
        </p>
      ) : null}
    </section>
  );
}

function QuestionPanel({
  item,
  reward,
  draft,
  onDraft,
}: {
  item: DailyQuestion;
  reward: DailyQuestionReward;
  draft: unknown;
  onDraft: (value: unknown) => void;
}) {
  const submit = useAnswerDailyQuestion();
  const q = item.question;
  const result = item.result;
  const figure = resolveImageUrl(q.question_image);
  const optionImages: OptionImageMap = {
    A: q.option_a_image,
    B: q.option_b_image,
    C: q.option_c_image,
    D: q.option_d_image,
  };
  const error = submit.isError ? normalizeApiError(submit.error).message : null;

  return (
    <div className="mt-5">
      {q.question_prompt ? (
        <div className="mb-3 rounded-xl bg-surface-2 p-3 text-sm">
          <AssessmentText text={q.question_prompt} block preserveNewlines />
        </div>
      ) : null}
      {figure ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed media URL, like the runner
        <img src={figure} alt="" className="mb-3 max-h-72 rounded-xl border border-border" />
      ) : null}
      <div className="text-[15px] font-medium">
        <AssessmentText text={q.prompt} block />
      </div>

      <div className={cn("mt-4", (result || submit.isPending) && "pointer-events-none")}>
        <AnswerInput
          type={q.question_type}
          choices={parseChoices(q.choices)}
          value={result ? result.answer : draft}
          onChange={onDraft}
          optionImages={optionImages}
        />
      </div>

      {result ? (
        <ResultBlock result={result} />
      ) : (
        <>
          <Button
            className="mt-4"
            fullWidth
            loading={submit.isPending}
            disabled={isBlank(draft)}
            onClick={() => submit.mutate({ id: item.id, answer: draft })}
          >
            Check my answer · {rewardLabel(reward)}
          </Button>
          {error ? (
            <p role="alert" className="mt-2 text-center text-[13px] font-semibold text-danger">
              {error}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function ResultBlock({ result }: { result: NonNullable<DailyQuestion["result"]> }) {
  return (
    <div className="mt-4 space-y-3" aria-live="polite">
      {result.is_correct ? (
        <div className="flex items-center gap-2 rounded-xl border border-success/25 bg-success-soft p-3 text-success-foreground">
          <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
          <p className="text-sm font-bold">
            Correct! {result.earned.xp || result.earned.points ? rewardLabel(result.earned) : null}
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-xl border border-warning/25 bg-warning-soft p-3 text-warning-foreground">
          <XCircle className="h-5 w-5 shrink-0" aria-hidden />
          <p className="text-sm font-bold">
            Not this time. The correct answer is {formatAnswer(result.correct_answer)}.
          </p>
        </div>
      )}
      {result.explanation ? (
        <div className="rounded-xl bg-surface-2 p-3 text-sm">
          <p className="mb-1 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
            <Lightbulb className="h-3.5 w-3.5" aria-hidden /> Explanation
          </p>
          <AssessmentText text={result.explanation} block preserveNewlines />
        </div>
      ) : null}
    </div>
  );
}
