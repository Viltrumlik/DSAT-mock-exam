"use client";
import { AlertTriangle, Maximize, ShieldAlert } from "lucide-react";

interface OffscreenWarningProps {
  /** Seconds left to get back before the paper is taken in. */
  secondsLeft: number;
  /** Offences left before the sitting is forfeited. */
  chancesLeft: number;
  /** Offer the fullscreen button only when leaving fullscreen is what's wrong. */
  showReturnToFullscreen: boolean;
  onReturnToFullscreen: () => void;
}

/**
 * Full-cover warning shown the moment the student leaves the exam window during a midterm.
 *
 * It is deliberately unmissable and un-dismissable: the only way out is to come back, which
 * the runner detects itself (there is no "I understand" button to click, because clicking it
 * would prove they are back and make the button pointless). The countdown is the server's
 * grace — see useOffscreenGuard.
 */
export function OffscreenWarning({
  secondsLeft,
  chancesLeft,
  showReturnToFullscreen,
  onReturnToFullscreen,
}: OffscreenWarningProps) {
  const seconds = Math.max(0, secondsLeft);
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="Return to your exam"
      className="fixed inset-0 z-[90] flex items-center justify-center bg-red-950/90 px-6"
    >
      <div className="w-full max-w-lg rounded-3xl bg-white p-8 text-center shadow-2xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50">
          <AlertTriangle className="h-7 w-7 text-red-600" />
        </div>
        <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">Come back to your exam</h2>
        <p className="mt-2 text-sm font-medium text-slate-500">
          You left the exam window. Midterms are proctored — return now or your paper will be taken in and
          submitted as it stands.
        </p>

        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-4" role="timer" aria-live="assertive">
          <div className="text-4xl font-bold tabular-nums text-red-700">{seconds}</div>
          <p className="mt-1 text-sm font-bold text-red-800">
            {seconds === 1 ? "second" : "seconds"} to return
          </p>
        </div>

        <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-1.5 text-sm font-bold text-slate-700">
          <ShieldAlert className="h-4 w-4 text-slate-500" />
          {chancesLeft === 0
            ? "No chances left"
            : `${chancesLeft} ${chancesLeft === 1 ? "chance" : "chances"} left`}
        </p>

        {showReturnToFullscreen && (
          <button
            type="button"
            onClick={onReturnToFullscreen}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-blue-700 px-6 py-3 text-base font-bold text-white transition-colors hover:bg-blue-800"
          >
            <Maximize className="h-5 w-5" />
            Return to full screen
          </button>
        )}
      </div>
    </div>
  );
}

interface OffscreenTerminatedScreenProps {
  /** Go to the result now; the runner also routes there on its own after a beat. */
  onContinue: () => void;
}

/**
 * Terminal screen for a sitting the off-screen rule ended. The paper was submitted BY THE
 * SERVER on the terminating offence — this screen never submits anything, it only explains
 * what happened before the student is sent to their result.
 */
export function OffscreenTerminatedScreen({ onContinue }: OffscreenTerminatedScreenProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white px-6">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50">
          <ShieldAlert className="h-7 w-7 text-red-600" />
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">Your exam was submitted</h1>
        <p className="mt-3 text-sm font-medium text-slate-500">
          You left the exam window too many times, so your midterm was taken in and graded as it stood. Your
          answers up to that point were all saved.
        </p>
        <button
          type="button"
          onClick={onContinue}
          className="mt-7 inline-flex w-full items-center justify-center rounded-full bg-blue-700 px-6 py-3 text-base font-bold text-white transition-colors hover:bg-blue-800"
        >
          See your result
        </button>
      </div>
    </div>
  );
}
