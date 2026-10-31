"use client";

/**
 * The Question of the Day, solved in the assessment runner's own frame (owner, 2026-10-31:
 * "yechishni tanlasa assessment runner olib kirsin va desmos calculator berilsin. math yoki
 * englishligini tanlash mumkin bo'lsin. javobni belgilab checkni bossa runnerni o'zida javobi
 * ko'rinib explanation ham ko'rinsin").
 *
 * The same full-screen white sheet, header and answer inputs as the runner a student sits an
 * assessment in. Desmos is offered on every Math question, whatever the level — the owner asked
 * for it here without the level rule assessments follow. English and Math switch in the header
 * when the student has both; `?subject=` picks which one opens first.
 *
 * Check is the one try. The server grades it and only then sends the key and the explanation,
 * so the verdict is drawn on the choices themselves (the right one green, a wrong pick amber)
 * and the explanation opens beside the question — under it on a phone.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, ArrowLeft, Calculator, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { SegmentedControl } from "@/components/ui";
import { AnswerInput, type OptionImageMap } from "@/features/assessments/components/QuestionInputs";
import StableHtml from "@/features/assessments/components/StableHtml";
import { DesmosCalculator } from "@/features/testing-simulation/tools/calculator/DesmosCalculator";
import { resolveImageUrl } from "@/features/testing-simulation/utils/image";
import { normalizeApiError } from "@/lib/apiError";
import { AssessmentText, processInstructionalText } from "@/lib/assessmentText";
import { cn } from "@/lib/cn";
import type { AssessmentChoice } from "@/features/assessments/types";
import type { DailyQuestion, DailyQuestionResult } from "./dailyQuestionsApi";
import {
  acceptedIds,
  formatAnswer,
  isBlank,
  parseChoices,
  rewardLabel,
  SUBJECT_LABEL,
  trackLabel,
} from "./dailyQuestionsFormat";
import { useAnswerDailyQuestion, useTodaysQuestions } from "./dailyQuestionsHooks";

export function QuestionOfTheDayRunner() {
  const router = useRouter();
  const search = useSearchParams();
  const today = useTodaysQuestions();
  const submit = useAnswerDailyQuestion();

  const [activeId, setActiveId] = useState<number | null>(null);
  // Drafts are per question: a student who glances at Math comes back to the English answer
  // they had already picked.
  const [drafts, setDrafts] = useState<Record<number, unknown>>({});
  const [calcOpen, setCalcOpen] = useState(false);
  const [calcEnlarged, setCalcEnlarged] = useState(false);

  const questions = useMemo(
    () => (today.data?.enabled ? today.data.questions : []),
    [today.data],
  );
  const wanted = search.get("subject");
  const current =
    questions.find((q) => q.id === activeId) ??
    questions.find((q) => q.subject === wanted) ??
    questions.find((q) => q.status === "open") ??
    questions[0];

  // A failed Check belongs to the question it was pressed on, not to the one switched to.
  const { reset } = submit;
  useEffect(() => {
    reset();
  }, [current?.id, reset]);

  const exit = () => router.push("/");

  if (today.isPending) {
    return (
      <Sheet>
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="Loading" />
        </div>
      </Sheet>
    );
  }

  if (today.isError || !current) {
    return (
      <Sheet>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="text-sm font-semibold text-slate-500">
            {today.isError
              ? "Today's question didn't load."
              : "There's no Question of the Day for you today."}
          </p>
          <div className="flex gap-2">
            {today.isError ? (
              <button
                type="button"
                onClick={() => void today.refetch()}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                Try again
              </button>
            ) : null}
            <button
              type="button"
              onClick={exit}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90"
            >
              Back to home
            </button>
          </div>
        </div>
      </Sheet>
    );
  }

  const reward = today.data.reward;
  const isMath = current.subject === "math";
  const result = current.result;
  const draft = drafts[current.id] ?? null;
  const nextOpen = questions.find((q) => q.id !== current.id && q.status === "open");
  const error = submit.isError ? normalizeApiError(submit.error).message : null;

  const switchTo = (id: number) => {
    setActiveId(id);
    setCalcOpen(false);
  };

  return (
    <Sheet>
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-white px-4 py-3 shadow-sm sm:px-6">
        <button
          type="button"
          onClick={exit}
          className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 transition-colors hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" /> Exit
        </button>
        <div className="order-last w-full text-center sm:order-none sm:w-auto sm:min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">
            One try · right first time earns {rewardLabel(reward)}
          </p>
          <h1 className="inline-flex items-center gap-1.5 truncate text-sm font-bold tracking-tight text-slate-900">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden /> Question of the Day
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {questions.length > 1 ? (
            <SegmentedControl
              ariaLabel="Subject"
              size="sm"
              value={String(current.id)}
              onChange={(v) => switchTo(Number(v))}
              options={questions.map((q) => ({
                value: String(q.id),
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    {SUBJECT_LABEL[q.subject] ?? q.subject}
                    {q.status === "answered" ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-label="answered" />
                    ) : null}
                  </span>
                ),
              }))}
            />
          ) : null}
          {isMath ? (
            <button
              type="button"
              onClick={() => {
                setCalcEnlarged(false);
                setCalcOpen((v) => !v);
              }}
              aria-pressed={calcOpen}
              className={cn(
                "flex flex-col items-center gap-0.5 transition-colors",
                calcOpen ? "text-primary" : "text-slate-600 hover:text-slate-900",
              )}
            >
              <Calculator className="h-5 w-5" />
              <span className="text-[9px] font-bold uppercase tracking-wider">Calculator</span>
            </button>
          ) : null}
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div
          className={cn(
            "mx-auto grid w-full items-start gap-6 px-4 py-6 sm:px-6 sm:py-8",
            result ? "max-w-6xl lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]" : "max-w-3xl",
          )}
        >
          <QuestionBody
            key={current.id}
            item={current}
            draft={draft}
            onDraft={(value) => setDrafts((prev) => ({ ...prev, [current.id]: value }))}
          />
          {result ? <ExplanationPane result={result} /> : null}
        </div>
      </main>

      <footer className="shrink-0 border-t border-slate-100 bg-white px-4 py-3 sm:px-6">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-semibold text-slate-500">{trackLabel(current)}</p>
          {result ? (
            nextOpen ? (
              <button
                type="button"
                onClick={() => switchTo(nextOpen.id)}
                className="rounded-xl bg-primary px-5 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Next: {SUBJECT_LABEL[nextOpen.subject] ?? nextOpen.subject} question
              </button>
            ) : (
              <button
                type="button"
                onClick={exit}
                className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-slate-700"
              >
                Done for today
              </button>
            )
          ) : (
            <div className="flex flex-col items-end gap-1">
              <button
                type="button"
                disabled={isBlank(draft) || submit.isPending}
                onClick={() => submit.mutate({ id: current.id, answer: draft })}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-2 text-sm font-bold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                Check
              </button>
              {error ? (
                <p role="alert" className="text-xs font-semibold text-red-600">
                  {error}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </footer>

      {isMath && calcOpen ? (
        <DesmosCalculator
          onClose={() => setCalcOpen(false)}
          enlarged={calcEnlarged}
          onToggleEnlarge={() => setCalcEnlarged((v) => !v)}
        />
      ) : null}
    </Sheet>
  );
}

/** The runner's full-screen white sheet. */
function Sheet({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-white text-slate-900">{children}</div>
  );
}

