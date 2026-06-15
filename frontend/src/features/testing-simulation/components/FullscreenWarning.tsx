"use client";
import { Maximize } from "lucide-react";

interface FullscreenWarningProps {
  onReturn: () => void;
}

/**
 * Blocking overlay shown when the student leaves full screen during an active
 * test (item: Forced Fullscreen). Re-entering requires a user gesture, so the
 * only action is a button that calls requestFullscreen again. The runner only
 * mounts this when fullscreen is supported and the test is active — so browsers
 * that can't go fullscreen degrade gracefully (no overlay).
 */
export function FullscreenWarning({ onReturn }: FullscreenWarningProps) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="Full screen required"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/80 px-6 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-2xl">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-50">
          <Maximize className="h-6 w-6 text-blue-700" />
        </div>
        <h2 className="mt-4 text-xl font-bold tracking-tight text-slate-900">Return to full screen</h2>
        <p className="mt-2 text-sm font-medium text-slate-500">
          This test must be taken in full screen. You exited full screen — your timer is still running. Click below to
          continue.
        </p>
        <button
          type="button"
          onClick={onReturn}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-blue-700 px-6 py-3 text-base font-bold text-white transition-colors hover:bg-blue-800"
        >
          <Maximize className="h-5 w-5" />
          Return to full screen
        </button>
      </div>
    </div>
  );
}
