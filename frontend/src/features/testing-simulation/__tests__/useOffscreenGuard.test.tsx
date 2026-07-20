/**
 * The off-screen rule costs a student a third of their allowance per offence, so the client
 * half is only correct if it reports what actually happened — no more and no less.
 *
 * Everything here is about the boundary between "the student left" and "the browser fired an
 * event": one alt-tab emits visibilitychange AND blur (and often fullscreenchange), the
 * runner enters fullscreen by itself on Start, and a retried report must not burn two of the
 * three chances. The count itself is the server's and is never asserted as client state.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useOffscreenGuard, type OffscreenGuard } from "../hooks/useOffscreenGuard";
import {
  markSelfFullscreenTransition,
  resetSelfFullscreenTransition,
  SELF_FULLSCREEN_SETTLE_MS,
} from "../tools/fullscreenIntent";
import type { Attempt } from "../types";

vi.mock("@/lib/midtermApi", () => ({
  midtermApi: { reportOffscreen: vi.fn() },
}));
import { midtermApi } from "@/lib/midtermApi";

const ATTEMPT_ID = 501;
const report = midtermApi.reportOffscreen as unknown as ReturnType<typeof vi.fn>;

/** Minimal midterm snapshot carrying the proctoring block the serializer sends. */
function makeAttempt(over: Record<string, unknown> = {}): Attempt {
  return {
    id: ATTEMPT_ID,
    current_state: "MODULE_1_ACTIVE",
    version_number: 1,
    is_completed: false,
    offscreen_violations: 0,
    offscreen_limit: 3,
    offscreen_grace_seconds: 3,
    terminated_reason: "",
    ...over,
  } as unknown as Attempt;
}

