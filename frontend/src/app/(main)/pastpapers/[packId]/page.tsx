"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { examsPublicApi, type PastpaperPackPublic, type PastpaperPackSection } from "@/lib/api";
import { examsStudentApi } from "@/features/examsStudent/api";
import { useMe } from "@/hooks/useMe";
import { useAuthCriticalGate } from "@/hooks/useAuthCriticalGate";
import { ArrowLeft, BookOpen, Calculator, Calendar, Eye, Play, Trophy } from "lucide-react";
import { cn } from "@/lib/cn";
import { Card, CardContent, Badge, Button, EmptyState, Spinner } from "@/components/ui";

// ─── helpers (preserved) ─────────────────────────────────────────────────────

function formatDate(s: string | null): string {
  if (!s) return "Undated";
  try {
    return new Date(s).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  } catch {
    return s;
  }
}

function isRWSubject(subject: string): boolean {
  return subject === "READING_WRITING" || subject?.toLowerCase().includes("reading");
}

function subjectLabel(subject: string): string {
  if (isRWSubject(subject)) return "Reading & Writing";
  if (subject === "MATH" || subject?.toLowerCase().includes("math")) return "Mathematics";
  return subject;
}

function totalMinutes(section: PastpaperPackSection): number {
  if (isRWSubject(section.subject)) return section.module_count * 32;
  return section.module_count * 35;
}

type AttemptRow = { id: number; practice_test: number; is_completed: boolean; is_expired: boolean; score?: number | null };

// ─── section card ─────────────────────────────────────────────────────────────

