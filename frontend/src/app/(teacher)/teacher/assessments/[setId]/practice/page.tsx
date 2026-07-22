"use client";

/**
 * /teacher/assessments/[setId]/practice — teachers solve an assessment in the
 * same view students get. Nothing is persisted: questions are fetched from the
 * admin set endpoint, answered client-side, and graded locally so the teacher
 * can preview the exact student experience (runner → result → per-question review).
 */

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { assessmentsAdminApi } from "@/lib/api";
import { AnswerInput } from "@/features/assessments/components/QuestionInputs";
import { AssessmentText } from "@/lib/assessmentText";
import { resolveImageUrl } from "@/features/testing-simulation/utils/image";
import { DesmosCalculator } from "@/features/testing-simulation/tools/calculator/DesmosCalculator";
import { normalizeAnswer } from "@/features/assessments/components/QuestionDeepDive";
import { SummaryResultView, type SummaryRow, type SummaryRowStatus } from "@/features/assessments/components/SummaryResultView";
import { QuestionReviewModal } from "@/features/assessments/components/QuestionReviewModal";
import type { PedagogicalReviewQuestion } from "@/features/assessmentsStudent/api";
import type { AssessmentChoice, AssessmentQuestion } from "@/features/assessments/types";
import { ArrowLeft, Calculator, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

type AdminSet = {
  id: number;
  title?: string | null;
  subject?: string | null;
  level?: string | null;
  questions?: AssessmentQuestion[] | null;
};

/** True when the answer matches any accepted correct value (handles list answers). */
function isAnswerCorrect(q: AssessmentQuestion, ans: unknown): boolean {
  const s = normalizeAnswer(ans);
  if (s == null) return false;
  const correct = q.correct_answer;
  const candidates = Array.isArray(correct) ? correct : [correct];
  return candidates.some((c) => {
    const cn = normalizeAnswer(c);
    return cn != null && cn.toLowerCase() === s.toLowerCase();
  });
}

function answerToDisplay(value: unknown): string {
  const n = normalizeAnswer(value);
  return n ?? "—";
}

export default function TeacherAssessmentPracticePage() {
  const router = useRouter();
  const params = useParams();
  const setId = Number(params.setId);

  const [set, setSet] = useState<AdminSet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [answers, setAnswers] = useState<Record<number, unknown>>({});
  const [currentIdx, setCurrentIdx] = useState(0);
  const [phase, setPhase] = useState<"solving" | "result">("solving");
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);
  const [showAnswers, setShowAnswers] = useState(true);
  const [calcOpen, setCalcOpen] = useState(false);
  const [calcEnlarged, setCalcEnlarged] = useState(false);

  useEffect(() => {
    if (!Number.isFinite(setId)) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = (await assessmentsAdminApi.adminGetSet(setId)) as AdminSet;
        if (!cancelled) setSet(data);
      } catch {
        if (!cancelled) setError("Could not load this assessment.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [setId]);

  const questions = useMemo(
    () => [...(set?.questions ?? [])].filter((q) => q.is_active !== false).sort((a, b) => a.order - b.order),
    [set],
  );
  const total = questions.length;
  const current = questions[currentIdx];

  const calculatorEnabled =
    (set?.subject || "").toLowerCase() === "math" &&
    ["middle", "senior"].includes((set?.level || "").toLowerCase());

  // Map to the shared review shape (correct answers shown — teachers see them).
  const reviewQuestions: PedagogicalReviewQuestion[] = useMemo(
    () =>
      questions.map((q) => {
        const choices = Array.isArray(q.choices) ? q.choices : [];
        const ans = answers[q.id];
        return {
          id: q.id,
          order: q.order,
          prompt: q.prompt,
          question_prompt: q.question_prompt ?? "",
          question_type: q.question_type,
          choices: choices.map((c: AssessmentChoice | Record<string, unknown>) => ({
            key: String((c as AssessmentChoice).id ?? (c as { key?: unknown }).key ?? ""),
            text: String((c as AssessmentChoice).text ?? ""),
          })),
          correct_answer: q.correct_answer,
          student_answer: ans == null ? null : (ans as string),
          is_correct: isAnswerCorrect(q, ans),
          explanation: q.explanation ?? "",
          question_image: q.question_image ?? null,
          option_a_image: q.option_a_image ?? null,
          option_b_image: q.option_b_image ?? null,
          option_c_image: q.option_c_image ?? null,
          option_d_image: q.option_d_image ?? null,
          points: q.points,
          points_awarded: isAnswerCorrect(q, ans) ? q.points : 0,
        } as PedagogicalReviewQuestion;
      }),
    [questions, answers],
  );

  const rows: SummaryRow[] = useMemo(
    () =>
      questions.map((q) => {
        const ans = answers[q.id];
        const empty = normalizeAnswer(ans) == null;
        const status: SummaryRowStatus = empty ? "omitted" : isAnswerCorrect(q, ans) ? "correct" : "incorrect";
        return { id: q.id, order: q.order, status, correctDisplay: answerToDisplay(q.correct_answer), seconds: 0 };
      }),
    [questions, answers],
  );

  const correctCount = rows.filter((r) => r.status === "correct").length;
  const maxPoints = questions.reduce((sum, q) => sum + (Number(q.points) || 0), 0);
  const scorePoints = questions.reduce((sum, q) => sum + (isAnswerCorrect(q, answers[q.id]) ? Number(q.points) || 0 : 0), 0);
  const percent = total > 0 ? Math.round((correctCount / total) * 100) : 0;

  const restart = () => {
    setAnswers({});
    setCurrentIdx(0);
    setPhase("solving");
    setReviewIndex(null);
  };

  if (loading) {
    return (
      <AuthGuard>
        <div className="flex min-h-dvh items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      </AuthGuard>
    );
  }
  if (error || !set || total === 0) {
    return (
      <AuthGuard>
        <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="text-sm font-semibold text-muted-foreground">{error || "This assessment has no questions to practice."}</p>
          <button type="button" onClick={() => router.push("/teacher/assessments")} className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90">
            Back to assessments
          </button>
        </div>
      </AuthGuard>
    );
  }

  // ── Result phase — same summary + two-pane review as students ──
  if (phase === "result") {
    return (
      <AuthGuard>
        <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
          <SummaryResultView
            title={set.title || "Assessment"}
            percent={percent}
            correctCount={correctCount}
            totalQuestions={total}
            totalTimeLabel="—"
            scorePoints={String(scorePoints)}
            maxPoints={String(maxPoints)}
            avgPerQuestionLabel="—"
            rows={rows}
            showAnswers={showAnswers}
            onToggleShowAnswers={() => setShowAnswers((v) => !v)}
            backLabel="Back to assessments"
            onBack={() => router.push("/teacher/assessments")}
            onRetry={restart}
            onReview={(row) => {
              const idx = questions.findIndex((q) => q.id === row.id);
              if (idx >= 0) setReviewIndex(idx);
            }}
          />
        </div>
        {reviewIndex != null ? (
          <QuestionReviewModal
            questions={reviewQuestions}
            index={reviewIndex}
            showAnswers={showAnswers}
            onIndexChange={setReviewIndex}
            onClose={() => setReviewIndex(null)}
          />
        ) : null}
      </AuthGuard>
    );
  }

  // ── Solving phase — student-style full-screen runner ──
  const figure = resolveImageUrl(current.question_image);
  const answeredCount = questions.filter((q) => normalizeAnswer(answers[q.id]) != null).length;
  const isLast = currentIdx >= total - 1;

  return (
    <AuthGuard>
      <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-white font-sans text-slate-900">
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 bg-white px-6 py-3 shadow-sm">
          <button type="button" onClick={() => router.push("/teacher/assessments")} className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 transition-colors hover:text-slate-900">
            <ArrowLeft className="h-4 w-4" /> Exit practice
          </button>
          <div className="min-w-0 text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">Teacher practice · not saved</p>
            <h1 className="truncate text-sm font-bold tracking-tight text-slate-900">{set.title || "Assessment"}</h1>
          </div>
          <div className="flex items-center gap-3">
            {calculatorEnabled ? (
              <button
                type="button"
                onClick={() => { setCalcEnlarged(false); setCalcOpen((v) => !v); }}
                className={`flex flex-col items-center gap-0.5 transition-colors ${calcOpen ? "text-primary" : "text-slate-600 hover:text-slate-900"}`}
              >
                <Calculator className="h-5 w-5" />
                <span className="text-[9px] font-bold uppercase tracking-wider">Calculator</span>
              </button>
            ) : null}
            <span className="text-sm font-bold tabular-nums text-slate-700">{answeredCount}/{total}</span>
          </div>
        </header>

        {/* Question body */}
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl space-y-5 px-6 py-8">
            <p className="text-xs font-extrabold uppercase tracking-widest text-slate-400">Question {currentIdx + 1} of {total}</p>
            {/* main content — shown FIRST (Reading: the passage · Math: the question) */}
            <AssessmentText text={current.prompt} block className="rounded-2xl border border-slate-200 bg-slate-50 p-6 font-[Georgia] text-base font-medium leading-relaxed text-slate-900" />
            {figure ? (
              <div className="flex justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={figure} alt="Question figure" className="max-h-[420px] max-w-full object-contain p-4" />
              </div>
            ) : null}
            {/* question prompt — shown AFTER the main content (Reading: the actual question) */}
            {current.question_prompt && current.question_prompt.trim().length > 0 ? (
              <AssessmentText text={current.question_prompt} block className="border-l-4 border-primary/50 bg-slate-50 py-2 pl-5 pr-4 font-[Georgia] text-base leading-relaxed text-slate-900" />
            ) : null}
            <AnswerInput
              type={current.question_type}
              choices={(Array.isArray(current.choices) ? current.choices : []) as AssessmentChoice[]}
              value={answers[current.id] ?? null}
              onChange={(next) => setAnswers((p) => ({ ...p, [current.id]: next }))}
              optionImages={{
                A: current.option_a_image, B: current.option_b_image,
                C: current.option_c_image, D: current.option_d_image,
              }}
            />
          </div>
        </main>

        {/* Footer nav + question map */}
        <footer className="shrink-0 border-t border-slate-100 bg-white px-6 py-3">
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
              disabled={currentIdx <= 0}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" /> Back
            </button>
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {questions.map((q, i) => {
                const answered = normalizeAnswer(answers[q.id]) != null;
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setCurrentIdx(i)}
                    aria-label={`Go to question ${i + 1}`}
                    className={`h-7 w-7 rounded-lg text-xs font-bold transition-colors ${
                      i === currentIdx ? "bg-primary text-primary-foreground" : answered ? "bg-primary/15 text-primary" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                    }`}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
            {isLast ? (
              <button
                type="button"
                onClick={() => setPhase("result")}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-emerald-700"
              >
                Finish & score
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setCurrentIdx((i) => Math.min(total - 1, i + 1))}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Next <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </footer>

        {calculatorEnabled && calcOpen ? (
          <DesmosCalculator onClose={() => setCalcOpen(false)} enlarged={calcEnlarged} onToggleEnlarge={() => setCalcEnlarged((v) => !v)} />
        ) : null}
      </div>
    </AuthGuard>
  );
}
