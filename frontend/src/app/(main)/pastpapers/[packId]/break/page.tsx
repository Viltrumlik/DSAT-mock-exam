"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { useAuthCriticalGate } from "@/hooks/useAuthCriticalGate";
import { examsPublicApi } from "@/lib/api";
import { examsStudentApi } from "@/features/examsStudent/api";
import { ArrowLeft, Timer } from "lucide-react";

// ─── constants ────────────────────────────────────────────────────────────────

const BREAK_SECONDS = 10 * 60; // must match SAT_BREAK_SECONDS on backend

function computeInitialLeft(breakEndsAt: string | null): number {
  if (!breakEndsAt) return BREAK_SECONDS;
  try {
    const ms = new Date(breakEndsAt).getTime() - Date.now();
    return Math.max(0, Math.round(ms / 1000));
  } catch {
    return BREAK_SECONDS;
  }
}

// ─── inner component ──────────────────────────────────────────────────────────

function PastpaperBreakInner() {
  const { assertCriticalAuth } = useAuthCriticalGate();
  const { packId } = useParams<{ packId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rwAttempt = searchParams.get("rwAttempt") || "";
  const breakEndsAt = searchParams.get("breakEndsAt") || null;
  const packIdStr = String(packId);

  const [left, setLeft] = useState(() => computeInitialLeft(breakEndsAt));
  const [startingMath, setStartingMath] = useState(false);
  const mathAutostartStarted = useRef(false);

  // Guard: must arrive from a completed R&W section.
  useEffect(() => {
    if (!rwAttempt) {
      router.replace(`/pastpapers/${packIdStr}`);
    }
  }, [packIdStr, rwAttempt, router]);

  // Re-sync from server timestamp when the page first mounts (handles reload mid-break).
  useEffect(() => {
    if (breakEndsAt) {
      setLeft(computeInitialLeft(breakEndsAt));
    }
    const t = setInterval(() => {
      setLeft((s) => {
        if (s <= 1) {
          clearInterval(t);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packIdStr, rwAttempt]);

  // Auto-start Math when break ends.
  useEffect(() => {
    if (left !== 0 || !rwAttempt) return;
    if (mathAutostartStarted.current) return;
    mathAutostartStarted.current = true;

    let cancelled = false;
    setStartingMath(true);

    (async () => {
      if (!assertCriticalAuth()) {
        mathAutostartStarted.current = false;
        if (!cancelled) router.replace(`/pastpapers/${packIdStr}`);
        return;
      }
      try {
        // Fetch the pack to find the Math section.
        const pack = await examsPublicApi.getPastpaperPack(Number(packIdStr));
        const mathSection = (pack.sections || []).find(
          (s: { subject?: string }) =>
            s.subject === "MATH" || s.subject?.toLowerCase().includes("math"),
        );
        if (!mathSection?.id) throw new Error("No Math section found in pack");

        // Fetch attempts to find an existing active Math attempt, or create one.
        const attBundle = await examsPublicApi.getAttempts();
        let attempt = (attBundle.items || []).find(
          (a: { practice_test: number; is_completed: boolean; is_expired: boolean }) =>
            a.practice_test === mathSection.id && !a.is_completed && !a.is_expired,
        );
        if (!attempt) {
          attempt = await examsStudentApi.startTest(mathSection.id);
        }
        if (!cancelled) {
          router.replace(`/exam/${attempt.id}`);
        }
      } catch {
        mathAutostartStarted.current = false;
        if (!cancelled) router.replace(`/pastpapers/${packIdStr}`);
      } finally {
        if (!cancelled) setStartingMath(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [left, rwAttempt, packIdStr, router, assertCriticalAuth]);

  const mm = Math.floor(left / 60);
  const ss = left % 60;

  return (
    <AuthGuard>
      <div className="min-h-screen bg-foreground text-background flex flex-col items-center justify-center px-6">
        {/* Back to pack */}
        <button
          type="button"
          onClick={() => router.push(`/pastpapers/${packIdStr}`)}
          className="absolute top-6 left-6 flex items-center gap-2 text-background/50 hover:text-background text-sm font-bold transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to past paper
        </button>

        {/* Countdown */}
        <div className="flex flex-col items-center gap-6 max-w-md text-center">
          <div className="w-20 h-20 rounded-full bg-background/10 flex items-center justify-center">
            <Timer className="h-10 w-10 text-background/80" />
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-background/50 mb-3">
              Mandatory SAT Break
            </p>
            <p
              className="text-7xl font-black tabular-nums tracking-tight"
              aria-live="polite"
              aria-label={`${mm} minutes ${ss} seconds remaining`}
            >
              {String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
            </p>
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-black">10-minute break</h1>
            <p className="text-sm text-background/60 leading-relaxed">
              This break is required before Mathematics. Step away from the screen, rest your
              eyes, and breathe. The Math section will open automatically when the timer ends.
            </p>
          </div>

          {left === 0 && (
            <div className="rounded-2xl bg-background/10 px-6 py-4 w-full">
              {startingMath ? (
                <p className="text-sm font-bold text-background/80">
                  Starting Mathematics…
                </p>
              ) : (
                <p className="text-sm font-bold text-background">
                  Break complete — Mathematics is unlocking.
                </p>
              )}
            </div>
          )}

          {left > 0 && (
            <p className="text-xs text-background/40 leading-relaxed">
              You will not be able to skip this timer. Mathematics opens automatically.
            </p>
          )}
        </div>
      </div>
    </AuthGuard>
  );
}

export default function PastpaperBreakPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-foreground flex items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-background border-t-transparent" />
        </div>
      }
    >
      <PastpaperBreakInner />
    </Suspense>
  );
}
