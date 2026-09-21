"use client";

/**
 * /teacher/pastpapers/[paperId] — a teacher opens a past paper and reads it.
 *
 * The question is drawn by the very components the student runner draws it with — AnswerInput
 * and AssessmentText — exactly as the assessment preview at /teacher/assessments/[setId]/practice
 * does, so what a teacher reads here is what their class will see, down to the fraction preview
 * on a grid-in.
 *
 * READ-ONLY, in both senses: nothing about the paper can be edited here, and answering a
 * question writes nowhere. There is no attempt, no timer, no score. A teacher clicking a choice
 * is thinking, not sitting the paper, so the choice lives in this component and dies with it.
 *
 * The answer key rides along in the payload (the endpoint is the authoring one), and since the
 * checking slice it is what Check reveals — in QuestionWorkPane, which owns both seams this
 * file used to hold open: the footer under the question and the column beside it. Pressing
 * Check still writes nowhere; it compares two strings in the browser.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { AnswerInput } from "@/features/assessments/components/QuestionInputs";
import type { AssessmentChoice } from "@/features/assessments/types";
import { AssessmentText } from "@/lib/assessmentText";
import { resolveImageUrl } from "@/features/testing-simulation/utils/image";
import { Button, Card, EmptyState, ErrorState, Skeleton, TeacherPage } from "../ui";
import { answerKeyFromReviewQuestion, QuestionWorkPane } from "../questionWork";
import type { TeacherPaperQuestion } from "./api";
import { useTeacherPaper } from "./hooks";
import { paperSubtitle, paperTitle } from "./labels";

const BACK_TO_LIBRARY = (
  <Link href="/teacher/pastpapers">
    <Button variant="ghost">
      <ArrowLeft size={15} aria-hidden />
      All past papers
    </Button>
  </Link>
);

export function TeacherPaper({ paperId }: { paperId: number }) {
  const query = useTeacherPaper(paperId);
  const questions = useMemo(() => query.data?.questions ?? [], [query.data]);

  const [index, setIndex] = useState(0);
  /**
   * Keyed by the question's own key. That key is `q-${q.id ?? idx}` (reviewCenter/normalize),
   * which two modules COULD collide on if they ever carried the same question id — database
   * PKs are unique across the table, so they cannot, and this is safe by the data rather than
   * by the key's construction.
   */
  const [answers, setAnswers] = useState<Record<string, unknown>>({});

  /**
   * "Module 2 · Question 4 of 22". A past paper is two modules and the teacher's copy numbers
   * each from one, so a number counted across the whole paper would not match the sheet.
   */
  const numbering = useMemo(() => {
    const seen = new Map<number, number>();
    const totals = new Map<number, number>();
    for (const q of questions) totals.set(q.moduleOrder, (totals.get(q.moduleOrder) ?? 0) + 1);
    return questions.map((q) => {
      const n = (seen.get(q.moduleOrder) ?? 0) + 1;
      seen.set(q.moduleOrder, n);
      return { moduleOrder: q.moduleOrder, n, of: totals.get(q.moduleOrder) ?? 0 };
    });
  }, [questions]);

  const title = query.data ? paperTitle(query.data.paper) : "Past paper";
  const subtitle = query.data ? paperSubtitle(query.data.paper) : undefined;

  // Before anything the query can say, because a paperId that is not a number disables the
  // query — and a disabled react-query v5 query sits at status "pending" for ever. Without
  // this, /teacher/pastpapers/abc drew the loading skeleton and never stopped: a dead end
  // painted as work in progress. HomeworkGradingAssignmentView makes the same check for the
  // same reason, and says so in one line.
  if (!Number.isFinite(paperId) || paperId <= 0) {
    return (
      <TeacherPage title="Past paper" actions={BACK_TO_LIBRARY}>
        <Card>
          <ErrorState
            title="This link doesn't point at a paper"
            detail="Nothing was loaded, and nothing is missing — the address is not a paper's. Open the paper you want from the past-paper library."
          />
        </Card>
      </TeacherPage>
    );
  }

  if (query.isError) {
    return (
      <TeacherPage title="Past paper" actions={BACK_TO_LIBRARY}>
        <Card>
          <ErrorState
            title="This paper didn't load"
            detail="Its questions did not come back. Nothing has been changed — try again."
            onRetry={() => void query.refetch()}
          />
        </Card>
      </TeacherPage>
    );
  }

  if (query.isPending) {
    return (
      <TeacherPage title="Past paper" actions={BACK_TO_LIBRARY}>
        <Card><Skeleton height={28} count={8} /></Card>
      </TeacherPage>
    );
  }

  if (questions.length === 0) {
    return (
      <TeacherPage title={title} subtitle={subtitle} actions={BACK_TO_LIBRARY}>
        <Card>
          <EmptyState
            title="This paper has no questions yet"
            hint="Its modules are in place but empty, so there is nothing to read here yet."
          />
        </Card>
      </TeacherPage>
    );
  }

  const current = questions[Math.min(index, questions.length - 1)];
  const place = numbering[Math.min(index, numbering.length - 1)];

  return (
    <TeacherPage title={title} subtitle={subtitle} actions={BACK_TO_LIBRARY}>
      <Card padded={false}>
        {/* Two columns now, and the pane owns the grid: the explanation to the left of the
            question on a wide screen, under it on a phone. */}
        <div style={{ padding: "20px 22px" }}>
          <QuestionWorkPane
            questionId={current.key}
            answer={answers[current.key] ?? null}
            answerKey={answerKeyFromReviewQuestion(current)}
          >
            <article>
              <p style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--dz-faint)", margin: 0 }}>
                Module {place.moduleOrder} · Question {place.n} of {place.of}
              </p>
              <QuestionBody
                question={current}
                value={answers[current.key] ?? null}
                onChange={(next) => setAnswers((prev) => ({ ...prev, [current.key]: next }))}
              />
            </article>
          </QuestionWorkPane>
        </div>

        <footer style={{ borderTop: "1px solid var(--dz-border)", padding: "14px 22px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
          <Button variant="ghost" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index <= 0}>
            <ChevronLeft size={15} aria-hidden />
            Previous
          </Button>
          <QuestionMap questions={questions} numbering={numbering} index={index} onPick={setIndex} />
          <Button
            variant="ghost"
            onClick={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}
            disabled={index >= questions.length - 1}
          >
            Next
            <ChevronRight size={15} aria-hidden />
          </Button>
        </footer>
      </Card>
    </TeacherPage>
  );
}