function renderGuard(initial: Parameters<typeof useOffscreenGuard>[0]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  let props = initial;
  const state: { last: OffscreenGuard | null } = { last: null };

  function Probe(p: { args: Parameters<typeof useOffscreenGuard>[0] }) {
    state.last = useOffscreenGuard(p.args);
    return null;
  }

  act(() => {
    root = createRoot(container);
    root.render(<Probe args={props} />);
  });

  return {
    get current(): OffscreenGuard {
      return state.last as OffscreenGuard;
    },
    rerender(next: Partial<Parameters<typeof useOffscreenGuard>[0]>) {
      props = { ...props, ...next };
      act(() => {
        root.render(<Probe args={props} />);
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("useOffscreenGuard — report exactly what the student did", () => {
  let hidden: boolean;
  let focused: boolean;
  let fsElement: Element | null;

  beforeEach(() => {
    vi.useFakeTimers();
    report.mockReset();
    resetSelfFullscreenTransition();
    hidden = false;
    focused = true;
    fsElement = null;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fsElement,
    });
    vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
    report.mockResolvedValue({ violations: 1, grace_seconds: 3, terminated: false, limit: 3 });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Arm the guard: the runner settles into the paper before the rule applies. */
  async function arm(h: ReturnType<typeof renderGuard>) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    return h;
  }

  /** One alt-tab, as the browser really delivers it: several events, one absence. */
  async function leave() {
    hidden = true;
    focused = false;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("blur"));
      await vi.advanceTimersByTimeAsync(500); // past the confirmation delay
    });
  }

  async function comeBack() {
    hidden = false;
    focused = true;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  function mount(over: Record<string, unknown> = {}) {
    return renderGuard({
      attemptId: ATTEMPT_ID,
      attempt: makeAttempt(over),
      enabled: true,
      applyAttempt: () => {},
    });
  }

  it("reports ONE offence for a single alt-tab, not one per event type", async () => {
    const h = await arm(mount());
    await leave();

    expect(report).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  it("keeps one idempotency key for one absence, so a repeat event can't burn two chances", async () => {
    const h = await arm(mount());
    await leave();
    // The tab fires more of the same while they're still away.
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("blur"));
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(report).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  it("does not fire while the runner is still settling into fullscreen", async () => {
    // The Start button enters fullscreen itself, and that transition emits the same events
    // as a student leaving. Nothing in the arming window may be charged to the student.
    const h = mount();
    hidden = true;
    focused = false;
    await act(async () => {
      document.dispatchEvent(new Event("fullscreenchange"));
      window.dispatchEvent(new Event("blur"));
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(report).not.toHaveBeenCalled();
    h.unmount();
  });

  it("runs the server's grace as a countdown and dismisses it when they return in time", async () => {
    const h = await arm(mount());
    await leave();
    expect(h.current.countdown).toBe(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(h.current.countdown).toBe(2);

    await comeBack();
    expect(h.current.countdown).toBeNull();
    // The offence still stands — they need to know it cost them something.
    expect(h.current.notice).toContain("chances left");
    expect(report).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  it("escalates with a FRESH key when the grace runs out and they are still away", async () => {
    const h = await arm(mount());
    await leave();
    const firstKey = report.mock.calls[0][1];

    report.mockResolvedValue({ violations: 2, grace_seconds: 3, terminated: false, limit: 3 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });

    expect(report).toHaveBeenCalledTimes(2);
    const secondKey = report.mock.calls[1][1];
    expect(secondKey).not.toBe(firstKey); // a new offence, not a retry of the old one
    h.unmount();
  });

  it("stops dead once the server says the sitting is terminated", async () => {
    const h = await arm(mount());
    report.mockResolvedValue({ violations: 3, grace_seconds: 0, terminated: true, limit: 3 });
    await leave();

    expect(h.current.terminated).toBe(true);
    expect(h.current.countdown).toBeNull();

    // Whatever the browser does next, the paper is already in — no more reports.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("blur"));
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(report).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  it("takes the offence count from the server snapshot, so a refresh can't reset it", async () => {
    // Exactly what a student gaming the rule tries: reload with two offences already spent.
    const h = mount({ offscreen_violations: 2 });
    expect(h.current.violations).toBe(2);
    expect(h.current.chancesLeft).toBe(1);

    // A stale poll taken before the last offence must not hand a chance back.
    h.rerender({ attempt: makeAttempt({ offscreen_violations: 1 }) });
    expect(h.current.violations).toBe(2);
    h.unmount();
  });

  it("shows the terminal state for an attempt the rule already ended", async () => {
    const h = mount({ terminated_reason: "OFFSCREEN", current_state: "COMPLETED", is_completed: true });
    expect(h.current.terminated).toBe(true);
    h.unmount();
  });

  it("still warns the student when the report never reaches the server", async () => {
    report.mockRejectedValue(new Error("offline"));
    const h = await arm(mount());
    await leave();

    expect(h.current.countdown).toBe(3); // mirrored grace, so the UI isn't silent
    h.unmount();
  });

  // ── the warning must never outlive the absence ──────────────────────────────

  it("does not strand a warning over the paper when the report lands after they return", async () => {
    // The lockout: the POST is still in flight when the student comes back, so the reply
    // (grace, not terminated) arrives for an absence that is already over. Starting its
    // countdown puts an overlay over the questions that nothing can dismiss — the student
    // can only escape by leaving the exam again, which costs them another chance.
    let settle: ((v: unknown) => void) | null = null;
    report.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );

    const h = await arm(mount());
    await leave(); // report in flight, no reply yet
    await comeBack(); // back at the paper before the reply lands

    await act(async () => {
      settle?.({ violations: 1, grace_seconds: 3, terminated: false, limit: 3 });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(h.current.countdown).toBeNull();

    // ...and it must not reappear as a countdown that freezes on zero either.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(h.current.countdown).toBeNull();
    expect(report).toHaveBeenCalledTimes(1); // the phantom grace never escalated
    h.unmount();
  });

  it("counts a second absence on its own terms after a late reply from the first", async () => {
    // The stale reply is dropped, not the student's next leave: the guard must still be
    // able to report the absence that comes after it.
    let settle: ((v: unknown) => void) | null = null;
    report.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const h = await arm(mount());
    await leave();
    await comeBack();
    await act(async () => {
      settle?.({ violations: 1, grace_seconds: 3, terminated: false, limit: 3 });
      await vi.advanceTimersByTimeAsync(0);
    });

    report.mockResolvedValue({ violations: 2, grace_seconds: 3, terminated: false, limit: 3 });
    await leave();
    expect(report).toHaveBeenCalledTimes(2);
    expect(h.current.countdown).toBe(3);
    h.unmount();
  });

  it("takes the server's forfeit even when it arrives after the student is back", async () => {
    // Staleness is only a reason to drop the UI countdown. The paper being taken in is the
    // server's word and stands whenever it lands.
    let settle: ((v: unknown) => void) | null = null;
    report.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const h = await arm(mount({ offscreen_violations: 2 }));
    await leave();
    await comeBack();
    await act(async () => {
      settle?.({ violations: 3, grace_seconds: 0, terminated: true, limit: 3 });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(h.current.terminated).toBe(true);
    expect(h.current.countdown).toBeNull();
    h.unmount();
  });

  // ── the runner's own fullscreen transitions ─────────────────────────────────

  it("does not charge the student for a fullscreen transition the runner asked for", async () => {
    fsElement = document.documentElement; // sitting the paper in fullscreen
    const h = await arm(mount());

    await act(async () => {
      markSelfFullscreenTransition(); // what useFullscreen.enter()/exit() do
      fsElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
      await vi.advanceTimersByTimeAsync(500); // past the confirmation delay
    });
    expect(report).not.toHaveBeenCalled();
    h.unmount();
  });

  it("charges a student who is still outside fullscreen once the transition has settled", async () => {
    // The pardon above covers the transition, not the state it leaves behind — otherwise
    // the header's fullscreen toggle would be a free pass to sit next to your notes. No
    // further browser event is coming, so the guard has to re-check on its own.
    fsElement = document.documentElement;
    const h = await arm(mount());

    await act(async () => {
      markSelfFullscreenTransition();
      fsElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
      await vi.advanceTimersByTimeAsync(SELF_FULLSCREEN_SETTLE_MS + 500);
    });
    expect(report).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  it("charges an unmarked drop out of fullscreen straight away (Esc is the student)", async () => {
    fsElement = document.documentElement;
    const h = await arm(mount());

    await act(async () => {
      fsElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(report).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  // ── the count is the server's ───────────────────────────────────────────────

  it("adopts the server's offence number instead of counting locally", async () => {
    // A second tab or an earlier sitting may have spent chances this client never saw.
    const h = await arm(mount({ offscreen_violations: 1 }));
    report.mockResolvedValue({ violations: 3, grace_seconds: 3, terminated: false, limit: 3 });
    await leave();

    expect(h.current.violations).toBe(3);
    expect(h.current.chancesLeft).toBe(0);
    h.unmount();
  });

  // ── a report that never got an answer ───────────────────────────────────────

  it("retries a failed report under the SAME key, so one absence can't burn two chances", async () => {
    // A lost reply is indistinguishable from a lost request, so the offence may already be
    // recorded. Reusing the key lets the server dedupe it; a fresh one would charge twice.
    report.mockRejectedValue(new Error("offline"));
    const h = await arm(mount());
    await leave();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500); // mirrored grace runs out, still away
    });
    expect(report).toHaveBeenCalledTimes(2);
    expect(report.mock.calls[1][1]).toBe(report.mock.calls[0][1]);
    h.unmount();
  });

  it("clears the mirrored warning the moment they return from a failed report", async () => {
    // Failing to reach the server must not be worse for the student than reaching it.
    report.mockRejectedValue(new Error("offline"));
    const h = await arm(mount());
    await leave();
    expect(h.current.countdown).toBe(3);

    await comeBack();
    expect(h.current.countdown).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(h.current.countdown).toBeNull();
    expect(report).toHaveBeenCalledTimes(1); // nothing escalates once they are back
    h.unmount();
  });
});