function QuestionBody({
  item,
  draft,
  onDraft,
}: {
  item: DailyQuestion;
  draft: unknown;
  onDraft: (value: unknown) => void;
}) {
  const q = item.question;
  const result = item.result;
  const figure = resolveImageUrl(q.question_image);
  const choices = parseChoices(q.choices);
  const optionImages: OptionImageMap = {
    A: q.option_a_image,
    B: q.option_b_image,
    C: q.option_c_image,
    D: q.option_d_image,
  };

  return (
    <div className="min-w-0 space-y-5">
      {/* Main content first (Reading: the passage · Math: the question), as in the runner. */}
      <AssessmentText
        text={q.prompt}
        block
        className="rounded-2xl border border-slate-200 bg-slate-50 p-6 font-[Georgia] text-base font-medium leading-relaxed text-slate-900"
      />
      {figure ? (
        <div className="flex justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
          {/* eslint-disable-next-line @next/next/no-img-element -- signed media URL, like the runner */}
          <img src={figure} alt="Question figure" className="max-h-[420px] max-w-full object-contain p-4" />
        </div>
      ) : null}
      {q.question_prompt && q.question_prompt.trim() ? (
        <AssessmentText
          text={q.question_prompt}
          block
          className="border-l-4 border-primary/50 bg-slate-50 py-2 pl-5 pr-4 font-[Georgia] text-base leading-relaxed text-slate-900"
        />
      ) : null}

      {result && choices.length > 0 ? (
        <CheckedChoices choices={choices} result={result} optionImages={optionImages} />
      ) : result ? (
        <CheckedAnswer result={result} />
      ) : (
        <AnswerInput
          type={q.question_type}
          choices={choices}
          value={draft}
          onChange={onDraft}
          optionImages={optionImages}
        />
      )}
    </div>
  );
}

