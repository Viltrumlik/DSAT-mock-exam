"use client";

import { useState } from "react";
import { KeyRound, ArrowLeft, Maximize } from "lucide-react";
import { SatColorRule } from "./SatColorRule";

interface MidtermCodeScreenProps {
  /** Verify the code and begin. Should reject (throw) on an incorrect code. */
  onSubmitCode: (code: string) => Promise<void>;
  onBack: () => void;
  starting: boolean;
  fullscreenSupported: boolean;
}

/**
 * Access-code gate shown after the midterm rules: the student must enter the
 * 6-digit numeric code the teacher generated ("Start midterm") to begin.
 */
export function MidtermCodeScreen({ onSubmitCode, onBack, starting, fullscreenSupported }: MidtermCodeScreenProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (code.length !== 6 || busy || starting) return;
    setError(null);
    setBusy(true);
    try {
      await onSubmitCode(code);
    } catch {
      setError("That code isn't right. Ask your teacher for the current code.");
      setBusy(false);
    }
  };

  return (
    <div className="flex h-screen flex-col bg-white">
      <SatColorRule />
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
            <KeyRound className="h-7 w-7" />
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">Enter your access code</h1>
          <p className="mt-2 text-sm font-medium text-slate-500">
            Your teacher will read out a 6-digit code. Enter it below to start the midterm.
          </p>

          <input
            inputMode="numeric"
            autoFocus
            value={code}
            onChange={(e) => {
              setError(null);
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
            }}
            onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
            placeholder="••••••"
            aria-label="Access code"
            className="mt-7 w-full rounded-2xl border-2 border-slate-200 bg-slate-50 py-4 text-center text-3xl font-bold tracking-[0.5em] text-slate-900 tabular-nums focus:border-blue-500 focus:outline-none"
          />

          {error ? <p className="mt-3 text-sm font-semibold text-red-600">{error}</p> : null}

          <button
            type="button"
            onClick={() => void submit()}
            disabled={code.length !== 6 || busy || starting}
            className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-full bg-blue-700 px-8 py-3 text-base font-bold text-white transition-colors hover:bg-blue-800 disabled:opacity-50"
          >
            {fullscreenSupported ? <Maximize className="h-5 w-5" /> : null}
            {busy || starting ? "Starting…" : "Verify & begin"}
          </button>

          <button
            type="button"
            onClick={onBack}
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 hover:text-slate-800"
          >
            <ArrowLeft className="h-4 w-4" /> Back to rules
          </button>
        </div>
      </div>
      <SatColorRule />
    </div>
  );
}
