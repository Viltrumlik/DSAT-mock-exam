"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import AuthGuard from "@/components/AuthGuard";
import { examsStudentApi } from "@/features/examsStudent/api";
import { pastpaperPackDisplayTitle, singleDisplayTitle } from "@/lib/practiceTestCards";
import { platformSubjectIsReadingWriting } from "@/lib/permissions";
import { ArrowLeft, BookOpen, Calculator, Clock, Eye, FlaskConical, Layers, Play } from "lucide-react";
import { useMe } from "@/hooks/useMe";
import { useAuthCriticalGate } from "@/hooks/useAuthCriticalGate";
import { cn } from "@/lib/cn";
import { HeroPage, PageHero, Skeleton } from "@/components/ui";
// The house devices, so practice reads as part of the same product as the classroom.
import { Button, buttonClassName, Card, CardHeader, EmptyState, ErrorState, Pill } from "@/features/classroom/ui";

const examsPublicApi = examsStudentApi;

/** The way back, the same one the homework detail uses. */
function BackToPractice() {
  return (
    <Link
      href="/practice-tests"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden /> Back to practice tests
    </Link>
  );
}

function PracticeTestDetailInner() {
  const { id } = useParams();
  const testId = Number(id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [test, setTest] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [attempts, setAttempts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // A dropped connection and a test that genuinely isn't yours are different facts, and only
  // one of them is worth offering a retry for.
  const [failed, setFailed] = useState(false);
  const [starting, setStarting] = useState(false);
  const router = useRouter();
  const { isAuthenticated } = useMe();
  const { assertCriticalAuth, criticalAuthReady } = useAuthCriticalGate();

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
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
      const status = (e as { response?: { status?: number } })?.response?.status;
      setTest(null);
      setAttempts([]);
      setFailed(status !== 404 && status !== 403);
    } finally {
      setLoading(false);
    }
  }, [testId, isAuthenticated]);

  useEffect(() => { void load(); }, [load]);

  const handleStart = async () => {
    if (!assertCriticalAuth()) return;
    setStarting(true);
    try {
      const attempt = await examsPublicApi.startTest(testId);
      setAttempts((prev) => {
        const exists = prev.some((a) => a.id === attempt.id);
        return exists ? prev : [...prev, attempt];
      });
      try {
        sessionStorage.setItem(`mastersat.attempt.bootstrap.${attempt.id}`, JSON.stringify(attempt));
      } catch {}
      router.push(`/exam/${attempt.id}`);
    } catch (e) {
      console.error(e);
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <HeroPage width="narrow" className="space-y-5">
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </HeroPage>
    );
  }

  if (!test) {
    return (
      <AuthGuard>
        <HeroPage width="narrow">
          <BackToPractice />
          <Card className="cr-card mt-4">
            {failed ? (
              <ErrorState
                title="This practice test isn't loading right now."
                message="Nothing has been lost — it will be here once the connection comes back."
                onRetry={() => void load()}
              />
            ) : (
              <EmptyState
                icon={FlaskConical}
                title="Practice test not found"
                description="It may not be assigned to you."
                action={
                  <Link href="/practice-tests" className={buttonClassName({ variant: "secondary" })}>Back to practice tests</Link>
                }
              />
            )}
          </Card>
        </HeroPage>
      </AuthGuard>
    );
  }

  const isRW = platformSubjectIsReadingWriting(test.subject);
  const Icon = isRW ? BookOpen : Calculator;
  const label = isRW ? "Reading & Writing" : "Mathematics";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const modules: any[] = Array.isArray(test.modules) ? test.modules : [];
  const apiTitle = typeof test.title === "string" ? test.title.trim() : "";
  const packTitle = pastpaperPackDisplayTitle(test);
  const cardSubtitle = apiTitle || (packTitle ? `Past paper pack: ${packTitle}` : singleDisplayTitle(test));
  const attempt = attempts.filter((a) => a.practice_test === test.id).sort((a, b) => (b.id || 0) - (a.id || 0))[0];
  const isCompleted = attempt?.is_completed;
  const hasInProgressAttempt = attempt && !attempt.is_completed && !attempt.is_expired;
  const totalMinutes = modules.reduce((acc: number, m) => acc + (m.time_limit_minutes ?? 0), 0);

  return (
    <AuthGuard>
      <HeroPage width="narrow" className="space-y-5">
        <BackToPractice />

        <Card pad="none" className="cr-card overflow-hidden">
          <PageHero
            badge="Practice"
            icon={Icon}
            title={label}
            subtitle={cardSubtitle}
            tiles={[
              { label: "Form", value: test.form_type === "US" ? "US" : "International" },
              { label: "Modules", value: modules.length },
              { label: "Time", value: `${totalMinutes} min`, accent: true, icon: Clock },
            ]}
          >
            {(test.label || isCompleted || hasInProgressAttempt) && (
              <div className="mt-5 flex flex-wrap items-center gap-2">
                {test.label ? (
                  <span className="inline-flex items-center rounded-full bg-white/[0.16] px-3 py-1.5 text-xs font-bold">
                    {test.label}
                  </span>
                ) : null}
                {isCompleted ? (
                  <span className="inline-flex items-center rounded-full bg-white/[0.16] px-3 py-1.5 text-xs font-bold">
                    Completed
                  </span>
                ) : hasInProgressAttempt ? (
                  <span className="inline-flex items-center rounded-full bg-white/[0.16] px-3 py-1.5 text-xs font-bold">
                    In progress
                  </span>
                ) : null}
              </div>
            )}
          </PageHero>
        </Card>

        {/* The one thing a student has to know before starting: this is the pausable one. */}
        <Card className="cr-card">
          <p className="text-sm text-muted-foreground">
            Sectional practice — you can pause the timer. For one continuous SAT run with a
            break and no pause, use{" "}
            <Link href="/mock-exam" className="font-bold text-primary hover:underline">
              Mock exam
            </Link>
            .
          </p>
        </Card>

        {modules.length > 0 ? (
          <Card className="cr-card space-y-3">
            <CardHeader title="What you'll sit" description="Modules run in sequence" />
            <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
              {modules.map((m, mIdx) => {
                const questionCount = m.question_count ?? m.questions?.length ?? null;
                return (
                  <div
                    key={m.id}
                    style={{ animationDelay: `${Math.min(mIdx, 8) * 50}ms` }}
                    className="cr-rowin flex items-center gap-3 px-4 py-3"
                  >
                    <span
                      className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold",
                        isRW ? "bg-primary/10 text-primary" : "bg-emerald-500/10 text-emerald-600",
                      )}
                    >
                      {mIdx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-foreground">
                        Module {mIdx + 1}
                        {mIdx > 0 ? (
                          <span className="ml-2 text-[10px] font-extrabold uppercase tracking-wide text-muted-foreground">
                            Adaptive
                          </span>
                        ) : null}
                      </p>
                      {questionCount != null ? (
                        <p className="text-[12px] font-semibold text-muted-foreground">
                          <span className="ds-num">{questionCount}</span> question{questionCount !== 1 ? "s" : ""}
                        </p>
                      ) : null}
                    </div>
                    <span className="flex shrink-0 items-center gap-1 text-[12px] font-semibold text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" aria-hidden />
                      <span><span className="ds-num">{m.time_limit_minutes}</span> min</span>
                    </span>
                  </div>
                );
              })}
              <div className="flex items-center gap-3 bg-surface-2 px-4 py-2.5">
                <Layers className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <p className="text-[12px] font-semibold text-muted-foreground">
                  The runner continues automatically after each module.
                </p>
              </div>
            </div>
          </Card>
        ) : null}

        <Card className="cr-card">
          {isCompleted ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-bold text-foreground">You&apos;ve finished this one.</p>
                <Pill tone="success">Completed</Pill>
              </div>
              <Button
                block
                size="lg"
                variant="secondary"
                className="cr-press"
                icon={Eye}
                onClick={() => router.push(`/review/${attempt.id}`)}
              >
                Review answers
              </Button>
            </div>
          ) : (
            <Button
              block
              size="lg"
              className="cr-press"
              loading={starting}
              disabled={!criticalAuthReady}
              icon={Play}
              onClick={() => void handleStart()}
            >
              {hasInProgressAttempt ? "Resume" : "Start test"}
            </Button>
          )}
        </Card>
      </HeroPage>
    </AuthGuard>
  );
}

export default function PracticeTestDetailPage() {
  return (
    <Suspense
      fallback={
        <HeroPage width="narrow" className="space-y-5">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </HeroPage>
      }
    >
      <PracticeTestDetailInner />
    </Suspense>
  );
}
