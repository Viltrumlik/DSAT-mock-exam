"use client";

/**
 * One missed question, in a pop-up, with the teacher able to work it.
 *
 * The owner's ask, in translation: *"from there open the full question in a pop-up window and
 * work it."* So this is not a preview card. The question is drawn by the very components the
 * student runner draws it with — `AssessmentText` for the prose and the maths, `AnswerInput`
 * for the choices and the grid-in — and it is mounted inside `QuestionWorkPane`, which is the
 * same pane the past-paper reader and the assessment practice runner use: answer it, a Check
 * button appears, and pressing Check reveals the correct answer and the explanation.
 *
 * NOTHING IS SAVED. There is no attempt, no timer and no score; the answers live in this
 * component and die when it closes. `QuestionWorkPane` says so on screen, where the teacher
 * can read it, because a Check button inside a real paper looks like it might be spending
 * something.
 *
 * The pop-up walks the list: Previous and Next move between the worst questions without
 * closing, and Escape closes (the kit's `Dialog` owns that, as it owns the backdrop click).
 *
 * TWO THINGS THIS FILE DOES THAT LOOK ODD, AND WHY:
 *
 * `size="xl"`. The kit's `Dialog` is sized for one decision (440px); a question needs a
 * reader's width, and this is the caller that asks for it. This used to be a scoped
 * `max-width` rule injected into the dialog, because the kit had no width to pass. The kit has
 * one now, and that rule is gone with it.
 *
 * The body scroll lock. The kit's `Dialog` portals onto `<body>` and holds focus inside
 * itself, but it lets the page behind it scroll — a one-decision dialog is read in a glance,
 * while a question is read for a minute with a wheel under the hand, and the homework must not
 * slide away underneath it.
 *
 * The portal onto `<body>` and the `.dzboard` token scope around the dialog are the kit's own
 * doing now; see the note on `Dialog` for why both are load-bearing. What this file still has
 * to undo is the typeface that scope carries with it: the point of the pop-up is that a
 * teacher reads exactly what their class read, so `QuestionBody` puts `--font-sans` back.
 */

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, KeyRound } from "lucide-react";
import { AnswerInput } from "@/features/assessments/components/QuestionInputs";
import { AssessmentText } from "@/lib/assessmentText";
import { resolveImageUrl } from "@/features/testing-simulation/utils/image";
import { Button, Dialog, ErrorState, Skeleton } from "@/features/teacher/ui";
import { QuestionWorkPane } from "@/features/teacher/questionWork";
import { useQuestionBody, type PopupQuestion } from "./questionBody";
import type { MissedRow } from "./rows";

