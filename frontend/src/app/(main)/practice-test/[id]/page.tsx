"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { examsStudentApi } from "@/features/examsStudent/api";
import { pastpaperPackDisplayTitle, singleDisplayTitle } from "@/lib/practiceTestCards";
import { platformSubjectIsReadingWriting } from "@/lib/permissions";
import { ArrowLeft, BookOpen, Calculator, CheckCircle2, Clock, Eye, Layers, Loader2, Play } from "lucide-react";
import { useMe } from "@/hooks/useMe";
import { useAuthCriticalGate } from "@/hooks/useAuthCriticalGate";
import { cn } from "@/lib/cn";

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
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary/40" />
      </div>
    );
  }

  if (!test) {
    return (
      <AuthGuard>
        <div className="mx-auto max-w-xl px-4 py-16 text-center">
          {fetchError ? (
            <>
              <p className="font-extrabold text-foreground mb-2">Could not load this practice test.</p>
              <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">{fetchError}</p>
            </>
          ) : (
            <p className="font-extrabold text-foreground mb-4">
              Practice test not found or not assigned to you.
            </p>
          )}
          <button
            type="button"
            className="text-sm font-bold text-primary hover:underline"
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
      <div className="mx-auto max-w-2xl px-4 py-8 lg:px-6">
        {/* Back */}
        <button
          type="button"
          onClick={() => router.push("/practice-tests")}
          className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Practice Tests
        </button>

        {/* Info note */}
        <p className="mb-8 text-sm text-muted-foreground leading-relaxed max-w-xl">
          Sectional practice — you can pause the timer. This is not the full mock; for one
          continuous SAT run with a break and no pause, use <strong className="text-foreground">Mock Exam</strong>.
        </p>

        {/* ═══ Test Card ═══════════════════════════════════════════════ */}
        <div className={cn(
          "rounded-2xl border-2 p-6 shadow-sm transition-all",
          isRW
            ? "border-primary/20 bg-card dark:border-primary/30"
            : "border-emerald-500/20 bg-card dark:border-emerald-500/30",
        )}>
          {isCompleted && (
            <span className="mb-4 inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Completed
            </span>
          )}

          {/* Test header */}
          <div className="flex items-start gap-5">
            <div className={cn(
              "shrink-0 rounded-2xl p-4 shadow-sm border",
              isRW
                ? "bg-primary/5 border-primary/10 text-primary dark:bg-primary/10"
                : "bg-emerald-50 border-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:border-emerald-900/30",
            )}>
              <Icon className="h-8 w-8" />
            </div>
            <div>
              <h2 className="text-2xl font-extrabold tracking-tight text-foreground">{label}</h2>
              <p className="mt-1 text-sm font-semibold text-muted-foreground">{cardSubtitle}</p>
              {test.label && (
                <span className="mt-2 inline-block rounded-lg bg-foreground px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-background">
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
            <div className="mt-6 rounded-2xl border border-border bg-surface-2/50 dark:bg-surface-2/30 divide-y divide-border overflow-hidden">
              {modules.map((m: any, mIdx: number) => {
                const questionCount = m.question_count ?? m.questions?.length ?? null;
                return (
                  <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                    <div className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-black",
                      isRW
                        ? "bg-primary/10 text-primary"
                        : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
                    )}>
                      {mIdx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-foreground">
                        Module {mIdx + 1}
                        {mIdx > 0 && (
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
              <div className="flex items-center gap-3 px-4 py-2.5 bg-surface-2/60 dark:bg-surface-2/20">
                <Layers className="h-4 w-4 text-muted-foreground shrink-0" />
                <p className="text-xs font-bold text-muted-foreground">
                  Modules run in sequence — the exam runner continues automatically after each module.
                </p>
              </div>
            </div>
          )}

          {/* CTA */}
          <div className="mt-6">
            {isCompleted ? (
              <button
                type="button"
                onClick={() => router.push(`/review/${attempt.id}`)}
                className="flex w-full items-center justify-center gap-3 rounded-xl border border-border bg-card py-3.5 text-sm font-extrabold text-foreground hover:bg-surface-2 transition-colors"
              >
                <Eye className="h-4 w-4" /> Review Answers
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleStart()}
                disabled={starting || !criticalAuthReady}
                className={cn(
                  "flex w-full items-center justify-center gap-3 rounded-xl py-4 text-sm font-extrabold shadow-sm disabled:opacity-50 transition-all active:scale-[0.98]",
                  isRW
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "bg-emerald-600 text-white hover:bg-emerald-700",
                )}
              >
                {starting ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <Play className="h-5 w-5 fill-current" />
                    {hasInProgressAttempt ? "Resume" : "Start Test"}
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}

export default function PracticeTestDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary/40" />
        </div>
      }
    >
      <PracticeTestDetailInner />
    </Suspense>
  );
}
