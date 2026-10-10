import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { displayName, me } from "@/lib/api";
import { ExamRunner } from "./ExamRunner";
import { useExamAttempt } from "./useExamAttempt";
import type { ExamSource } from "./examApi";
import type { Attempt } from "./types";

/**
 * A past paper: owns the attempt data (load, autosave, submit) and picks the screen — loading, the
 * runner while a module is active, a "scoring/done" card once it's submitted, or an error with a
 * way back. Past papers are never locked down; a midterm goes through midterm/MidtermScreen.
 * Importers: App.tsx; midterm/MidtermScreen.tsx (Centered, DoneScreen).
 */
export function ExamScreen({ source, onExit }: { source: ExamSource; onExit: () => void }) {
  // A fresh past-paper attempt is NOT_STARTED after create (the server holds the timer), so it is
  // started as soon as it loads.
  const { attempt, status, submitting, save, submit, pause, resume } = useExamAttempt(source, { autoStart: true });
  const [studentName, setStudentName] = useState("");

  // ── Pause (as the site): a real server pause that freezes the clock ──────────
  const [paused, setPaused] = useState(false);
  // Adopt the server's word once per attempt — a paper left with Save & Exit comes back paused.
  const syncedPause = useRef<number | null>(null);
  useEffect(() => {
    if (!attempt || syncedPause.current === attempt.id) return;
    syncedPause.current = attempt.id;
    setPaused(attempt.is_paused);
  }, [attempt]);
  // A new module always begins running (the server clears a pause at the boundary).
  const moduleId = attempt?.current_module_details?.id;
  const prevModule = useRef(moduleId);
  useEffect(() => {
    if (prevModule.current !== undefined && moduleId !== prevModule.current) setPaused(false);
    prevModule.current = moduleId;
  }, [moduleId]);
  const togglePause = async () => {
    const next = !paused;
    setPaused(next); // optimistic: the clock freezes at once
    try {
      await (next ? pause() : resume());
    } catch {
      setPaused(!next);
    }
  };
  // Save & Exit freezes the server clock too, so coming back resumes with the time that was left.
  const saveAndExit = async () => {
    if (!paused) await pause().catch(() => {});
    onExit();
  };
  useEffect(() => {
    let alive = true;
    me()
      .then((m) => alive && setStudentName(displayName(m)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (status === "error") {
    return (
      <Centered>
        <AlertTriangle className="h-10 w-10 text-danger" />
        <p className="max-w-sm text-[15px] font-semibold text-foreground">
          This test couldn’t be opened. Check your connection and try again.
        </p>
        <Button onClick={onExit} variant="secondary">
          Back to your tests
        </Button>
      </Centered>
    );
  }

  if (status === "loading" || !attempt) {
    return (
      <Centered>
        <Spinner className="h-7 w-7 text-muted-foreground" />
        <p className="text-sm font-semibold text-muted-foreground">Opening your test…</p>
      </Centered>
    );
  }

  if (attempt.is_completed || attempt.current_state === "SCORING") {
    return <DoneScreen attempt={attempt} onExit={onExit} />;
  }

  return (
    <ExamRunner
      attempt={attempt}
      studentName={studentName}
      submitting={submitting}
      onSave={save}
      onSubmit={submit}
      onExit={() => void saveAndExit()}
      paused={paused}
      onTogglePause={() => void togglePause()}
    />
  );
}

export function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="ds-app flex min-h-screen flex-col items-center justify-center gap-4 bg-surface-2 px-6 text-center text-foreground">
      {children}
    </div>
  );
}

export function DoneScreen({ attempt, onExit }: { attempt: Attempt; onExit: () => void }) {
  const scoring = attempt.current_state === "SCORING" && !attempt.is_completed;
  return (
    <div className="ds-app flex min-h-screen flex-col items-center justify-center bg-surface-2 px-6 text-foreground">
      <div className="quartz squircle flex w-full max-w-md flex-col items-center gap-4 p-10 text-center">
        {scoring ? (
          <Spinner className="h-12 w-12 text-[#2a68c0]" />
        ) : (
          <CheckCircle2 className="h-14 w-14 text-[#059669]" />
        )}
        <h1 className="text-2xl font-extrabold tracking-tight">{scoring ? "Submitting your test…" : "You’re all done"}</h1>
        <p className="text-[15px] leading-relaxed text-muted-foreground">
          {scoring
            ? "Hang tight while we record your answers."
            : "Your answers were submitted. Your result will appear in Your tests when your teacher releases it."}
        </p>
        {!scoring && attempt.score != null ? (
          <div className="my-1">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground/70">Your score</p>
            <p className="text-[40px] font-extrabold leading-none tracking-tight text-foreground">{attempt.score}</p>
          </div>
        ) : null}
        <Button onClick={onExit} fullWidth size="lg" className="!bg-[#2a68c0] hover:!bg-[#21539e]">
          Back to your tests
        </Button>
      </div>
    </div>
  );
}
