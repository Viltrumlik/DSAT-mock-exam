"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { useAuthCriticalGate } from "@/hooks/useAuthCriticalGate";
import { examsPublicApi } from "@/lib/api";
import { platformSubjectIsMath } from "@/lib/permissions";
import { ArrowLeft, Timer } from "lucide-react";

const BREAK_SECONDS = 10 * 60;

function computeInitialLeft(breakEndsAt: string | null): number {
  if (!breakEndsAt) return BREAK_SECONDS;
  try {
    const ms = new Date(breakEndsAt).getTime() - Date.now();
    return Math.max(0, Math.round(ms / 1000));
  } catch {
    return BREAK_SECONDS;
  }
}

function BreakInner() {
  const { assertCriticalAuth } = useAuthCriticalGate();
  const { id } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rwAttempt = searchParams.get("rwAttempt") || "";
  const breakEndsAt = searchParams.get("breakEndsAt") || null;
  const mockId = String(id);
  const [left, setLeft] = useState(() => computeInitialLeft(breakEndsAt));
  const [startingMath, setStartingMath] = useState(false);
  const mathAutostartStarted = useRef(false);

  useEffect(() => {
    if (!rwAttempt) {
      router.replace(`/mock/${mockId}`);
      return;
    }
    // Re-sync from server timestamp if provided (handles page reload mid-break).
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
  }, [mockId, rwAttempt, router]);

  useEffect(() => {
    if (left !== 0 || !rwAttempt) return;
    if (mathAutostartStarted.current) return;
    mathAutostartStarted.current = true;

    let cancelled = false;
    setStartingMath(true);

    (async () => {
      if (!assertCriticalAuth()) {
        mathAutostartStarted.current = false;
        if (!cancelled) {
          router.replace(`/mock/${mockId}`);
        }
        return;
      }
      try {
        localStorage.setItem(`mastersat_mock_${mockId}_break_done`, "1");
        localStorage.setItem(`mastersat_mock_${mockId}_break_after_rw`, rwAttempt);
      } catch {
        /* ignore */
      }

      try {
        const exam = await examsPublicApi.getMockExam(Number(mockId));
        const mathTest = (exam.tests || []).find((t: { subject?: string }) => platformSubjectIsMath(t.subject));
        const modules = [...(mathTest?.modules || [])].sort(
          (a: { module_order?: number }, b: { module_order?: number }) =>
            (a.module_order ?? 0) - (b.module_order ?? 0)
        );
        const firstMod = modules[0];
        if (!mathTest?.id || !firstMod?.id) {
          throw new Error("No Math module");
        }
        const attemptsBundle = await examsPublicApi.getAttempts();
        let attempt = attemptsBundle.items.find(
          (a) => a.practice_test === mathTest.id && !a.is_completed && !a.is_expired,
        );
        if (!attempt) {
          attempt = await examsPublicApi.startTest(mathTest.id);
        }
        if (!cancelled) {
          router.replace(
            `/exam/${attempt.id}?mockFlow=1&mockExamId=${encodeURIComponent(mockId)}&rwAttempt=${encodeURIComponent(rwAttempt)}`
          );
        }
      } catch {
        mathAutostartStarted.current = false;
        if (!cancelled) {
          router.replace(`/mock/${mockId}`);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [left, rwAttempt, mockId, router, assertCriticalAuth]);

  const mm = Math.floor(left / 60);
  const ss = left % 60;

  return (
    <AuthGuard>
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center px-6">
        <button
          type="button"
          onClick={() => router.push(`/mock/${mockId}`)}
          className="absolute top-6 left-6 flex items-center gap-2 text-slate-400 hover:text-white text-sm font-bold"
        >
          <ArrowLeft className="w-5 h-5" /> Back
        </button>
        <Timer className="w-16 h-16 text-amber-400 mb-6" />
        <h1 className="text-3xl font-black tracking-tight text-center mb-2">Scheduled break</h1>
        <p className="text-slate-400 text-center max-w-md mb-10 font-medium">
          Reading & Writing is complete. The digital SAT includes a 10-minute break before Math. Stay on this screen until the
          timer finishes—Math will open automatically.
        </p>
        {startingMath ? (
          <>
            <div className="w-14 h-14 border-4 border-amber-400 border-t-transparent rounded-full animate-spin mb-6" />
            <p className="text-amber-200 font-bold text-sm uppercase tracking-widest">Starting Math…</p>
            <p className="mt-4 text-xs text-slate-500 text-center max-w-sm">
              If nothing happens, return to the mock page and use &quot;Start Math&quot;.
            </p>
          </>
        ) : (
          <div className="text-6xl font-mono font-black tabular-nums text-amber-300">
            {mm}:{ss.toString().padStart(2, "0")}
          </div>
        )}
        <p className="mt-8 text-xs font-bold text-slate-500 uppercase tracking-widest">Pause is not available during the mock</p>
      </div>
    </AuthGuard>
  );
}

export default function MockBreakPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-950">
          <div className="w-12 h-12 border-4 border-amber-400 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <BreakInner />
    </Suspense>
  );
}
