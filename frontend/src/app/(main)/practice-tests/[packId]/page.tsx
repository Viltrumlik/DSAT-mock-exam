"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { examsStudentApi } from "@/features/examsStudent/api";
import { useAuthCriticalGate } from "@/hooks/useAuthCriticalGate";
import { ArrowLeft, BookOpen, Calculator, FlaskConical } from "lucide-react";
import { HeroPage, PageHero, Skeleton } from "@/components/ui";
// The house devices, so practice reads as part of the same product as the classroom.
import { Button, buttonClassName, Card, EmptyState, ErrorState, Pill } from "@/features/classroom/ui";
import { cn } from "@/lib/cn";

type PackSection = {
  id: number;
  title: string;
  subject: string;
  module_count: number;
};

type Pack = {
  id: number;
  title: string;
  description: string;
  sections: PackSection[];
};

type AttemptRow = {
  id: number;
  practice_test: number;
  is_completed: boolean;
  is_expired: boolean;
  score?: number | null;
};

function isRWSubject(s: string): boolean {
  return s === "READING_WRITING";
}

function subjectLabel(s: string): string {
  if (s === "READING_WRITING") return "Reading & Writing";
  if (s === "MATH") return "Mathematics";
  return s;
}

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

export default function PracticeTestPackDetailPage() {
  const params = useParams();
  const router = useRouter();
  const packId = Number(Array.isArray(params.packId) ? params.packId[0] : params.packId);
  const { assertCriticalAuth } = useAuthCriticalGate();

  const [pack, setPack] = useState<Pack | null>(null);
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState<number | null>(null);
  // A dropped connection and a pack that is genuinely gone are different facts, and only one
  // of them is worth offering a retry for. They used to share one `error` string.
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isFinite(packId) || packId <= 0) return;
    setLoading(true);
    setFailed(false);
    try {
      const [packData, attemptsData] = await Promise.all([
        examsStudentApi.getPracticeTestPackStudent(packId),
        examsStudentApi.getAttempts().catch(() => []),
      ]);
      setPack(packData as Pack);
      const ad = attemptsData as unknown;
      const raw = Array.isArray(ad) ? ad
        : Array.isArray((ad as { results?: unknown[] })?.results) ? (ad as { results: AttemptRow[] }).results
        : [];
      setAttempts(raw as AttemptRow[]);
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      // 404/403 means the pack really is unpublished or not yours; anything else is the
      // request failing, and claiming "not found" there states something we do not know.
      setPack(null);
      setFailed(status !== 404 && status !== 403);
    } finally {
      setLoading(false);
    }
  }, [packId]);

  useEffect(() => { void load(); }, [load]);

  const handleStart = async (sectionId: number) => {
    if (!assertCriticalAuth()) return;
    setStarting(sectionId);
    try {
      let attempt = attempts.find(
        (a) => a.practice_test === sectionId && !a.is_completed && !a.is_expired,
      );
      if (!attempt) {
        attempt = (await examsStudentApi.startTest(sectionId)) as AttemptRow;
        setAttempts((prev) => [...prev, attempt!]);
      }
      try {
        sessionStorage.setItem(`mastersat.attempt.bootstrap.${attempt.id}`, JSON.stringify(attempt));
      } catch {}
      router.push(`/exam/${attempt.id}`);
    } catch (e) {
      console.error("[practice-test] start section failed", e);
      setStarting(null);
    }
  };

  if (loading) {
    return (
      <HeroPage width="narrow" className="space-y-5">
        <Skeleton className="h-40 rounded-2xl" />
        {[0, 1].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
      </HeroPage>
    );
  }

  if (!pack) {
    return (
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
              description="It may have been unpublished."
              action={
                <Link href="/practice-tests" className={buttonClassName({ variant: "secondary" })}>Back to practice tests</Link>
              }
            />
          )}
        </Card>
      </HeroPage>
    );
  }

  const sorted = [...pack.sections].sort((a, b) =>
    (isRWSubject(a.subject) ? 0 : 1) - (isRWSubject(b.subject) ? 0 : 1)
  );
  const done = sorted.filter((s) =>
    attempts.some((a) => a.practice_test === s.id && a.is_completed),
  ).length;

  return (
    <HeroPage width="narrow" className="space-y-5">
      <BackToPractice />

      <Card pad="none" className="cr-card overflow-hidden">
        <PageHero
          badge="Practice"
          title={pack.title || `Practice test #${pack.id}`}
          // The pack's own blurb and the house instruction are two different things. Folding
          // them into one `description` made the instruction — the only line telling a student
          // this is the untimed, any-order one — vanish for every pack a teacher described.
          description={pack.description || undefined}
          tiles={[
            { label: "Sections", value: sorted.length },
            ...(sorted.length > 0
              ? [{ label: "Finished", value: `${done} of ${sorted.length}`, accent: true as const }]
              : []),
          ]}
        >
          <p className="mt-5 text-[14px] font-medium opacity-[0.86]">
            Start any section in any order — no time limit between sections.
          </p>
        </PageHero>
      </Card>

      {sorted.length === 0 ? (
        <Card className="cr-card">
          <EmptyState
            icon={FlaskConical}
            title="No sections yet"
            description="Sections appear here once added."
          />
        </Card>
      ) : (
        sorted.map((section, i) => {
          const rw = isRWSubject(section.subject);
          const Icon = rw ? BookOpen : Calculator;
          const sectionAttempts = attempts.filter((a) => a.practice_test === section.id).sort((a, b) => b.id - a.id);
          const completedAttempt = sectionAttempts.find((a) => a.is_completed);
          const activeAttempt = sectionAttempts.find((a) => !a.is_completed && !a.is_expired);
          const isCompleted = !!completedAttempt;
          const isStarting = starting === section.id;
          const label = isCompleted ? "Retake" : activeAttempt ? "Resume" : "Start";

          return (
            <Card
              key={section.id}
              className="cr-card cr-lift flex flex-col gap-4"
              style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}
            >
              <div className="flex items-start gap-4">
                <span
                  className={cn(
                    "cr-iconpop flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl transition-transform",
                    rw ? "bg-primary/10 text-primary" : "bg-emerald-500/10 text-emerald-600",
                  )}
                >
                  <Icon className="h-6 w-6" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[16px] font-extrabold text-foreground">
                    {subjectLabel(section.subject)}
                  </h3>
                  <p className="mt-0.5 text-[12px] font-semibold text-muted-foreground">
                    <span className="ds-num">{section.module_count}</span> module{section.module_count !== 1 ? "s" : ""}
                  </p>
                  {isCompleted ? (
                    <span className="mt-1.5 inline-block">
                      <Pill tone="success">
                        Completed{completedAttempt?.score != null ? ` · ${completedAttempt.score}` : ""}
                      </Pill>
                    </span>
                  ) : activeAttempt ? (
                    <span className="mt-1.5 inline-block"><Pill tone="warning">In progress</Pill></span>
                  ) : null}
                </div>
              </div>
              <Button
                block
                className="cr-press"
                variant={isCompleted ? "secondary" : "primary"}
                loading={isStarting}
                onClick={() => handleStart(section.id)}
              >
                {label}
              </Button>
            </Card>
          );
        })
      )}
    </HeroPage>
  );
}
