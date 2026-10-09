"use client";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, PartyPopper } from "lucide-react";

import { midtermApi } from "@/lib/midtermApi";
import { desktop, isDesktopShell } from "@/lib/desktop/bridge";
import { DESKTOP_HOME, type DesktopPaperKind } from "@/lib/desktop/routes";
import { examApi } from "@/features/testing-simulation/services/examApiClient";
import { ATTEMPT_STATE } from "@/features/testing-simulation/types";

import { DesktopChrome, useDesktopSession } from "./DesktopChrome";

/** The website page with the full breakdown — opened in the student's own browser. */
function reportPath(kind: DesktopPaperKind, attemptId: number): string {
  return kind === "pastpaper" ? `/pastpapers/${attemptId}/report` : `/midterm/result/${attemptId}`;
}

/** The midterm review answers 403 until scoring finishes — "not yet", not a failure. */
function notReadyYet(e: unknown): boolean {
  return (e as { response?: { status?: number } })?.response?.status === 403;
}

type Result =
  | { kind: "scoring" }
  | { kind: "failed" }
  | { kind: "ready"; score: number | null; ceiling: number | null; released: boolean };

function useResult(kind: DesktopPaperKind, attemptId: number, enabled: boolean): Result {
  const pastpaper = useQuery({
    queryKey: ["desktop", "done", "pastpaper", attemptId],
    queryFn: () => examApi.getStatus(attemptId),
    enabled: enabled && kind === "pastpaper",
    // Scoring takes a moment after the last module; keep asking until it lands.
    refetchInterval: (q) => (q.state.data?.current_state === ATTEMPT_STATE.COMPLETED ? false : 2000),
  });
  const midterm = useQuery({
    queryKey: ["desktop", "done", "midterm", attemptId],
    queryFn: () => midtermApi.getReview(attemptId),
    enabled: enabled && kind === "midterm",
    retry: false,
    refetchInterval: (q) => (q.state.data || (q.state.error && !notReadyYet(q.state.error)) ? false : 2000),
  });

  if (kind === "pastpaper") {
    const a = pastpaper.data;
    if (pastpaper.isError && !a) return { kind: "failed" };
    if (!a || a.current_state !== ATTEMPT_STATE.COMPLETED) return { kind: "scoring" };
    return { kind: "ready", score: a.score ?? null, ceiling: null, released: true };
  }
  const r = midterm.data;
  if (!r) return midterm.isError && !notReadyYet(midterm.error) ? { kind: "failed" } : { kind: "scoring" };
  return { kind: "ready", score: r.total_score ?? null, ceiling: r.score_ceiling ?? null, released: r.released };
}

/** Bluebook's "You're all finished!" — the lockdown is already released by the time it shows. */
export function DesktopDone({ kind, attemptId }: { kind: DesktopPaperKind; attemptId: number }) {
  const router = useRouter();
  const { ready } = useDesktopSession();
  const result = useResult(kind, attemptId, ready && Number.isFinite(attemptId));

  const openReport = () => {
    const path = reportPath(kind, attemptId);
    if (isDesktopShell()) void desktop.openExternal(`${window.location.origin}${path}`).catch(() => {});
    else router.push(path);
  };

  return (
    <DesktopChrome>
      <div className="mx-auto flex max-w-xl flex-col items-center px-8 py-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
          <PartyPopper className="h-8 w-8" aria-hidden />
        </div>
        <h1 className="mt-5 text-3xl font-bold tracking-tight text-slate-900">You&apos;re all finished!</h1>

        <div className="mt-8 w-full rounded-3xl border border-slate-200 bg-white px-8 py-10" aria-live="polite">
          {result.kind === "scoring" ? (
            <p className="text-base font-semibold text-slate-600">Scoring your answers…</p>
          ) : result.kind === "failed" ? (
            <p className="text-base font-semibold text-red-700">
              Your answers are saved, but the result could not be loaded. Check your internet connection.
            </p>
          ) : result.released && result.score != null ? (
            <>
              <p className="text-sm font-bold uppercase tracking-wide text-slate-500">Your score</p>
              <p className="mt-2 text-5xl font-extrabold tabular-nums text-slate-900">
                {result.score}
                {result.ceiling ? <span className="text-2xl font-bold text-slate-400"> / {result.ceiling}</span> : null}
              </p>
            </>
          ) : (
            <p className="text-base font-semibold text-slate-600">
              Your answers are in. Your teacher will release the result — you&apos;ll see it here and on the website.
            </p>
          )}
        </div>

        <div className="mt-8 flex w-full flex-col gap-3">
          {result.kind === "ready" ? (
            <button
              type="button"
              onClick={openReport}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-slate-300 px-8 py-3 text-base font-bold text-slate-800 hover:bg-slate-50"
            >
              <ExternalLink className="h-5 w-5" aria-hidden /> Open the full report
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => router.push(DESKTOP_HOME)}
            className="inline-flex w-full items-center justify-center rounded-full bg-blue-700 px-8 py-3 text-base font-bold text-white hover:bg-blue-800"
          >
            Back to my tests
          </button>
        </div>
      </div>
    </DesktopChrome>
  );
}
