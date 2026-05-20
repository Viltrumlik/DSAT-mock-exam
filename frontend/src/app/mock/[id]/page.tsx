"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { examsPublicApi } from "@/lib/api";
import { coalesceArray, platformSubjectIsMath, platformSubjectIsReadingWriting } from "@/lib/permissions";
import { BookOpen, Calculator, CheckCircle2, ArrowLeft, Play, Eye, Trophy } from "lucide-react";
import { useMe } from "@/hooks/useMe";
import { useAuthCriticalGate } from "@/hooks/useAuthCriticalGate";


function MockExamDetailInner() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const midtermQuery = searchParams.get("midterm") === "1";
  const mockIdStr = String(id);
  const [mockExam, setMockExam] = useState<any>(null);
  const [attempts, setAttempts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [startingModuleId, setStartingModuleId] = useState<number | null>(null);
  const [showReadyOverlay, setShowReadyOverlay] = useState(false);
  const router = useRouter();
  const { isAuthenticated } = useMe();
  const { assertCriticalAuth, criticalAuthReady } = useAuthCriticalGate();
  const isLoggedInProbe = isAuthenticated;

  const examIsMidterm = midtermQuery || mockExam?.kind === "MIDTERM";

  useEffect(() => {
    const fetchData = async () => {
      try {
        const examData = await examsPublicApi.getMockExam(Number(id));
        setMockExam(examData);
        if (isLoggedInProbe) {
          const attemptsData = await examsPublicApi.getAttempts();
          setAttempts(attemptsData.items);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    void fetchData();
  }, [id, isLoggedInProbe]);

  // Sentinel error type for server-enforced break.
  class BreakRequiredError extends Error {
    breakEndsAt: string;
    constructor(breakEndsAt: string) {
      super("break_required");
      this.breakEndsAt = breakEndsAt;
    }
  }

  const getOrCreateAttempt = async (testId: number) => {
    let attempt = attempts.find((a) => a.practice_test === testId && !a.is_expired && !a.is_completed);
    if (!attempt) {
      if (!assertCriticalAuth()) {
        throw new Error("AUTH_ACTION_BLOCKED");
      }
      try {
        attempt = await examsPublicApi.startTest(testId);
      } catch (e: unknown) {
        // Server-enforced break: backend rejects Math start until break elapses.
        const resp = (e as { response?: { data?: { code?: string; break_ends_at?: string } } })?.response;
        if (resp?.data?.code === "break_required" && resp.data.break_ends_at) {
          throw new BreakRequiredError(resp.data.break_ends_at);
        }
        throw e;
      }
      setAttempts([...attempts, attempt]);
    }
    return attempt;
  };

  const handleStartModule = async (testId: number, moduleId: number, querySuffix = "") => {
    if (!assertCriticalAuth()) {
      return;
    }
    setStartingModuleId(moduleId);
    try {
      const attempt = await getOrCreateAttempt(testId);
      // Speed: bootstrap initial attempt payload to exam runner (avoids an extra blank wait).
      try {
        sessionStorage.setItem(`mastersat.attempt.bootstrap.${attempt.id}`, JSON.stringify(attempt));
      } catch {}
      router.push(`/exam/${attempt.id}${querySuffix}`);
    } catch (e) {
      if (e instanceof BreakRequiredError) {
        // Server says break hasn't elapsed — redirect to break page with server timestamp.
        router.push(
          `/mock/${mockIdStr}/break?rwAttempt=${rwAttempt?.id ?? ""}&breakEndsAt=${encodeURIComponent(e.breakEndsAt)}`
        );
        return;
      }
      console.error("Failed to start module", e);
      setStartingModuleId(null);
    }
  };

  const backHref = examIsMidterm ? "/midterm" : "/mock-exam";

  const { rwTest, mathTest, rwAttempt, mathAttempt, rwDone, mathDone, breakDone } = useMemo(() => {
    const tests = coalesceArray(mockExam?.tests);
    const rw = tests.find((t: any) => platformSubjectIsReadingWriting(t.subject));
    const mt = tests.find((t: any) => platformSubjectIsMath(t.subject));
    const latest = (testId: number) =>
      attempts
        .filter((a) => a.practice_test === testId)
        .sort((a, b) => (b.id || 0) - (a.id || 0))[0];
    const rwa = rw ? latest(rw.id) : null;
    const ma = mt ? latest(mt.id) : null;
    let bd = false;
    try {
      if (typeof window !== "undefined" && rwa?.is_completed && rwa?.id) {
        bd =
          localStorage.getItem(`mastersat_mock_${mockIdStr}_break_done`) === "1" &&
          localStorage.getItem(`mastersat_mock_${mockIdStr}_break_after_rw`) === String(rwa.id);
      }
    } catch {
      bd = false;
    }
    return {
      rwTest: rw,
      mathTest: mt,
      rwAttempt: rwa,
      mathAttempt: ma,
      rwDone: !!rwa?.is_completed,
      mathDone: !!ma?.is_completed,
      breakDone: bd,
    };
  }, [mockExam, attempts, mockIdStr]);

  const startFullMockRw = async () => {
    const mods = [...(rwTest?.modules || [])].sort(
      (a: any, b: any) => (a.module_order ?? 0) - (b.module_order ?? 0)
    );
    const m0 = mods[0];
    if (!rwTest?.id || !m0?.id) return;
    const q = `?mockFlow=1&mockExamId=${mockIdStr}`;
    await handleStartModule(rwTest.id, m0.id, q);
  };

  const confirmReadyAndStart = () => {
    setShowReadyOverlay(false);
    try {
      const el = document.documentElement;
      if (typeof el.requestFullscreen === "function") {
        void el.requestFullscreen();
      }
    } catch {
      /* optional fullscreen */
    }
    if (examIsMidterm) {
      const t = (mockExam?.tests || [])[0];
      const mods = [...(t?.modules || [])].sort(
        (a: any, b: any) => (a.module_order ?? 0) - (b.module_order ?? 0)
      );
      if (t?.id && mods[0]?.id) void handleStartModule(t.id, mods[0].id, "?midterm=1");
    } else {
      void startFullMockRw();
    }
  };

  const midtermTest = (mockExam?.tests || [])[0];
  const midtermAttempt = midtermTest
    ? attempts
        .filter((a) => a.practice_test === midtermTest.id)
        .sort((a, b) => (b.id || 0) - (a.id || 0))[0]
    : null;
  const midtermDone = !!midtermAttempt?.is_completed;

  const startMathAfterBreak = async () => {
    if (!mathTest?.modules?.[0]?.id || !rwAttempt?.id) return;
    const q = `?mockFlow=1&mockExamId=${mockIdStr}&rwAttempt=${rwAttempt.id}`;
    await handleStartModule(mathTest.id, mathTest.modules[0].id, q);
  };

  const renderTestCard = (test: any) => {
    if (!test) return null;
    const isRW = platformSubjectIsReadingWriting(test.subject);
    const Icon = isRW ? BookOpen : Calculator;
    const label = isRW ? "Reading & Writing" : "Mathematics";
    const modules = test.modules || [];
    const attempt = attempts
      .filter((a) => a.practice_test === test.id)
      .sort((a, b) => (b.id || 0) - (a.id || 0))[0];
    const isCompleted = attempt?.is_completed;

    return (
      <div
        key={test.id}
        className={`group relative flex flex-col gap-6 overflow-hidden rounded-[32px] border-2 p-6 shadow-sm transition-all duration-500 hover:shadow-2xl hover:shadow-primary/10 ${
          isRW
            ? "border-primary/15 bg-card hover:border-primary/35"
            : "border-emerald-500/20 bg-card hover:border-emerald-500/45"
        }`}
      >
        {isCompleted && (
          <div className="absolute top-5 right-5 flex items-center gap-2 px-3 py-1.5 bg-[#10b981] text-white rounded-xl shadow-lg shadow-emerald-100/50 z-20">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span className="text-[9px] font-black uppercase tracking-widest whitespace-nowrap">Completed</span>
          </div>
        )}

        <div className="flex items-start gap-5">
          <div
            className={`shrink-0 rounded-[24px] border border-border bg-card p-5 shadow-sm transition-all duration-500 group-hover:-translate-y-1 group-hover:shadow-xl ${
              isRW ? "text-primary" : "text-emerald-600"
            } relative`}
          >
            <Icon className="w-9 h-9 relative z-10" />
          </div>

          <div className="flex flex-col gap-2.5 pt-1 min-w-0 pr-10">
            <h3 className="break-words text-2xl font-black leading-none tracking-tight text-foreground">{label}</h3>
            {test.label && (
              <span className="w-fit rounded-lg bg-foreground px-2 py-1 text-[9px] font-black uppercase tracking-widest text-background">
                {test.label}
              </span>
            )}
            <div className="text-[10px] font-bold uppercase tracking-widest text-label-foreground">
              {modules.length} Modules • {modules.reduce((acc: number, m: any) => acc + m.time_limit_minutes, 0)}m
            </div>
          </div>
        </div>

        <div className="mt-auto">
          {isCompleted ? (
            <button
              type="button"
              onClick={() => router.push(`/review/${attempt.id}`)}
              className="flex w-full items-center justify-center gap-3 rounded-[18px] bg-foreground py-4 text-[10px] font-black uppercase tracking-widest text-background shadow-xl transition-all duration-300 hover:opacity-90 active:scale-[0.98]"
            >
              <Eye className="w-4 h-4" /> REVIEW
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleStartModule(test.id, modules[0]?.id, "?midterm=1")}
              disabled={startingModuleId !== null || !criticalAuthReady}
              className={`ms-btn-primary flex w-full items-center justify-center gap-4 rounded-[18px] py-5 font-black transition-all duration-300 shadow-xl active:scale-[0.98] ${
                isRW ? "ms-cta-fill text-white" : "bg-emerald-600 text-white shadow-emerald-200 hover:bg-emerald-700"
              }`}
            >
              {startingModuleId === modules[0]?.id ? (
                <div className="w-6 h-6 border-3 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                    <Play className="w-4 h-4 fill-current ml-0.5" />
                  </div>
                  <span className="text-xs tracking-[0.1em]">{attempt ? "RESUME" : "START"}</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    );
  };

  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );

  return (
    <AuthGuard>
      <div className="min-h-screen bg-background">
        {showReadyOverlay && (
          <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-slate-950 text-white p-8">
            <p className="mb-4 text-[10px] font-black uppercase tracking-[0.3em] text-accent-cyan">Mock exam</p>
            <h2 className="text-3xl md:text-4xl font-black text-center mb-4 tracking-tight">Are you ready?</h2>
            <p className="text-slate-400 text-center max-w-md mb-10 font-medium leading-relaxed">
              {examIsMidterm
                ? "You will enter full screen for your midterm. The timer runs continuously; pause is not available where applicable."
                : "Reading & Writing runs first, then a required 10-minute break, then Math. No pause during the mock. Make sure you have a stable connection."}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 w-full max-w-sm">
              <button
                type="button"
                onClick={() => setShowReadyOverlay(false)}
                className="flex-1 py-4 rounded-2xl border-2 border-slate-600 font-black text-sm uppercase tracking-widest hover:bg-slate-900"
              >
                Not yet
              </button>
              <button
                type="button"
                onClick={() => confirmReadyAndStart()}
                disabled={startingModuleId !== null || !criticalAuthReady}
                className="ms-btn-primary ms-cta-fill flex-1 rounded-2xl py-4 text-sm font-black uppercase tracking-widest disabled:opacity-50"
              >
                Yes, start
              </button>
            </div>
          </div>
        )}
        <header className="sticky top-0 z-50 border-b border-border bg-card">
          <div className="mx-auto flex h-20 max-w-5xl items-center justify-between px-6">
            <button
              type="button"
              onClick={() => router.push(backHref)}
              className="flex items-center gap-2 font-bold text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="w-5 h-5" /> Back
            </button>
            <div className="text-right">
              <h1 className="text-xl font-black tracking-tight text-foreground">{mockExam?.title}</h1>
              <p className="text-[11px] font-black uppercase tracking-widest text-label-foreground">
                {examIsMidterm ? "Midterm" : "Full mock SAT"}
              </p>
            </div>
          </div>
        </header>

        <main className="max-w-5xl mx-auto px-6 py-12">
          {!examIsMidterm && rwTest && mathTest ? (
            <div className="space-y-8">
              <div>
                <h2 className="mb-4 text-4xl font-black tracking-tight text-foreground">Full mock exam</h2>
                <p className="max-w-2xl text-lg font-medium text-muted-foreground">
                  This is the <strong>one full mock</strong> (not separate sectional runs). Reading &amp; Writing first, then a
                  required 10-minute break, then Math—no pause. Total score out of 1600. To practice R&amp;W or Math alone with
                  pause, use <strong>Practice Tests</strong>.
                </p>
              </div>

              {mathDone ? (
                <div className="rounded-3xl border border-border bg-card p-10 text-center shadow-sm">
                  <Trophy className="mx-auto mb-4 h-14 w-14 text-primary" />
                  <h3 className="mb-2 text-2xl font-black text-foreground">Mock complete</h3>
                  <p className="mb-8 text-muted-foreground">View your combined Reading &amp; Writing and Math scores.</p>
                  <button
                    type="button"
                    onClick={() =>
                      router.push(
                        `/mock/${mockIdStr}/results?rwAttempt=${rwAttempt?.id || ""}&mathAttempt=${mathAttempt?.id || ""}`
                      )
                    }
                    className="ms-btn-primary ms-cta-fill inline-flex items-center justify-center gap-2 rounded-2xl px-8 py-4 text-sm font-black uppercase tracking-widest"
                  >
                    See results (1600 scale)
                  </button>
                </div>
              ) : !rwDone ? (
                <div className="rounded-3xl border-2 border-primary/20 bg-card p-10 shadow-sm">
                  <h3 className="mb-2 text-2xl font-black text-foreground">Full mock exam</h3>
                  <p className="mb-8 max-w-2xl font-medium text-muted-foreground">
                    One continuous run: English (both modules) → 10-minute break → Math (both modules). No pause. When you are
                    ready, you will see a full-screen confirmation before the timer starts.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (rwAttempt) void startFullMockRw();
                      else setShowReadyOverlay(true);
                    }}
                    disabled={startingModuleId !== null || !criticalAuthReady}
                    className="ms-btn-primary ms-cta-fill inline-flex items-center justify-center gap-3 rounded-2xl px-10 py-5 text-xs font-black uppercase tracking-widest shadow-xl disabled:opacity-60"
                  >
                    {startingModuleId !== null ? (
                      <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>
                        <Play className="w-5 h-5 fill-current" />
                        {rwAttempt ? "Resume mock exam" : "Start mock exam"}
                      </>
                    )}
                  </button>
                </div>
              ) : rwDone && !breakDone ? (
                <div className="bg-amber-50 border-2 border-amber-200 rounded-3xl p-10 text-center">
                  <h3 className="text-xl font-black text-slate-900 mb-2">10-minute break</h3>
                  <p className="text-slate-600 mb-6">
                    Before Math, complete the scheduled break. You will not be able to skip the timer.
                  </p>
                  <button
                    type="button"
                    onClick={() => router.push(`/mock/${mockIdStr}/break?rwAttempt=${rwAttempt?.id || ""}`)}
                    className="inline-flex items-center justify-center bg-amber-500 hover:bg-amber-600 text-white font-black px-8 py-4 rounded-2xl text-sm uppercase tracking-widest"
                  >
                    Start break
                  </button>
                </div>
              ) : (
                <div className="rounded-3xl border-2 border-emerald-200/60 bg-card p-10 shadow-sm dark:border-emerald-500/25">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                    <div>
                      <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-2">Step 2</p>
                      <h3 className="text-2xl font-black text-foreground">Mathematics</h3>
                      <p className="mt-2 text-muted-foreground">
                        Opens automatically when the break timer ends. Use the button only if it did not open. Pause is not
                        available.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => startMathAfterBreak()}
                      disabled={startingModuleId !== null || !criticalAuthReady}
                      className="shrink-0 flex items-center justify-center gap-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black px-10 py-5 rounded-2xl text-xs uppercase tracking-widest shadow-lg disabled:opacity-60"
                    >
                      {startingModuleId !== null ? (
                        <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <>
                          <Play className="w-5 h-5 fill-current" />
                          {mathAttempt && !mathDone ? "Resume Math" : "Start Math"}
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="mb-12">
                <h2 className="mb-4 text-4xl font-black tracking-tight text-foreground">Midterm</h2>
                <p className="max-w-2xl text-lg font-medium text-muted-foreground">
                  Calculator and reference sheet are hidden. Start from the button below; confirm on the full-screen prompt.
                </p>
                {midtermTest && !midtermDone ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (midtermAttempt?.started_at && !midtermAttempt?.is_completed) {
                        router.push(`/exam/${midtermAttempt.id}?midterm=1`);
                      } else if (!midtermAttempt) {
                        setShowReadyOverlay(true);
                      }
                    }}
                    disabled={startingModuleId !== null || !criticalAuthReady}
                    className="ms-btn-primary ms-cta-fill mt-6 inline-flex items-center gap-3 rounded-2xl px-8 py-4 text-xs font-black uppercase tracking-widest disabled:opacity-60"
                  >
                    <Play className="w-5 h-5 fill-current" />
                    {midtermAttempt?.started_at && !midtermAttempt?.is_completed ? "Resume midterm" : "Start midterm exam"}
                  </button>
                ) : null}
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {coalesceArray(mockExam?.tests)
                  .slice()
                  .sort(
                    (a: any, b: any) =>
                      (platformSubjectIsReadingWriting(a.subject) ? 0 : 1) -
                      (platformSubjectIsReadingWriting(b.subject) ? 0 : 1),
                  )
                  .map((test: any) => renderTestCard(test))}
                {(!mockExam?.tests || mockExam.tests.length === 0) && (
                  <div className="col-span-full flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-border bg-card py-20">
                    <p className="font-bold text-muted-foreground">No sections available yet.</p>
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </AuthGuard>
  );
}

export default function MockExamDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      }
    >
      <MockExamDetailInner />
    </Suspense>
  );
}