export function QuestionPopup({
  rows,
  index,
  onIndex,
  onClose,
}: {
  /** The ranked list, so Previous and Next walk it in the order the teacher is reading. */
  rows: MissedRow[];
  index: number;
  onIndex: (next: number) => void;
  onClose: () => void;
}) {
  const row = rows[index];
  /**
   * Keyed by the row's key rather than reset on every move, so a teacher who steps forward to
   * peek at the next question and comes back finds their working where they left it. The map
   * is local: closing the pop-up is what throws it away.
   */
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const body = useQuestionBody(row?.source ?? null, row?.questionId ?? null);

  // Left and right walk the list the same way the buttons do — a teacher reading five
  // questions in a row should not have to aim at a button each time.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ...but not while the teacher is typing. A grid-in is a real <input>, so Left inside
      // `25/7` has to move the caret; stealing it would throw away what they had typed AND
      // move them to another question. Choice buttons are caught by the same guard.
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
        return;
      }
      if (e.key === "ArrowRight" && index < rows.length - 1) onIndex(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [index, rows.length, onIndex]);

  // The kit's Dialog holds focus but locks nothing. A question is read for long enough that
  // the homework behind it must not scroll away under the teacher's wheel.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!row) return null;

  return (
    <Dialog open size="xl" title={row.place} description={row.line} cancelLabel="Close" onClose={onClose}>
      <div data-missed-popup>
        {/* Where in the ranked list this question is, named rather than implied: a teacher
            walking the worst five needs to know which of the five is in front of them, and
            which set or paper it came off. */}
        <p
          data-missed-position
          style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--dz-faint)", margin: "0 0 10px" }}
        >
          Most missed · {index + 1} of {rows.length}
          {row.source.kind === "assessment"
            ? ` · ${row.source.setTitle}`
            : row.source.paperTitle
              ? ` · ${row.source.paperTitle}`
              : ""}
        </p>

        {row.suspectKey ? (
          /* At 90%+ the backend says the recorded key is likelier broken than the topic is
             hard. A teacher about to reteach this deserves to be told before they read it,
             not after. */
          <p
            style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, lineHeight: 1.5, color: "var(--dz-ink)", background: "var(--dz-amber-soft)", borderRadius: 14, padding: "10px 12px", margin: "0 0 14px" }}
          >
            <KeyRound size={15} aria-hidden style={{ marginTop: 2, flexShrink: 0, color: "var(--dz-amber)" }} />
            <span>
              Almost everyone missed this one. That is far more often a wrong answer key than a
              hard question — read the key here before you plan a lesson around it.
            </span>
          </p>
        ) : null}

        {body.status === "loading" ? (
          <Skeleton height={24} count={7} />
        ) : body.status === "error" ? (
          <ErrorState
            title="This question didn't load"
            detail="The figures above are real; only the question itself did not come back. Nothing has been changed — try again."
            onRetry={body.retry}
          />
        ) : body.status === "removed" ? (
          <ErrorState
            title="This question is no longer in the set"
            detail="The class answered it, but it has since been removed from the set or the paper, so there is nothing left to open. Its figures above still stand."
          />
        ) : (
          <QuestionWorkPane
            questionId={row.key}
            answer={answers[row.key] ?? null}
            answerKey={body.question.answerKey}
          >
            <QuestionBody
              /* Remounted per question. `NumericInput` is deliberately uncontrolled and only
                 adopts an external value when it differs from what it last committed, so a
                 half-typed `1.` — a transient token that never fires onChange — would
                 otherwise still be sitting in the box on the NEXT question. */
              key={row.key}
              question={body.question}
              value={answers[row.key] ?? null}
              onChange={(next) => setAnswers((prev) => ({ ...prev, [row.key]: next }))}
            />
          </QuestionWorkPane>
        )}

        <footer
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginTop: 18, borderTop: "1px solid var(--dz-border)", paddingTop: 14 }}
        >
          <Button variant="ghost" onClick={() => onIndex(index - 1)} disabled={index <= 0}>
            <ChevronLeft size={15} aria-hidden />
            Previous
          </Button>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--dz-mute)" }}>
            {index + 1} / {rows.length}
          </span>
          <Button
            variant="ghost"
            onClick={() => onIndex(index + 1)}
            disabled={index >= rows.length - 1}
          >
            Next
            <ChevronRight size={15} aria-hidden />
          </Button>
        </footer>
      </div>
    </Dialog>
  );
}

/**
 * The student's own reading order — the main content, the figure, then the prompt that sits
 * directly above the choices. Explicitly light, because `AnswerInput` and `AssessmentText` are
 * the runner's components and are painted for the runner's white sheet; the past-paper reader
 * and the assessment preview both make the same call, and the point of this pop-up is that a
 * teacher reads exactly what their class read.
 */
function QuestionBody({
  question,
  value,
  onChange,
}: {
  question: PopupQuestion;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const figure = useMemo(() => resolveImageUrl(question.image), [question.image]);
  return (
    /* The app's own typeface, put back deliberately: the `.dzboard` wrapper above carries the
       teacher panel's `--font-plus-jakarta` down the tree, and it would inherit into the
       choices — so a teacher would read the question in a face their class never saw. */
    <div
      className="space-y-5 rounded-2xl bg-white p-5 text-slate-900"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      <AssessmentText
        text={question.prompt}
        block
        className="rounded-2xl border border-slate-200 bg-slate-50 p-5 font-[Georgia] text-base font-medium leading-relaxed text-slate-900"
      />
      {figure ? (
        <div className="flex justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={figure} alt="Question figure" className="max-h-[380px] max-w-full object-contain p-4" />
        </div>
      ) : null}
      {question.questionPrompt && question.questionPrompt.trim() ? (
        <AssessmentText
          text={question.questionPrompt}
          block
          className="border-l-4 border-primary/50 bg-slate-50 py-2 pl-5 pr-4 font-[Georgia] text-base leading-relaxed text-slate-900"
        />
      ) : null}
      <AnswerInput
        type={question.inputType}
        choices={question.choices}
        value={value}
        onChange={onChange}
        optionImages={question.optionImages}
      />
    </div>
  );
}
