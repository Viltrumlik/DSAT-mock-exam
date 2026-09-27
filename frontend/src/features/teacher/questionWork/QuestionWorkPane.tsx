"use client";

/**
 * Working a question, with the checking beside it — the teacher's two question surfaces share
 * this one pane: the past-paper reader and the assessment practice runner.
 *
 * THE EXPLANATION IS ON THE LEFT, and that is deliberate. Everywhere else in this product the
 * explanation sits to the RIGHT of the question (the student review modal, the Review Center),
 * and the inversion here is not drift: the owner asked for it on the left on these two
 * surfaces specifically. This is a TEACHER surface — a teacher reads the solution first and the
 * question second, which is the opposite of how a student reads the pair. On a phone there is
 * no left, so the columns stack with the explanation BELOW the question, which is also the DOM
 * order: the question is the thing being worked, so it comes first for a keyboard and a screen
 * reader whatever the screen is doing.
 *
 * TEACHERS ONLY. Nothing student-facing imports this, and it reveals nothing the caller was not
 * already holding: both mounts read their question from an authoring endpoint that has always
 * answered with the key attached. No student payload changes to make this work.
 *
 * Painted in slate/emerald rather than the teacher kit's `--dz-*` tokens, on purpose: those
 * tokens are scoped under `.dzboard`, and the assessment practice runner lives outside it. Both
 * mounts draw their question on the runner's white sheet, and this pane belongs to that sheet.
 */

import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { AssessmentText } from "@/lib/assessmentText";
import { judgeAnswer, type AnswerKey, type Verdict } from "./answerKey";
import { useQuestionCheck } from "./useQuestionCheck";

export function QuestionWorkPane({
  questionId,
  answer,
  answerKey,
  children,
}: {
  /** Whatever identifies this question to its host; a change hides a previous check. */
  questionId: string | number;
  /** The teacher's current answer, exactly as the AnswerInput handed it up. */
  answer: unknown;
  answerKey: AnswerKey;
  /** The question itself, drawn by the caller with the runner's own components. */
  children: ReactNode;
}) {
  const { hasAnswer, checked, check, answer: given } = useQuestionCheck(questionId, answer);
  const verdict = checked ? judgeAnswer(given, answerKey) : "unknown";

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]">
      {/* The question — column two on a wide screen, first in the DOM everywhere. */}
      <div className="min-w-0 lg:col-start-2 lg:row-start-1">
        {children}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          {/* Said out loud where the button is, because a teacher's first fear on seeing a
              Check button inside a real paper is that they are spending something. */}
          <p className="text-xs font-semibold text-slate-500">
            Just for you — checking saves nothing and starts no attempt.
          </p>
          {hasAnswer ? (
            <button
              type="button"
              onClick={check}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-slate-700"
            >
              Check
            </button>
          ) : null}
        </div>
      </div>

      {/* The explanation — column one on a wide screen, under the question on a phone. */}
      <aside
        aria-label="Explanation"
        aria-live="polite"
        className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-5 lg:col-start-1 lg:row-start-1"
      >
        <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-slate-400">Explanation</p>
        {checked ? (
          <Revealed verdict={verdict} answerKey={answerKey} />
        ) : (
          /* Before the teacher answers there is nothing here to spoil: no key, no solution,
             only what this column is for. */
          <p className="mt-3 text-sm leading-relaxed text-slate-500">
            Answer the question, then press Check. What counts as right, and why, appears here.
          </p>
        )}
      </aside>
    </div>
  );
}

function Revealed({ verdict, answerKey }: { verdict: Verdict; answerKey: AnswerKey }) {
  return (
    <div className="mt-3 space-y-4">
      {/* `data-verdict` is the verdict itself, so a test can hold the badge rather than search
          the pane's text for "Correct" — which the "Correct answer" heading below satisfies on
          its own, and did. */}
      {verdict === "correct" ? (
        <p data-verdict={verdict} className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-sm font-bold text-emerald-700">
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          Correct
        </p>
      ) : verdict === "incorrect" ? (
        /* "Not correct yet" rather than "Wrong": the house's growth-oriented wording holds on
           the teacher's side of the product too, and a teacher checking their own working is
           in exactly the position a student is. */
        <p data-verdict={verdict} className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-sm font-bold text-amber-700">
          <AlertCircle className="h-4 w-4" aria-hidden />
          Not correct yet
        </p>
      ) : null}

      {answerKey.accepted.length > 0 ? (
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Correct answer</p>
          <AssessmentText
            text={answerKey.label}
            block
            className="mt-1 text-base font-semibold text-slate-900"
          />
        </div>
      ) : (
        /* No key on file. Saying so beats marking a teacher's answer wrong on the strength of
           a blank field — the question is what is incomplete, not their working. */
        <p className="text-sm leading-relaxed text-slate-500">
          No answer key is recorded for this question yet, so this one can&apos;t be checked.
        </p>
      )}

      {answerKey.explanation ? (
        <AssessmentText
          text={answerKey.explanation}
          block
          className="text-sm leading-relaxed text-slate-700"
        />
      ) : (
        /* An empty panel would read as "the explanation failed to load". Most questions have
           one; the few hundred that do not should say which they are. */
        <p className="text-sm leading-relaxed text-slate-500">
          No explanation written for this question yet.
        </p>
      )}
    </div>
  );
}
