"use client";

/** Centered loading spinner shown while the attempt boots. */
export function LoadingScreen({ label = "Loading exam…" }: { label?: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />
      <p className="mt-5 font-medium text-slate-500">{label}</p>
    </div>
  );
}

interface ErrorScreenProps {
  title: string;
  message: string;
  /** When omitted (e.g. for students) no recovery button is shown. */
  actionLabel?: string;
  onAction?: () => void;
  /** Optional secondary line, e.g. a hint for students. */
  hint?: string;
}

/** Error screen. The recovery action is only rendered when provided (admin-only). */
export function ErrorScreen({ title, message, actionLabel, onAction, hint }: ErrorScreenProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white px-6">
      <h2 className="text-center text-xl font-bold tracking-tight text-slate-900">{title}</h2>
      <p className="mt-3 max-w-md text-center font-medium text-slate-500">{message}</p>
      {hint && <p className="mt-2 max-w-md text-center text-sm text-slate-400">{hint}</p>}
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-6 inline-flex items-center justify-center rounded-xl bg-emerald-600 px-5 py-3 font-bold text-white transition-colors hover:bg-emerald-700"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/**
 * Full-screen gate. The testing simulation must always run in full screen
 * (anti-cheating). While the student is outside full screen this replaces the
 * entire exam, so no question content is visible. When `countdown` is non-null
 * the student has *left* full screen mid-exam and is being warned that they will
 * be removed (with answers saved) if they don't return in time.
 */
export function FullscreenGate({ countdown, onEnter }: { countdown: number | null; onEnter: () => void }) {
  const leaving = countdown !== null;
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6 text-center">
      <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-12 shadow-xl">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
          {leaving ? "Return to full screen" : "Ready to begin?"}
        </h1>
        <p className="mt-4 text-lg font-medium leading-relaxed text-slate-500">
          {leaving ? (
            <>
              This exam must stay in full screen. You will be removed and your answers saved in{" "}
              <span className="font-black text-red-600">{countdown}s</span> if you do not return.
            </>
          ) : (
            "This exam must be taken in full screen to simulate real testing conditions and keep your session secure."
          )}
        </p>
        <button
          type="button"
          onClick={onEnter}
          className={`mt-10 w-full rounded-2xl py-5 text-lg font-bold text-white shadow-lg transition-all active:scale-[0.98] ${
            leaving ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
          }`}
        >
          {leaving ? "Return to full screen now" : "Enter full screen & start"}
        </button>
      </div>
    </div>
  );
}

/**
 * Off-screen guard overlay. Covers all question content while the tab/window is
 * not visible (e.g. the student switched tabs or apps), so the exam can't be
 * read while focus is elsewhere. Answers continue to autosave underneath.
 */
export function OffscreenOverlay() {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900 px-6 text-center">
      <div>
        <h2 className="text-2xl font-black text-white">Exam hidden</h2>
        <p className="mx-auto mt-3 max-w-md font-medium text-slate-400">
          Question content is hidden while this window isn&apos;t in focus. Return to the exam window to continue — your
          answers are saved automatically.
        </p>
      </div>
    </div>
  );
}

/** Scoring interstitial shown while the backend finalizes the score. */
export function ScoringScreen({ notice }: { notice?: string | null }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-emerald-600" />
      <h2 className="mt-6 text-xl font-bold tracking-tight text-slate-900">Scoring your exam…</h2>
      <p className="mt-2 font-medium text-slate-500">{notice || "This only takes a moment."}</p>
    </div>
  );
}