function SectionCard({
  section, attempts, onStart, starting, startError, locked, lockReason,
}: {
  section: PastpaperPackSection;
  attempts: AttemptRow[];
  onStart: (sectionId: number) => void;
  starting: number | null;
  startError?: string | null;
  locked?: boolean;
  lockReason?: string;
}) {
  const rw = isRWSubject(section.subject);
  const Icon = rw ? BookOpen : Calculator;
  const sectionAttempts = attempts.filter((a) => a.practice_test === section.id).sort((a, b) => b.id - a.id);
  const activeAttempt = sectionAttempts.find((a) => !a.is_completed && !a.is_expired);
  const completedAttempt = sectionAttempts.find((a) => a.is_completed);
  const isCompleted = !!completedAttempt;
  const isLoading = starting === section.id;

  return (
    <Card className={locked ? "opacity-60" : undefined}>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-start gap-4">
          <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl", rw ? "bg-info-soft text-info-foreground" : "bg-success-soft text-success-foreground")}>
            <Icon className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="ds-h4">{subjectLabel(section.subject)}</h3>
              {isCompleted ? <Badge variant="success">Done</Badge> : null}
              {activeAttempt && !isCompleted ? <Badge variant="warning">In progress</Badge> : null}
              {locked ? <Badge variant="neutral">Locked</Badge> : null}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {section.module_count} module{section.module_count !== 1 ? "s" : ""} · {totalMinutes(section)} min{section.form_type === "US" ? " · US form" : " · International"}
            </p>
            {isCompleted && completedAttempt?.score != null ? (
              <p className="mt-1 text-xs font-bold text-foreground">Score: <span className="text-primary">{completedAttempt.score}</span><span className="font-normal text-muted-foreground"> / 800</span></p>
            ) : null}
            {locked && lockReason ? <p className="mt-1 text-xs text-muted-foreground">{lockReason}</p> : null}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {startError ? <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs font-semibold text-danger-foreground">{startError}</p> : null}
          {isCompleted ? (
            <div className="flex gap-2">
              <Link href={`/review/${completedAttempt!.id}`} className="flex-1"><Button variant="secondary" fullWidth leftIcon={<Eye />}>Review answers</Button></Link>
              <Button variant={rw ? "primary" : "primary"} loading={isLoading} disabled={locked} leftIcon={<Play className="fill-current" />} onClick={() => !locked && onStart(section.id)}>Retry</Button>
            </div>
          ) : (
            <Button fullWidth size="lg" loading={isLoading} disabled={locked} leftIcon={<Play className="fill-current" />} onClick={() => !locked && onStart(section.id)}>
              {activeAttempt ? "Continue" : "Start"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── combined score banner ────────────────────────────────────────────────────

function CombinedScoreBanner({ pack, attempts }: { pack: PastpaperPackPublic; attempts: AttemptRow[] }) {
  const completedAttempts = pack.sections.map((s) => attempts.find((a) => a.practice_test === s.id && a.is_completed));
  if (completedAttempts.some((a) => !a)) return null;

  const scores = completedAttempts.map((a) => a?.score ?? null);
  const allHaveScores = scores.every((s) => s != null);
  const composite = allHaveScores ? Math.min(1600, scores.reduce((sum, s) => (sum ?? 0) + (s ?? 0), 0) ?? 0) : null;

  return (
    <Card className="border-success/25 bg-success-soft">
      <CardContent>
        <div className="mb-2 flex items-center gap-3">
          <Trophy className="h-5 w-5 shrink-0 text-success" />
          <p className="ds-overline text-success-foreground">All sections complete</p>
        </div>
        {composite != null ? (
          <div className="flex items-baseline gap-2">
            <span className="ds-num text-4xl font-extrabold text-success-foreground">{composite}</span>
            <span className="text-sm font-bold text-success-foreground">/ 1600</span>
            <span className="ml-1 text-xs text-success-foreground/80">composite SAT score</span>
          </div>
        ) : (
          <p className="text-sm text-success-foreground">Review each section to see your answers and explanations.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── inner page ───────────────────────────────────────────────────────────────

function PastpaperPackDetailInner() {
  const { packId } = useParams<{ packId: string }>();
  const id = Number(packId);
  const router = useRouter();
  const { isAuthenticated } = useMe();
  const { assertCriticalAuth } = useAuthCriticalGate();

  const [pack, setPack] = useState<PastpaperPackPublic | null>(null);
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [starting, setStarting] = useState<number | null>(null);
  const [startError, setStartError] = useState<{ sectionId: number; msg: string } | null>(null);

  useEffect(() => {
    if (!id || !Number.isFinite(id)) return;
    let cancelled = false;
    (async () => {
      try {
        setFetchError(null);
        const [packData, attData] = await Promise.all([
          examsPublicApi.getPastpaperPack(id),
          isAuthenticated ? examsStudentApi.getAttempts() : Promise.resolve({ items: [] }),
        ]);
        if (!cancelled) {
          setPack(packData);
          setAttempts((attData.items as AttemptRow[]).filter((a) => packData.sections.some((s) => s.id === a.practice_test)));
        }
      } catch (e: unknown) {
        if (!cancelled) {
          const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
          setFetchError(typeof d === "string" ? d : "Could not load this past paper.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, isAuthenticated]);

  const sorted = [...(pack?.sections ?? [])].sort((a, b) => (isRWSubject(a.subject) ? 0 : 1) - (isRWSubject(b.subject) ? 0 : 1));

  const handleStart = async (sectionId: number) => {
    if (!assertCriticalAuth()) return;
    setStarting(sectionId);
    setStartError(null);
    try {
      let attempt = attempts.find((a) => a.practice_test === sectionId && !a.is_completed && !a.is_expired);
      if (!attempt) {
        attempt = (await examsStudentApi.startTest(sectionId)) as AttemptRow;
        setAttempts((prev) => [...prev, attempt!]);
      }
      try {
        sessionStorage.setItem(`mastersat.attempt.bootstrap.${attempt.id}`, JSON.stringify(attempt));
      } catch {}
      router.push(`/exam/${attempt.id}`);
    } catch (e: unknown) {
      console.error("[pastpaper] start section failed", e);
      const data = (e as { response?: { data?: unknown } })?.response?.data;
      let msg = "Could not start the test. Please try again.";
      if (data && typeof data === "object") {
        const d = data as Record<string, unknown>;
        if (typeof d.message === "string") msg = d.message;
        else if (typeof d.detail === "string") msg = d.detail;
        else if (typeof d.error === "string") msg = d.error;
        else if (d.code === "practice_test_empty") msg = "This section has no questions yet.";
      }
      setStartError({ sectionId, msg });
      setStarting(null);
    }
  };

  if (loading) {
    return <div className="flex min-h-[40vh] items-center justify-center"><Spinner className="h-10 w-10 text-primary" /></div>;
  }

  if (!pack) {
    return (
      <div className="mx-auto max-w-xl py-16">
        <EmptyState title={fetchError ?? "Past paper not found"} description="It may have been unpublished." action={<Link href="/pastpapers"><Button variant="secondary">Back to past papers</Button></Link>} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 pb-12">
      <Link href="/pastpapers" className="ds-ring inline-flex w-fit items-center gap-1.5 rounded-lg text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Past papers
      </Link>

      <div>
        <p className="ds-overline text-primary">{pack.form_type === "US" ? "US form" : "International form"}{pack.label ? ` · Form ${pack.label}` : ""}</p>
        <h1 className="ds-h1 mt-1">{pack.title || `SAT past paper — ${formatDate(pack.practice_date)}`}</h1>
        <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground"><Calendar className="h-4 w-4 shrink-0" /> {formatDate(pack.practice_date)}</p>
        <p className="ds-small mt-2">Practice SAT sections — start with either Reading &amp; Writing or Mathematics, in any order.</p>
      </div>

      {isAuthenticated ? <CombinedScoreBanner pack={pack} attempts={attempts} /> : null}

      {sorted.length === 0 ? (
        <EmptyState compact title="No sections yet" description="Sections appear here once added." />
      ) : (
        <div className="grid gap-4">
          {sorted.map((section) => (
            <SectionCard key={section.id} section={section} attempts={attempts} onStart={handleStart} starting={starting} startError={startError?.sectionId === section.id ? startError.msg : null} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function PastpaperPackDetailPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[40vh] items-center justify-center"><Spinner className="h-10 w-10 text-primary" /></div>}>
      <PastpaperPackDetailInner />
    </Suspense>
  );
}