/** The choices after Check: the key in green, a wrong pick in amber, the rest faded. */
function CheckedChoices({
  choices,
  result,
  optionImages,
}: {
  choices: AssessmentChoice[];
  result: DailyQuestionResult;
  optionImages: OptionImageMap;
}) {
  const right = acceptedIds(result.correct_answer);
  const picked = String(result.answer ?? "").trim().toUpperCase();

  return (
    <div className="grid gap-3" role="list" aria-label="Answer choices">
      {choices.map((c) => {
        const id = c.id.toUpperCase();
        const isKey = right.has(id);
        const isPick = picked === id;
        const img = resolveImageUrl(optionImages[c.id] ?? optionImages[id]);
        return (
          <div
            key={c.id}
            role="listitem"
            data-state={isKey ? "correct" : isPick ? "incorrect" : "other"}
            className={cn(
              "flex min-h-[64px] items-center gap-4 rounded-2xl border-2 px-4 py-3",
              isKey
                ? "border-emerald-500 bg-emerald-50"
                : isPick
                  ? "border-amber-500 bg-amber-50"
                  : "border-slate-200 bg-white opacity-60",
            )}
          >
            <span
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-sm font-extrabold",
                isKey
                  ? "border-emerald-600 bg-emerald-600 text-white"
                  : isPick
                    ? "border-amber-500 bg-amber-500 text-white"
                    : "border-slate-300 bg-white text-slate-700",
              )}
              aria-hidden
            >
              {c.id}
            </span>
            <div className="min-w-0 flex-1">
              <StableHtml
                html={processInstructionalText(c.text, { preserveNewlines: true })}
                className="text-base leading-snug text-slate-900"
              />
              {img ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed media URL
                <img src={img} alt={`Option ${c.id}`} className="mt-2 max-h-[220px] max-w-full rounded-lg border border-slate-100 object-contain" />
              ) : null}
            </div>
            {isKey ? (
              <span className="shrink-0 text-xs font-bold uppercase tracking-wide text-emerald-700">
                {isPick ? "Your answer · correct" : "Correct answer"}
              </span>
            ) : isPick ? (
              <span className="shrink-0 text-xs font-bold uppercase tracking-wide text-amber-700">Your answer</span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** A typed (grid-in) answer after Check: what was entered, and what the key accepts. */
function CheckedAnswer({ result }: { result: DailyQuestionResult }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div
        className={cn(
          "rounded-2xl border-2 px-4 py-3",
          result.is_correct ? "border-emerald-500 bg-emerald-50" : "border-amber-500 bg-amber-50",
        )}
      >
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Your answer</p>
        <p className="mt-1 text-lg font-bold text-slate-900">{formatAnswer(result.answer) || "—"}</p>
      </div>
      <div className="rounded-2xl border-2 border-emerald-500 bg-emerald-50 px-4 py-3">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Correct answer</p>
        <p className="mt-1 text-lg font-bold text-slate-900">{formatAnswer(result.correct_answer) || "—"}</p>
      </div>
    </div>
  );
}

function ExplanationPane({ result }: { result: DailyQuestionResult }) {
  const earned = result.earned.xp || result.earned.points;
  return (
    <aside
      aria-label="Explanation"
      aria-live="polite"
      className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-5"
    >
      {result.is_correct ? (
        <p data-verdict="correct" className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-700">
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          Correct!{earned ? ` ${rewardLabel(result.earned)}` : ""}
        </p>
      ) : (
        <p data-verdict="incorrect" className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-700">
          <AlertCircle className="h-4 w-4" aria-hidden />
          Not this time
        </p>
      )}
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Correct answer</p>
        <p className="mt-1 text-base font-semibold text-slate-900">{formatAnswer(result.correct_answer)}</p>
      </div>
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Explanation</p>
        {result.explanation ? (
          <AssessmentText
            text={result.explanation}
            block
            preserveNewlines
            className="mt-1 text-sm leading-relaxed text-slate-700"
          />
        ) : (
          <p className="mt-1 text-sm leading-relaxed text-slate-500">No explanation written for this question yet.</p>
        )}
      </div>
    </aside>
  );
}
