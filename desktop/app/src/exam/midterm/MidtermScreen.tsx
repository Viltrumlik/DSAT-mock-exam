/**
 * A midterm in the app, end to end: rules → access code → pre-check → lock + bind → start → the
 * locked runner (heartbeat, off-screen rule, battery) → submitted → released. The screen is
 * DERIVED from the attempt, the server's refusal (if any) and the lockdown state, as the site's
 * runner gate does — never stored — so a resume, a lost lock or a moved session all land on the
 * right screen however they arrive.
 *
 * Three invariants:
 *   - a running paper is never on screen unlocked (resume → the pre-check, in resume mode);
 *   - every way out — done, forfeit, moved, update, an error, unmount — releases the machine;
 *   - a blip never ejects a student: refusals that can be fixed silently (a fresh token) are.
 *
 * Importer: App.tsx.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { Spinner } from "@/components/ui/Spinner";
import { ApiError, displayName, ensureFreshSession, isTransient, me, tokens } from "@/lib/api";
import { DEV_MOCK } from "@/lib/env";
import { ExamRunner } from "../ExamRunner";
import { Centered, DoneScreen } from "../ExamScreen";
import { isRunning, isTerminal, type ExamSource } from "../examApi";
import { DevLockdownPanel } from "../lockdown/DevLockdownPanel";
import {
  AppUpdateRequiredScreen,
  BatteryIndicator,
  ConnectionBanner,
  LockErrorScreen,
  LowBatteryBanner,
  OffscreenNotice,
  OffscreenTerminatedScreen,
  OffscreenWarning,
  PrecheckScreen,
  SessionMovedScreen,
} from "../lockdown/LockdownScreens";
import { DesktopBlockedError, lockdownHeaders, takeUnconfirmedBind } from "../lockdown/session";
import { useBattery } from "../lockdown/useBattery";
import { useLockdown } from "../lockdown/useLockdown";
import { useOffscreenGuard } from "../lockdown/useOffscreenGuard";
import { useExamAttempt } from "../useExamAttempt";
import { MidtermCodeScreen } from "./MidtermCodeScreen";
import { MidtermRulesScreen } from "./MidtermRulesScreen";

type Step = "rules" | "code" | "precheck";

/** How long the forfeit explanation stays before moving on by itself (the site's 6 s). */
const FORFEIT_HOLD_MS = 6000;

