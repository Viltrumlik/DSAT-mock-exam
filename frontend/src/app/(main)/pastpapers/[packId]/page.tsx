"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { examsPublicApi, type PastpaperPackPublic, type PastpaperPackSection } from "@/lib/api";
import { examsStudentApi } from "@/features/examsStudent/api";
import { useMe } from "@/hooks/useMe";
import { useAuthCriticalGate } from "@/hooks/useAuthCriticalGate";
import {
  ArrowLeft,
  BookOpen,
  Calculator,
  Calendar,
  CheckCircle2,
  Eye,
  Play,
  Trophy,
} from "lucide-react";

// ─── helpers ─────────────────────────────────────────────────────────────────

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

// ─── sentinel error: server-enforced break ───────────────────────────────────

class BreakRequiredError extends Error {
  breakEndsAt: string;
  constructor(breakEndsAt: string) {
    super("break_required");
    this.breakEndsAt = breakEndsAt;
  }
}

// ─── section card ─────────────────────────────────────────────────────────────

type AttemptRow = {
  id: number;
  practice_test: number;
  is_completed: boolean;
  is_expired: boolean;
  score?: number | null;
};

function SectionCard({
  section,
  attempts,
  onStart,
  starting,
  locked,
  lockReason,
}: {
  section: PastpaperPackSection;
  attempts: AttemptRow[];
  onStart: (sectionId: number) => void;
  starting: number | null;
  locked?: boolean;
  lockReason?: string;
}) {
  const rw = isRWSubject(section.subject);
  const Icon = rw ? BookOpen : Calculator;
  const iconColor = rw ? "text-primary" : "text-emerald-600";
  const iconBg = rw ? "bg-primary/8" : "bg-emerald-50";
  const borderColor = locked
    ? "border-border"
    : rw
    ? "border-primary/20"
    : "border-emerald-200";
  const ctaClass = locked
    ? "bg-surface-2 text-muted-foreground cursor-not-allowed"
    : rw
    ? "bg-primary text-primary-foreground hover:bg-primary/90"
    : "bg-emerald-600 text-white hover:bg-emerald-700";

  const sectionAttempts = attempts
    .filter((a) => a.practice_test === section.id)
    .sort((a, b) => b.id - a.id);
  const activeAttempt = sectionAttempts.find((a) => !a.is_completed && !a.is_expired);
  const completedAttempt = sectionAttempts.find((a) => a.is_completed);
  const isCompleted = !!completedAttempt;
  const isLoading = starting === section.id;

  return (
    <div className={`rounded-2xl border-2 ${borderColor} bg-card p-5 flex flex-col gap-4 ${locked ? "opacity-60" : ""}`}>
      {/* Icon + labels */}
      <div className="flex items-start gap-4">
        <div className={`shrink-0 rounded-2xl p-3 ${iconBg}`}>
          <Icon className={`h-6 w-6 ${iconColor}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-extrabold text-foreground">{subjectLabel(section.subject)}</h3>
            {isCompleted && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                <CheckCircle2 className="h-3 w-3" />
                Done
              </span>
            )}
            {activeAttempt && !isCompleted && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                In progress
              </span>
            )}
            {locked && (
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-bold text-muted-foreground border border-border">
                Locked
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {section.module_count} module{section.module_count !== 1 ? "s" : ""} ·{" "}
            {totalMinutes(section)} min
            {section.form_type === "US" ? " · US Form" : " · International"}
          </p>
          {isCompleted && completedAttempt?.score != null && (
            <p className="mt-1 text-xs font-bold text-foreground">
              Score: <span className="text-primary">{completedAttempt.score}</span>
              <span className="font-normal text-muted-foreground"> / 800</span>
            </p>
          )}
          {locked && lockReason && (
            <p className="mt-1 text-xs text-muted-foreground">{lockReason}</p>
          )}
        </div>
      </div>

      {/* CTA */}
      <div className="flex gap-2">
        {isCompleted ? (
          <>
            <Link
              href={`/review/${completedAttempt!.id}`}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-xs font-bold text-foreground hover:bg-card transition-colors"
            >
              <Eye className="h-4 w-4" />
              Review answers
            </Link>
            <button
              type="button"
              onClick={() => !locked && onStart(section.id)}
              disabled={isLoading || locked}
              className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition-colors ${ctaClass}`}
            >
              {isLoading ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <>
                  <Play className="h-4 w-4 fill-current" />
                  Retry
                </>
              )}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => !locked && onStart(section.id)}
            disabled={isLoading || locked}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold shadow-sm transition-colors ${ctaClass}`}
          >
            {isLoading ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <>
                <Play className="h-5 w-5 fill-current" />
                {activeAttempt ? "Continue" : "Start"}
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── combined score banner ────────────────────────────────────────────────────

function CombinedScoreBanner({
  pack,
  attempts,
}: {
  pack: PastpaperPackPublic;
  attempts: AttemptRow[];
}) {
  const completedAttempts = pack.sections.map((s) =>
    attempts.find((a) => a.practice_test === s.id && a.is_completed),
  );
  if (completedAttempts.some((a) => !a)) return null;

  // Compute composite score if all section scores are available.
  const scores = completedAttempts.map((a) => a?.score ?? null);
  const allHaveScores = scores.every((s) => s != null);
  const composite = allHaveScores
    ? Math.min(1600, scores.reduce((sum, s) => (sum ?? 0) + (s ?? 0), 0) ?? 0)
    : null;

  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-5">
      <div className="flex items-center gap-3 mb-2">
        <Trophy className="h-5 w-5 text-emerald-600 shrink-0" />
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">All sections complete</p>
      </div>
      {composite != null ? (
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-black text-emerald-900 tabular-nums">{composite}</span>
          <span className="text-sm font-bold text-emerald-700">/ 1600</span>
          <span className="text-xs text-emerald-600 ml-1">composite SAT score</span>
        </div>
      ) : (
        <p className="text-sm text-emerald-800 leading-relaxed">
          Review each section to see your answers and explanations.
        </p>
      )}
    </div>
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
          setAttempts(
            (attData.items as AttemptRow[]).filter((a) =>
              packData.sections.some((s) => s.id === a.practice_test),
            ),
          );
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
    return () => {
      cancelled = true;
    };
  }, [id, isAuthenticated]);

  // Sort: R&W first, then Math.
  const sorted = [...(pack?.sections ?? [])].sort((a, b) => {
    return (isRWSubject(a.subject) ? 0 : 1) - (isRWSubject(b.subject) ? 0 : 1);
  });

  // Derive locking state: Math is locked until R&W is completed.
  const rwSection = sorted.find((s) => isRWSubject(s.subject));
  const rwDone = !!attempts.find((a) => a.practice_test === rwSection?.id && a.is_completed);
  // Find the last completed R&W attempt to compute break status.
  const rwCompletedAttempt = attempts
    .filter((a) => a.practice_test === rwSection?.id && a.is_completed)
    .sort((a, b) => b.id - a.id)[0];

  const handleStart = async (sectionId: number) => {
    if (!assertCriticalAuth()) return;
    setStarting(sectionId);
    try {
      let attempt = attempts.find(
        (a) => a.practice_test === sectionId && !a.is_completed && !a.is_expired,
      );
      if (!attempt) {
        try {
          attempt = (await examsStudentApi.startTest(sectionId)) as AttemptRow;
        } catch (e: unknown) {
          // Server-enforced break: backend rejects Math start until break has elapsed.
          const resp = (e as { response?: { data?: { code?: string; break_ends_at?: string } } })?.response;
          if (resp?.data?.code === "break_required" && resp.data.break_ends_at) {
            throw new BreakRequiredError(resp.data.break_ends_at);
          }
          // Server-enforced section ordering.
          if (resp?.data?.code === "section_order_violation") {
            throw new Error("section_order_violation");
          }
          throw e;
        }
        setAttempts((prev) => [...prev, attempt!]);
      }
      try {
        sessionStorage.setItem(`mastersat.attempt.bootstrap.${attempt.id}`, JSON.stringify(attempt));
      } catch {}
      router.push(`/exam/${attempt.id}`);
    } catch (e) {
      if (e instanceof BreakRequiredError) {
        // Redirect to the pastpaper break page with the server timestamp.
        router.push(
          `/pastpapers/${packId}/break?rwAttempt=${rwCompletedAttempt?.id ?? ""}&breakEndsAt=${encodeURIComponent(e.breakEndsAt)}`,
        );
        return;
      }
      if (e instanceof Error && e.message === "section_order_violation") {
        // Silently handled — the UI already locks Math until R&W is done.
        setStarting(null);
        return;
      }
      console.error("[pastpaper] start section failed", e);
      setStarting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!pack) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="font-bold text-foreground mb-2">
          {fetchError ?? "Past paper not found."}
        </p>
        <Link href="/pastpapers" className="text-sm font-semibold text-primary hover:underline">
          ← Back to past papers
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8">
      {/* Back */}
      <Link
        href="/pastpapers"
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Past papers
      </Link>

      {/* Pack header */}
      <div className="mb-8">
        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-primary">
          {pack.form_type === "US" ? "US Form" : "International Form"}
          {pack.label ? ` · Form ${pack.label}` : ""}
        </p>
        <h1 className="text-2xl font-black tracking-tight text-foreground">
          {pack.title || `SAT Past Paper — ${formatDate(pack.practice_date)}`}
        </h1>
        <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Calendar className="h-4 w-4 shrink-0" />
          {formatDate(pack.practice_date)}
        </p>
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
          Simulate authentic SAT conditions — complete Reading &amp; Writing first, then take a
          10-minute break, then Mathematics. Pacing and sequencing are enforced automatically.
        </p>
      </div>

      {/* Combined score banner */}
      {isAuthenticated && (
        <div className="mb-6">
          <CombinedScoreBanner pack={pack} attempts={attempts} />
        </div>
      )}

      {/* Section cards */}
      {sorted.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          No sections available yet.
        </div>
      ) : (
        <div className="grid gap-4">
          {sorted.map((section) => {
            const isMath = !isRWSubject(section.subject);
            const locked = isMath && !rwDone;
            return (
              <SectionCard
                key={section.id}
                section={section}
                attempts={attempts}
                onStart={handleStart}
                starting={starting}
                locked={locked}
                lockReason={locked ? "Complete Reading & Writing first to unlock Mathematics." : undefined}
              />
            );
          })}
        </div>
      )}

      {/* Break state notice */}
      {rwDone && !attempts.find((a) => !isRWSubject(sorted.find((s) => s.id === a.practice_test)?.subject ?? "") && a.is_completed) && (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-700 mb-1">
            Reading &amp; Writing complete
          </p>
          <p className="text-sm text-amber-800">
            Take a 10-minute break before starting Mathematics — the official SAT requires it.
            The timer will start automatically when you click Start on the Mathematics section.
          </p>
        </div>
      )}
    </div>
  );
}

export default function PastpaperPackDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      }
    >
      <PastpaperPackDetailInner />
    </Suspense>
  );
}
