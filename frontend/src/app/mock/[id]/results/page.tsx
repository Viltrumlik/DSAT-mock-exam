"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { examsPublicApi } from "@/lib/api";
import { platformSubjectIsMath, platformSubjectIsReadingWriting } from "@/lib/permissions";
import { ArrowLeft, Trophy } from "lucide-react";

function ResultsInner() {
  const { id } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const mockId = Number(id);
  const [loading, setLoading] = useState(true);
  const [rwScore, setRwScore] = useState<number | null>(null);
  const [mathScore, setMathScore] = useState<number | null>(null);
  const [title, setTitle] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mock = await examsPublicApi.getMockExam(mockId);
        if (cancelled) return;
        setTitle(mock.title || "Mock exam");
        const rwTest = (mock.tests || []).find((t: any) => platformSubjectIsReadingWriting(t.subject));
        const mathTest = (mock.tests || []).find((t: any) => platformSubjectIsMath(t.subject));
        const rwParam = searchParams.get("rwAttempt");
        const mathParam = searchParams.get("mathAttempt");
        const attemptsBundle = await examsPublicApi.getAttempts();
        if (cancelled) return;

        const attemptItems = attemptsBundle.items;

        const pick = (testId: number | undefined, param: string | null) => {
          if (!testId) return null;
          if (param) {
            const a = attemptItems.find((x) => String(x.id) === param && x.practice_test === testId);
            if (a?.is_completed) return a;
          }
          const list = attemptItems
            .filter((a) => a.practice_test === testId && a.is_completed)
            .sort((a, b) => (b.id || 0) - (a.id || 0));
          return list[0] || null;
        };

        const rwA = pick(rwTest?.id, rwParam);
        const mathA = pick(mathTest?.id, mathParam);
        setRwScore(rwA?.score ?? null);
        setMathScore(mathA?.score ?? null);
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mockId, searchParams]);

  const total =
    rwScore != null && mathScore != null ? Math.min(1600, (rwScore || 0) + (mathScore || 0)) : null;

  return (
    <AuthGuard>
      <div className="min-h-screen bg-background">
        <header className="border-b border-border bg-card">
          <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-6">
            <button
              type="button"
              onClick={() => router.push("/mock-exam")}
              className="flex items-center gap-2 text-sm font-bold text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="w-5 h-5" /> Mock exams
            </button>
          </div>
        </header>
        <main className="max-w-3xl mx-auto px-6 py-16 text-center">
          {loading ? (
            <div className="flex justify-center py-20">
              <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          ) : (
            <>
              <Trophy className="mx-auto mb-6 h-16 w-16 text-primary" />
              <p className="mb-2 text-xs font-black uppercase tracking-widest text-label-foreground">Finished</p>
              <h1 className="mb-2 text-3xl font-black text-foreground">{title}</h1>
              <p className="mb-10 font-medium text-muted-foreground">Your scores out of the SAT 1600 scale (800 + 800).</p>
              <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
                  <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-primary">
                    Reading &amp; Writing
                  </p>
                  <p className="text-4xl font-black text-foreground">{rwScore ?? "—"}</p>
                  <p className="mt-1 text-xs font-bold text-label-foreground">/ 800</p>
                </div>
                <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
                  <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-emerald-600">Math</p>
                  <p className="text-4xl font-black text-foreground">{mathScore ?? "—"}</p>
                  <p className="mt-1 text-xs font-bold text-label-foreground">/ 800</p>
                </div>
              </div>
              <div className="rounded-3xl bg-foreground p-10 text-background shadow-xl">
                <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-background/70">Total</p>
                <p className="text-5xl font-black tabular-nums">{total ?? "—"}</p>
                <p className="mt-2 text-sm font-bold text-background/70">out of 1600</p>
              </div>

              <div className="mt-12 rounded-3xl border border-border bg-card p-8 text-left shadow-sm">
                <h2 className="mb-4 text-lg font-black tracking-tight text-foreground">Test analysis</h2>
                <p className="mb-4 text-sm font-medium leading-relaxed text-muted-foreground">
                  Short read on how this attempt lines up with typical SAT pacing. Use review links below to see every item you
                  missed or skipped.
                </p>
                <ul className="space-y-3 text-sm text-foreground">
                  <li className="flex gap-2">
                    <span className="shrink-0 font-black text-primary">•</span>
                    <span>
                      <strong>Reading &amp; Writing:</strong>{" "}
                      {rwScore == null
                        ? "No completed R&amp;W attempt linked."
                        : rwScore >= 600
                          ? "Strong verbal performance — keep refining evidence and synthesis questions."
                          : rwScore >= 400
                            ? "Solid foundation — drill grammar conventions and passage evidence questions."
                            : "Focus on core grammar rules and reading for main idea before timed sets."}
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="shrink-0 font-black text-primary">•</span>
                    <span>
                      <strong>Math:</strong>{" "}
                      {mathScore == null
                        ? "No completed Math attempt linked."
                        : mathScore >= 600
                          ? "Strong math — push into harder algebra and data interpretation under time."
                          : mathScore >= 400
                            ? "Good progress — target word problems and linear systems in practice."
                            : "Rebuild fundamentals: linear equations, ratios, and basic geometry."}
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="shrink-0 font-black text-primary">•</span>
                    <span>
                      <strong>Overall:</strong>{" "}
                      {total == null
                        ? "Complete both sections to see a combined 1600-scale snapshot."
                        : total >= 1200
                          ? "Competitive range — simulate full mocks regularly to hold stamina."
                          : total >= 900
                            ? "On track — alternate missed-question review with timed sections."
                            : "Prioritize missed-question review and one full mock every few weeks."}
                    </span>
                  </li>
                </ul>
              </div>

              <div className="mt-10 flex flex-wrap gap-3 justify-center">
                {searchParams.get("rwAttempt") && (
                  <button
                    type="button"
                    onClick={() => router.push(`/review/${searchParams.get("rwAttempt")}`)}
                    className="rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-bold text-foreground hover:bg-surface-2"
                  >
                    Review Reading &amp; Writing
                  </button>
                )}
                {searchParams.get("mathAttempt") && (
                  <button
                    type="button"
                    onClick={() => router.push(`/review/${searchParams.get("mathAttempt")}`)}
                    className="rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-bold text-foreground hover:bg-surface-2"
                  >
                    Review Math
                  </button>
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </AuthGuard>
  );
}

export default function MockResultsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      }
    >
      <ResultsInner />
    </Suspense>
  );
}