/** Before locking, make sure the session outlives a long midterm, so no refresh happens mid-paper. */
const SESSION_RUNWAY_S = 2.5 * 3600;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function MidtermScreen({ source, onExit }: { source: ExamSource; onExit: () => void }) {
  const ex = useExamAttempt(source, { headers: lockdownHeaders, poll: true, retryEarlySubmit: true });
  const lock = useLockdown(ex.attemptId);
  const battery = useBattery();

  const [studentName, setStudentName] = useState("");
  const [step, setStep] = useState<Step>("rules");
  const [requiresCode, setRequiresCode] = useState<boolean | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [forfeitSeen, setForfeitSeen] = useState(false);
  const [rebinding, setRebinding] = useState(false);
  // The bind answered 426: this build is below the server's minimum. Its own screen, not a line of
  // red text under the checklist — the site's update screen was unreachable for exactly that reason.
  const [updateRequired, setUpdateRequired] = useState(false);
  // A pre-check-driven lock + bind is in flight. The silent re-bind must not race it: it would swap
  // the pre-check (and the error it is about to show) for a spinner.
  const bindingRef = useRef(false);

  const a = ex.attempt;
  const id = ex.attemptId;
  const terminal = isTerminal(a);
  const running = isRunning(a);
  const { release } = lock;

  useEffect(() => {
    let alive = true;
    me()
      .then((m) => alive && setStudentName(displayName(m)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const exit = useCallback(() => {
    release();
    onExit();
  }, [release, onExit]);

  // Is an access code needed? Asked once, while the sitting hasn't begun. A 403 means yes; a blip
  // means "assume yes", so no classroom student is told to start without a code they'll be asked for.
  // The answer is kept as a promise too: a student who continues before it lands waits for it,
  // instead of being sent to a code screen they don't need.
  const codeProbe = useRef<Promise<boolean> | null>(null);
  const probeCode = useCallback((): Promise<boolean> => {
    if (!codeProbe.current) {
      codeProbe.current =
        id == null
          ? Promise.resolve(true)
          : ex.api
              .verifyCode(id, "")
              .then((r) => r.requires_code)
              .catch(() => true);
      void codeProbe.current.then((needs) => setRequiresCode(needs));
    }
    return codeProbe.current;
  }, [id, ex.api]);
  useEffect(() => {
    if (id != null && a?.current_state === "NOT_STARTED") void probeCode();
  }, [id, a?.current_state, probeCode]);
  const proceedFromRules = async () => {
    const needs = requiresCode ?? (await probeCode());
    setStep(needs ? "code" : "precheck");
  };

  // The paper is in — however it got there — so the machine is released.
  useEffect(() => {
    if (terminal) release();
  }, [terminal, release]);

  // A refusal mid-paper. Fix what can be fixed silently; release for the rest.
  useEffect(() => {
    const b = ex.blocked;
    if (!b || id == null || rebinding) return;
    const silentRebind = () => {
      setRebinding(true);
      lock
        .rebind(id, ex.api)
        .then(async () => {
          ex.clearBlocked();
          await ex.reload();
        })
        .catch(() => {
          /* left blocked: the pre-check (resume) below takes it from here */
        })
        .finally(() => setRebinding(false));
    };
    if (b === "desktop_required") {
      // The server wants a token this window doesn't hold, mid-paper, while still locked → just
      // fetch one. Not on the resume path (no paper on screen yet): its pre-check binds itself.
      if (lock.locked && running && !bindingRef.current) silentRebind();
    } else if (b === "desktop_session_replaced") {
      // Our OWN last bind may have landed unseen (its reply was lost): re-bind once rather than
      // tell the student the paper moved. Otherwise the newest session wins and we step aside.
      if (lock.locked && takeUnconfirmedBind(id)) silentRebind();
      else release();
    } else if (b === "desktop_update_required") {
      release();
    } else if (b === "desktop_not_live") {
      release();
      void ex.reload().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ex.blocked, id, lock.locked]);

  const guard = useOffscreenGuard({
    attemptId: id ?? 0,
    attempt: a,
    enabled: running && lock.locked && !lock.lost && !transitioning && !ex.blocked && !rebinding,
    applyAttempt: ex.applyAttempt,
    report: ex.reportOffscreen,
  });

  const forfeited = guard.terminated || a?.terminated_reason === "OFFSCREEN";
  useEffect(() => {
    if (!forfeited || forfeitSeen) return;
    const t = setTimeout(() => setForfeitSeen(true), FORFEIT_HOLD_MS);
    return () => clearTimeout(t);
  }, [forfeited, forfeitSeen]);

  // The paper was taken in: release at once, and if the forfeit reply carried no snapshot (a lost
  // reply, then the server's "already in" answer), keep reading until the paper shows as in — the
  // runner must never come back over a submitted paper.
  useEffect(() => {
    if (!forfeited) return;
    release();
    if (terminal) return;
    let cancelled = false;
    void (async () => {
      while (!cancelled) {
        await ex.reload().catch(() => {});
        await sleep(2000);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forfeited, terminal]);

  /**
   * A bind refusal that no amount of retrying fixes gets its own screen: 426 → update the app;
   * 409 not-live → the sitting already ended, so re-read it (it lands on the result).
   * lockAndBind has already released the machine when the bind was required.
   */
  const bindOrRoute = async (requireBind: boolean): Promise<boolean> => {
    if (id == null) return false;
    await ensureFreshSession(SESSION_RUNWAY_S);
    // That refresh may have found the session gone (signed out elsewhere): the app is on its way to
    // the sign-in screen, and the machine must not lock on the way there.
    if (!tokens.has()) return false;
    bindingRef.current = true;
    try {
      await lock.lockAndBind(id, ex.api, { requireBind });
      return true;
    } catch (e) {
      if (e instanceof DesktopBlockedError && e.reason === "desktop_update_required") {
        release();
        setUpdateRequired(true);
        return false;
      }
      if (e instanceof DesktopBlockedError && e.reason === "desktop_not_live") {
        release();
        await ex.reload().catch(() => {});
        return false;
      }
      throw e;
    } finally {
      bindingRef.current = false;
    }
  };

  // "Lock and start": lock, bind, then tell the server to begin — the clock starts only now.
  const beginFromPrecheck = async () => {
    if (id == null || !a) return;
    if (!(await bindOrRoute(a.desktop_required === true))) return;
    try {
      await ex.start();
    } catch (e) {
      if (e instanceof ApiError && e.body?.reason === "code_required") {
        release();
        setRequiresCode(true);
        setStep("code");
        return;
      }
      // Still locked: "Lock and start" can be pressed again (it won't re-lock or re-bind), and
      // "Back" releases. Never a dead end on a locked machine.
      throw e;
    }
  };

  // "Lock and resume": the paper is already running (a restart, or the lock was lost).
  const resumeFromPrecheck = async () => {
    if (id == null) return;
    const requireBind = ex.blocked === "desktop_required" || a?.desktop_required === true;
    if (!(await bindOrRoute(requireBind))) return;
    // Read the snapshot FIRST (riding out a blip), and only then drop the refusal: clearing it before
    // a read that fails left a locked student with no attempt on a misleading "not open" screen.
    for (let i = 0; ; i++) {
      try {
        await ex.reload();
        break;
      } catch (e) {
        if (!isTransient(e) || i >= 3) throw e; // the pre-check shows it; still locked, can retry
        await sleep(800 * (i + 1));
      }
    }
    ex.clearBlocked(); // flushes any answers held back while refused
  };

  const devPanel = DEV_MOCK && import.meta.env.DEV ? <DevLockdownPanel /> : null;
  const screen = (node: JSX.Element) => (
    <>
      {node}
      {devPanel}
    </>
  );

  if (ex.status === "loading") {
    return screen(
      <Centered>
        <Spinner className="h-7 w-7 text-muted-foreground" />
        <p className="text-sm font-semibold text-muted-foreground">Opening your midterm…</p>
      </Centered>,
    );
  }
  if (ex.status === "error") {
    return screen(
      <LockErrorScreen
        title="This midterm couldn’t be opened"
        body="Check your connection and try again. Anything you’ve answered is saved."
        onRetry={ex.retryLoad}
        onHome={exit}
      />,
    );
  }
  // The forfeit explanation stays until BOTH its moment has passed and the paper reads as in.
  if (forfeited && (!forfeitSeen || !terminal)) {
    return screen(<OffscreenTerminatedScreen onContinue={() => setForfeitSeen(true)} />);
  }
  if (terminal && a) return screen(<DoneScreen attempt={a} onExit={exit} />);
  if (rebinding) {
    return screen(
      <Centered>
        <Spinner className="h-7 w-7 text-muted-foreground" />
        <p className="text-sm font-semibold text-muted-foreground">Reconnecting your midterm…</p>
      </Centered>,
    );
  }
  if (ex.blocked === "desktop_session_replaced") return screen(<SessionMovedScreen onHome={exit} />);
  if (updateRequired || ex.blocked === "desktop_update_required") return screen(<AppUpdateRequiredScreen onHome={exit} />);
  if (ex.blocked === "desktop_not_live") {
    return screen(
      <Centered>
        <Spinner className="h-7 w-7 text-muted-foreground" />
        <p className="text-sm font-semibold text-muted-foreground">Checking your midterm…</p>
      </Centered>,
    );
  }

  // A running sitting — or one the server refused as running — is never on screen unlocked.
  const refusedAsRunning = ex.blocked === "desktop_required" || ex.blocked === "desktop_challenge_invalid" || ex.blocked === "desktop_proof_invalid";
  if ((running || (refusedAsRunning && a?.current_state !== "NOT_STARTED")) && (!lock.locked || lock.lost || refusedAsRunning)) {
    return screen(<PrecheckScreen resume onContinue={resumeFromPrecheck} onBack={exit} />);
  }

  if (a?.current_state === "NOT_STARTED" && id != null) {
    if (step === "code") {
      return screen(
        <MidtermCodeScreen
          onSubmitCode={async (code) => {
            await ex.api.verifyCode(id, code);
            setStep("precheck");
          }}
          onBack={() => setStep("rules")}
        />,
      );
    }
    if (step === "precheck") {
      return screen(
        <PrecheckScreen
          resume={false}
          onContinue={beginFromPrecheck}
          onBack={() => {
            release(); // if this screen locked the machine, Back unlocks it (site gap #2)
            setStep("rules");
          }}
        />,
      );
    }
    return screen(
      <MidtermRulesScreen
        attempt={a}
        requiresCode={requiresCode !== false}
        onProceed={() => void proceedFromRules()}
      />,
    );
  }

  if (running && a) {
    return screen(
      <>
        <ExamRunner
          attempt={a}
          mode="midterm"
          studentName={studentName}
          submitting={ex.submitting}
          onSave={ex.save}
          onSubmit={ex.submit}
          onExit={exit}
          inert={guard.countdown !== null}
          headerExtra={<BatteryIndicator battery={battery} />}
          banner={
            <>
              <ConnectionBanner show={ex.connection === "retrying"} />
              <LowBatteryBanner battery={battery} />
            </>
          }
          onTransitionChange={setTransitioning}
        />
        {guard.countdown !== null ? <OffscreenWarning secondsLeft={guard.countdown} chancesLeft={guard.chancesLeft} /> : null}
        {guard.notice ? <OffscreenNotice text={guard.notice} onDismiss={guard.dismissNotice} /> : null}
      </>,
    );
  }

  return screen(
    <LockErrorScreen
      title="This midterm isn’t open right now"
      body="It may have ended or not begun yet. Anything you answered is saved."
      onHome={exit}
    />,
  );
}