/**
 * The student's own reading order: the main content first (Reading — the passage; Math — the
 * question), the figure, then the prompt that sits right above the choices. Explicitly light,
 * because AnswerInput and AssessmentText are the runner's components and are painted for the
 * runner's white sheet — the assessment preview makes the same call for the same reason.
 */
function QuestionBody({ question, value, onChange }: {
  question: TeacherPaperQuestion;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const figure = resolveImageUrl(question.image);
  const choices: AssessmentChoice[] = question.choices.map((c) => ({ id: c.id, text: c.text }));
  const optionImages = Object.fromEntries(question.choices.map((c) => [c.id, c.image ?? null]));

  return (
    <div className="mt-4 space-y-5 rounded-2xl bg-white p-5 text-slate-900">
      <AssessmentText
        text={question.prompt}
        block
        className="rounded-2xl border border-slate-200 bg-slate-50 p-6 font-[Georgia] text-base font-medium leading-relaxed text-slate-900"
      />
      {figure ? (
        <div className="flex justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={figure} alt="Question figure" className="max-h-[420px] max-w-full object-contain p-4" />
        </div>
      ) : null}
      {question.questionPrompt && question.questionPrompt.trim().length > 0 ? (
        <AssessmentText
          text={question.questionPrompt}
          block
          className="border-l-4 border-primary/50 bg-slate-50 py-2 pl-5 pr-4 font-[Georgia] text-base leading-relaxed text-slate-900"
        />
      ) : null}
      <AnswerInput
        type={question.isChoice ? "multiple_choice" : "numeric"}
        choices={choices}
        value={value}
        onChange={onChange}
        optionImages={optionImages}
      />
    </div>
  );
}

/** Every question of the paper, one button each, module by module. */
function QuestionMap({ questions, numbering, index, onPick }: {
  questions: TeacherPaperQuestion[];
  numbering: { moduleOrder: number; n: number; of: number }[];
  index: number;
  onPick: (i: number) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "center", flex: "1 1 240px" }}>
      {questions.map((q, i) => {
        const place = numbering[i];
        const first = i === 0 || numbering[i - 1].moduleOrder !== place.moduleOrder;
        const active = i === index;
        return (
          <span key={q.key} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {first && (
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--dz-faint)" }}>
                Module {place.moduleOrder}
              </span>
            )}
            <button
              type="button"
              onClick={() => onPick(i)}
              aria-label={`Module ${place.moduleOrder}, question ${place.n}`}
              aria-current={active ? "true" : undefined}
              style={{
                height: 28, minWidth: 28, padding: "0 6px", borderRadius: 9, border: "none", cursor: "pointer",
                fontFamily: "inherit", fontSize: 12, fontWeight: 700,
                background: active ? "var(--dz-indigo)" : "var(--dz-neutral-soft)",
                color: active ? "#fff" : "var(--dz-mute)",
              }}
            >
              {place.n}
            </button>
          </span>
        );
      })}
    </div>
  );
}
