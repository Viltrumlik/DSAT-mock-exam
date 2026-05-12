"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { examsStudentApi } from "@/features/examsStudent/api";
import { pastpaperPackDisplayTitle, singleDisplayTitle } from "@/lib/practiceTestCards";
import { platformSubjectIsReadingWriting } from "@/lib/permissions";
import { BookOpen, Calculator, CheckCircle2, ArrowLeft, Play, Eye, Clock, Layers } from "lucide-react";
import { useMe } from "@/hooks/useMe";
import { useAuthCriticalGate } from "@/hooks/useAuthCriticalGate";

const examsPublicApi = examsStudentApi;

function PracticeTestDetailInner() {
  const { id } = useParams();
  const testId = Number(id);
  const [test, setTest] = useState<any>(null);
  const [attempts, setAttempts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const router = useRouter();
  const { isAuthenticated } = useMe();
  const { assertCriticalAuth, criticalAuthReady } = useAuthCriticalGate();

  useEffect(() => {
    const run = async () => {
      try {
        setFetchError(null);
        const data = await examsPublicApi.getPracticeTest(testId);
        setTest(data && typeof data === "object" ? data : null);
        if (isAuthenticated) {
          const attemptsData = await examsPublicApi.getAttempts();
          setAttempts(attemptsData.items);
        } else {
          setAttempts([]);
        }
      } catch (e) {
        console.error("[practice-test detail] load failed", { testId, err: e });
        const message = e instanceof Error ? e.message : "Request failed.";
        setFetchError(message);
        setTest(null);
        setAttempts([]);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [testId, isAuthenticated]);

  const handleStart = async () => {
    if (!assertCriticalAuth()) return;
    setStarting(true);
    try {
      let attempt = attempts.find(
        (a) => a.practice_test === testId && !a.is_expired && !a.is_completed,
      );
      if (!attempt) {
        attempt = await examsPublicApi.startTest(testId);
        setAttempts((prev) => [...prev, attempt]);
      }
      try {
        sessionStorage.setItem(
          `mastersat.attempt.bootstrap.${attempt.id}`,
          JSON.stringify(attempt),
        );
      } catch {}
      router.push(`/exam/${attempt.id}`);
    } catch (e) {
      console.error(e);
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!test) {
    return (
      <AuthGuard>
        <div className="min-h-screen flex flex-col items-center justify-center px-6">
          {fetchError ? (
            <>
              <p className="text-slate-800 dark:text-slate-200 font-bold mb-2">
                Could not load this practice test.
              </p>
              <p className="text-slate-600 dark:text-slate-400 text-sm text-center max-w-md mb-4">
                {fetchError}
              </p>
            </>
          ) : (
            <p className="text-slate-600 font-bold mb-4">
              Practice test not found or not assigned to you.
            </p>
          )}
          <button
            type="button"
            className="text-emerald-600 font-bold"
            onClick={() => router.push("/practice-tests")}
          >
            Back to practice tests
          </button>
        </div>
      </AuthGuard>
    );
  }

  const isRW = platformSubjectIsReadingWriting(test.subject);
  const Icon = isRW ? BookOpen : Calculator;
  const label = isRW ? "Reading & Writing" : "Mathematics";
  const modules: any[] = Array.isArray(test.modules) ? test.modules : [];
  const apiTitle = typeof test.title === "string" ? test.title.trim() : "";
  const packTitle = pastpaperPackDisplayTitle(test);
  const cardSubtitle =
    apiTitle || (packTitle ? `Past paper pack: ${packTitle}` : singleDisplayTitle(test));
  const attempt = attempts
    .filter((a) => a.practice_test === test.id)
    .sort((a, b) => (b.id || 0) - (a.id || 0))[0];
  const isCompleted = attempt?.is_completed;
  const hasInProgressAttempt =
    attempt && !attempt.is_completed && !attempt.is_expired;
  const totalMinutes = modules.reduce((acc: number, m: any) => acc + (m.time_limit_minutes ?? 0), 0);

  return (
    <AuthGuard>
      <div className="min-h-screen bg-[#f8f9fb] dark:bg-slate-950">
        <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-50">
          <div className="max-w-5xl mx-auto px-6 h-16 flex items-center">
            <button
              type="button"
              onClick={() => router.push("/practice-tests")}
              className="flex items-center gap-2 text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 font-bold transition-colors"
            >
              <ArrowLeft className="w-5 h-5" /> Back
            </button>
          </div>
        </header>

        <main className="max-w-5xl mx-auto px-6 py-12">
          <p className="text-slate-500 dark:text-slate-400 mb-8 max-w-2xl text-sm">
            Sectional practice — you can pause the timer. This is not the full mock; for one
            continuous SAT run with a break and no pause, use <strong>Mock Exam</strong>.
          </p>

          <div className="max-w-xl">
            <div
              className={`p-6 rounded-[32px] border-2 transition-all duration-500 ${
                isRW
                  ? "border-primary/15 bg-card dark:border-primary/25"
                  : "border-emerald-500/20 bg-card dark:border-emerald-500/25"
              } shadow-sm flex flex-col gap-6`}
            >
              {isCompleted && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500 text-white rounded-xl w-fit text-[9px] font-black uppercase tracking-widest">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Completed
                </div>
              )}

              {/* Test header */}
              <div className="flex items-start gap-5">
                <div
                  className={`p-5 rounded-[24px] shrink-0 bg-white dark:bg-slate-800 shadow-md border border-slate-100 dark:border-slate-700 ${
                    isRW ? "text-blue-600" : "text-emerald-600"
                  }`}
                >
                  <Icon className="w-9 h-9" />
                </div>
                <div>
                  <h2 className="text-2xl font-black text-foreground">{label}</h2>
                  <p className="mt-1 text-sm font-semibold text-muted-foreground">{cardSubtitle}</p>
                  {test.label && (
                    <span className="mt-2 inline-block rounded-lg bg-foreground px-2 py-1 text-[9px] font-black uppercase text-background">
                      {test.label}
                    </span>
                  )}
                  <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {test.form_type === "US" ? "US Form" : "International"} ·{" "}
                    {modules.length} module{modules.length !== 1 ? "s" : ""} · {totalMinutes} min
                  </p>
                </div>
              </div>

              {/* Module breakdown */}
              {modules.length > 0 && (
                <div className="rounded-2xl border border-border bg-surface-2 dark:bg-slate-800/50 divide-y divide-border overflow-hidden">
                  {modules.map((m: any, idx: number) => {
                    const questionCount =
                      m.question_count ?? m.questions?.length ?? null;
                    return (
                      <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                        <div
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-black ${
                            isRW
                              ? "bg-primary/10 text-primary"
                              : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                          }`}
                        >
                          {idx + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-foreground">
                            Module {idx + 1}
                            {idx > 0 && (
                              <span className="ml-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                                Adaptive
                              </span>
                            )}
                          </p>
                          {questionCount != null && (
                            <p className="text-xs text-muted-foreground">
                              {questionCount} question{questionCount !== 1 ? "s" : ""}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 text-xs font-semibold text-muted-foreground shrink-0">
                          <Clock className="h-3.5 w-3.5" />
                          {m.time_limit_minutes} min
                        </div>
                      </div>
                    );
                  })}
                  <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/30">
                    <Layers className="h-4 w-4 text-muted-foreground shrink-0" />
                    <p className="text-xs font-bold text-muted-foreground">
                      Modules run in sequence — the exam runner continues automatically after each module.
                    </p>
                  </div>
                </div>
              )}

              {/* CTA */}
              <div className="mt-auto">
                {isCompleted ? (
                  <button
                    type="button"
                    onClick={() => router.push(`/review/${attempt.id}`)}
                    className="flex w-full items-center justify-center gap-3 rounded-[18px] bg-foreground py-4 text-[10px] font-black uppercase tracking-widest text-background hover:opacity-90"
                  >
                    <Eye className="w-4 h-4" /> Review answers
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleStart()}
                    disabled={starting || !criticalAuthReady}
                    className={`flex w-full items-center justify-center gap-4 rounded-[18px] py-5 text-xs font-black uppercase tracking-widest shadow-xl disabled:opacity-50 transition-opacity ${
                      isRW
                        ? "ms-cta-fill text-white"
                        : "bg-emerald-600 text-white hover:bg-emerald-700"
                    }`}
                  >
                    {starting ? (
                      <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>
                        <Play className="w-5 h-5 fill-current" />
                        {hasInProgressAttempt ? "Resume" : "Start test"}
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    </AuthGuard>
  );
}

export default function PracticeTestDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#f8f9fb]">
          <div className="w-12 h-12 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <PracticeTestDetailInner />
    </Suspense>
  );
}
