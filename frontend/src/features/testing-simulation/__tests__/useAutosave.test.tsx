/**
 * The autosave must never silently drop an answer.
 *
 * A student's answer reaching the server is the whole contract: `save_attempt`
 * REPLACES the module's answer map, and anything the server never received is
 * graded "Omitted". These tests drive the real hook through the timeline that
 * happens on a slow phone — type, save starts, type again before it lands — and
 * assert the second answer still reaches the server.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAutosave } from "../hooks/useAutosave";
import type { Attempt } from "../types";
import { readDraft } from "../services/draftStore";

const MODULE_ID = 10;
const ATTEMPT_ID = 77;
/** Grid-in (student-produced response) question — answered by typing, not clicking. */
const SPR_QID = "3";

function makeAttempt(version = 1): Attempt {
  return {
    id: ATTEMPT_ID,
    current_state: "MODULE_1_ACTIVE",
    is_completed: false,
    version_number: version,
    current_module_details: {
      id: MODULE_ID,
      module_order: 1,
      // The autosave reads `is_math_input` to tell a discrete choice (send it at
      // once) from free text (coalesce the keystrokes).
      questions: [
        { id: 1, is_math_input: false },
        { id: 2, is_math_input: false },
        { id: Number(SPR_QID), is_math_input: true },
      ],
    },
  } as unknown as Attempt;
}

/**
 * Minimal hook harness — avoids pulling in a testing-library dependency.
 *
 * `applyAttempt` re-renders with the server's snapshot, exactly as ExamRunnerPage
 * does. That matters: the response bumps version_number, which is an effect dep,
 * so applying it re-runs the effect. A harness that stubs applyAttempt as a no-op
 * silently removes that recovery path and invents a bug that isn't there.
 */
function renderAutosave(initialProps: Parameters<typeof useAutosave>[0]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  let props = initialProps;

  function Probe(p: { args: Parameters<typeof useAutosave>[0] }) {
    useAutosave(p.args);
    return null;
  }

  const render = () =>
    act(() => {
      root.render(<Probe args={props} />);
    });

  act(() => {
    root = createRoot(container);
    root.render(<Probe args={props} />);
  });

  return {
    rerender(next: Partial<Parameters<typeof useAutosave>[0]>) {
      props = { ...props, ...next };
      render();
    },
    /** What ExamRunnerPage's applyAttempt does: adopt the snapshot and re-render. */
    applyAttempt(next: Attempt) {
      props = { ...props, attempt: next };
      root.render(<Probe args={props} />);
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("useAutosave — an answer must never be dropped", () => {
  let saved: Array<Record<string, string>>;
  let resolvers: Array<() => void>;
  let api: { saveAttempt: ReturnType<typeof vi.fn>; saveAttemptKeepalive: ReturnType<typeof vi.fn> };
  let version: number;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    saved = [];
    resolvers = [];
    version = 1;
    // A save that we resolve by hand, so we control the in-flight window.
    api = {
      saveAttempt: vi.fn((_id: number, answers: Record<string, string>) => {
        saved.push({ ...answers });
        return new Promise((resolve) => {
          resolvers.push(() => {
            version += 1; // the server bumps version_number on every save
            resolve(makeAttempt(version));
          });
        });
      }),
      saveAttemptKeepalive: vi.fn(),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Mount the hook the way ExamRunnerPage does, with Q1 already answered. */
  function setup() {
    const held: { h: ReturnType<typeof renderAutosave> | null } = { h: null };
    held.h = renderAutosave({
      attempt: makeAttempt(1),
      attemptId: ATTEMPT_ID,
      answers: { "1": "A" },
      flagged: [],
      answersModuleId: MODULE_ID,
      // Mirror the real page: adopt the server snapshot so version_number advances.
      applyAttempt: (next: Attempt) => held.h?.applyAttempt(next),
      enabled: true,
      online: true,
      api: api as unknown as Parameters<typeof useAutosave>[0]["api"],
      debounceMs: 500,
    });
    return held.h;
  }

  /** Q2 must survive somewhere — the server, or the draft that can restore it. */
  function expectQ2Recoverable() {
    const draft = readDraft(ATTEMPT_ID, MODULE_ID);
    const onServer = saved.some((s) => s["2"] === "B");
    expect(
      onServer || draft?.answers["2"] === "B",
      `Q2 was answered but exists in neither the server payloads (${JSON.stringify(saved)}) nor the draft (${JSON.stringify(draft)}) — unrecoverable, and it will grade Omitted`,
    ).toBe(true);
  }

  it("sends an answer typed while an earlier save is still in flight", async () => {
    const h = setup();

    // t=500: the first save fires and is now in flight (slow network).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(api.saveAttempt).toHaveBeenCalledTimes(1);
    expect(saved[0]).toEqual({ "1": "A" });

    // t=600: the student answers a second question while save #1 is still open.
    h.rerender({ answers: { "1": "A", "2": "B" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500); // its debounce elapses at t=1100
    });

    // t=1300: save #1 finally lands.
    await act(async () => {
      resolvers[0]?.();
      await vi.advanceTimersByTimeAsync(0);
    });

    // Nothing further happens — the student simply stops typing. Give the hook
    // every chance to catch up.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    const everySent = saved.flatMap((s) => Object.entries(s));
    expect(
      everySent.some(([qid, v]) => qid === "2" && v === "B"),
      `Q2 was answered but never reached the server. Sent payloads: ${JSON.stringify(saved)}`,
    ).toBe(true);

    h.unmount();
  });

  it("never strands an answer once autosave is switched off mid-flight", async () => {
    // The real loss path, and the one the teacher hit. Leaving the tab auto-pauses
    // the attempt, which used to flip ExamRunnerPage's `enabled` to false. That
    // killed the effect re-run that normally re-sends a pending answer, while an
    // already-in-flight save could still resolve and wipe the draft — leaving Q2
    // in no server map and no draft, to be graded Omitted.
    const h = setup();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(saved).toEqual([{ "1": "A" }]); // save #1 in flight, carries Q1 only

    // Student answers Q2, then leaves -> auto-pause disables the autosave.
    h.rerender({ answers: { "1": "A", "2": "B" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    h.rerender({ enabled: false });

    // The in-flight save #1 now lands.
    await act(async () => {
      resolvers[0]?.();
      await vi.advanceTimersByTimeAsync(5000);
    });

    expectQ2Recoverable();
    h.unmount();
  });

  it("adopts the canonical attempt from a 409 and re-sends with the fresh version", async () => {
    // The keepalive leave-flush and pause both bump the server version without
    // this hook's closure ever seeing it (they are fire-and-forget). The next
    // debounced save then carries a stale expected_version and gets a HARD 409
    // that writes nothing. Retrying blind with the SAME captured version can
    // only 409 again — the prod "409 burst" (initial + 3 backoff retries, all
    // stale). The hook must adopt the canonical attempt the 409 body carries so
    // the effect re-sends against the fresh version.
    const calls: Array<number | undefined> = [];
    let serverVersion = 5; // where the keepalive already moved the server
    const api409 = {
      saveAttempt: vi.fn(
        (_id: number, answers: Record<string, string>, _f: number[], opts?: { expectedVersionNumber?: number }) => {
          calls.push(opts?.expectedVersionNumber);
          saved.push({ ...answers });
          if ((opts?.expectedVersionNumber ?? 0) < serverVersion) {
            return Promise.reject({ response: { status: 409, data: { attempt: makeAttempt(serverVersion) } } });
          }
          serverVersion += 1;
          return Promise.resolve(makeAttempt(serverVersion));
        },
      ),
    };

    const held: { h: ReturnType<typeof renderAutosave> | null } = { h: null };
    held.h = renderAutosave({
      attempt: makeAttempt(1),
      attemptId: ATTEMPT_ID,
      answers: { "1": "A" },
      flagged: [],
      answersModuleId: MODULE_ID,
      applyAttempt: (next: Attempt) => held.h?.applyAttempt(next),
      enabled: true,
      online: true,
      api: api409 as unknown as Parameters<typeof useAutosave>[0]["api"],
      debounceMs: 500,
    });
    const h = held.h;

    // t=500: save #1 fires with the stale version (1 < 5) and 409s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    // Adoption re-runs the effect (version 1 -> 5); its debounce re-sends. Give
    // the old blind backoff retries (2s/4s/8s) room to fire if they still existed.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });

    expect(api409.saveAttempt.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[0]).toBe(1);
    expect(
      calls[1],
      `the send after the 409 must carry the version adopted from its body; sent versions: ${JSON.stringify(calls)}`,
    ).toBe(5);
    expect(
      calls.filter((v) => v === 1).length,
      `the stale version must never be re-sent blind; sent versions: ${JSON.stringify(calls)}`,
    ).toBe(1);
    h.unmount();
  });

  it("keeps the local draft until the answers in it have actually been sent", async () => {
    const h = setup();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    // Second answer lands in the draft while save #1 is in flight.
    h.rerender({ answers: { "1": "A", "2": "B" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    // Save #1 carried Q1 only — completing it must not drop Q2's draft.
    await act(async () => {
      resolvers[0]?.();
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expectQ2Recoverable();
    h.unmount();
  });
});

/**
 * "har bir savol save bo'lsin" — every answer must reach the server.
 *
 * The old policy was a flat 1500ms debounce for everything, so an answer chosen
 * in the last 1.5s of a module existed ONLY in this tab until the submit payload
 * happened to carry it. These tests pin the replacement: a choice goes out at
 * once, typing is coalesced but never hoarded, and a submit takes over the
 * pending work instead of cancelling it.
 */
describe("useAutosave — an answer must reach the server without waiting out a debounce", () => {
  let saved: Array<Record<string, string>>;
  let resolvers: Array<() => void>;
  let api: { saveAttempt: ReturnType<typeof vi.fn>; saveAttemptKeepalive: ReturnType<typeof vi.fn> };
  let version: number;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    saved = [];
    resolvers = [];
    version = 1;
    api = {
      saveAttempt: vi.fn((_id: number, answers: Record<string, string>) => {
        saved.push({ ...answers });
        return new Promise((resolve) => {
          resolvers.push(() => {
            version += 1;
            resolve(makeAttempt(version));
          });
        });
      }),
      saveAttemptKeepalive: vi.fn(),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Mount as a MIDTERM does: no `debounceMs`, so the hook's long default (1500ms)
   * applies to anything that isn't a deliberate answer. Starting with no answers
   * mirrors a fresh module.
   */
  function setup(overrides: Partial<Parameters<typeof useAutosave>[0]> = {}) {
    const held: { h: ReturnType<typeof renderAutosave> | null } = { h: null };
    held.h = renderAutosave({
      attempt: makeAttempt(1),
      attemptId: ATTEMPT_ID,
      answers: {},
      flagged: [],
      answersModuleId: MODULE_ID,
      applyAttempt: (next: Attempt) => held.h?.applyAttempt(next),
      enabled: true,
      online: true,
      api: api as unknown as Parameters<typeof useAutosave>[0]["api"],
      ...overrides,
    });
    return held.h!;
  }

  const tick = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  it("sends a multiple-choice selection immediately, not after the long debounce", async () => {
    const h = setup();

    // The student clicks a choice. Under the old flat debounce this sat in the
    // browser for 1500ms — long enough for the module timer to expire with the
    // answer nowhere but this tab.
    h.rerender({ answers: { "1": "A" } });
    await tick(50);

    expect(
      api.saveAttempt,
      "a selected choice must be on its way to the server well inside the old 1500ms debounce",
    ).toHaveBeenCalledTimes(1);
    expect(saved[0]).toEqual({ "1": "A" });

    h.unmount();
  });

  it("keeps sending each further selection promptly", async () => {
    const h = setup();
    h.rerender({ answers: { "1": "A" } });
    await tick(50);
    await act(async () => {
      resolvers[0]?.();
      await vi.advanceTimersByTimeAsync(0);
    });

    // Second question answered. Only the rate floor applies — never the debounce.
    h.rerender({ answers: { "1": "A", "2": "C" } });
    await tick(400);

    expect(
      saved.some((s) => s["2"] === "C"),
      `the second selection never reached the server: ${JSON.stringify(saved)}`,
    ).toBe(true);
    h.unmount();
  });

  it("coalesces grid-in keystrokes into one request instead of one per character", async () => {
    const h = setup();

    // Typing "125" into a student-produced-response box, one character per 100ms.
    h.rerender({ answers: { [SPR_QID]: "1" } });
    await tick(100);
    h.rerender({ answers: { [SPR_QID]: "12" } });
    await tick(100);
    h.rerender({ answers: { [SPR_QID]: "125" } });
    await tick(100);

    expect(api.saveAttempt, "typing must not fire a request per keystroke").not.toHaveBeenCalled();

    await tick(400);
    expect(api.saveAttempt).toHaveBeenCalledTimes(1);
    expect(saved[0]).toEqual({ [SPR_QID]: "125" });
    h.unmount();
  });

  it("never hoards a grid-in answer past the max wait, however long the student keeps typing", async () => {
    const h = setup();

    // A character every 300ms forever would never settle a pure debounce.
    h.rerender({ answers: { [SPR_QID]: "1" } });
    await tick(300);
    h.rerender({ answers: { [SPR_QID]: "1/" } });
    await tick(300);
    h.rerender({ answers: { [SPR_QID]: "1/2" } });
    await tick(300);
    h.rerender({ answers: { [SPR_QID]: "1/23" } });
    await tick(350);

    expect(
      api.saveAttempt,
      "a continuously-typed answer must still be sent within the max wait",
    ).toHaveBeenCalled();
    expect(saved[0][SPR_QID]).toBe("1/23");
    h.unmount();
  });

  it("leaves flag toggles on the long debounce — they are not graded", async () => {
    const h = setup({ answers: { "1": "A" } });
    await tick(1500);
    expect(api.saveAttempt).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolvers[0]?.();
      await vi.advanceTimersByTimeAsync(0);
    });

    h.rerender({ flagged: [1] });
    await tick(100);
    expect(api.saveAttempt, "a flag toggle must not trigger an immediate save").toHaveBeenCalledTimes(1);

    await tick(1500);
    expect(api.saveAttempt).toHaveBeenCalledTimes(2);
    h.unmount();
  });

  it("stops re-sending a payload the server has already accepted", async () => {
    // Every accepted save bumps version_number, which re-runs the effect. Left
    // unchecked that is an endless save loop — and version churn is exactly what
    // turns a concurrent keepalive or pause into the prod 409 burst.
    const h = setup({ answers: { "1": "A" } });
    await tick(1500);
    await act(async () => {
      resolvers[0]?.();
      await vi.advanceTimersByTimeAsync(0);
    });

    await tick(20000);
    expect(api.saveAttempt).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  it("writes NOTHING once a submit has started", async () => {
    // There was briefly a "hand-off" here (one last saveAttemptKeepalive before standing
    // down). It was inert on midterms — the keepalive body sets `background: true`, and the
    // server banks nothing from a background flush past the deadline, which is the only time
    // a midterm submits — and on pastpapers/mocks it was an unversioned, un-module-targeted
    // write racing the real submit, i.e. the shape of the "Module 2 skip" incident.
    // Answers are safe without it: each one is sent the moment it is given, the submit
    // payload carries the map, and the local draft survives a crash.
    const h = setup({ answers: { "1": "A" } });
    await tick(1500);
    await act(async () => {
      resolvers[0]?.();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(saved).toEqual([{ "1": "A" }]);

    // An answer and the submit land in the same commit, then more re-renders follow.
    h.rerender({ answers: { "1": "A", "2": "B" }, submitting: true });
    h.rerender({ flagged: [] });
    await tick(5000);

    expect(api.saveAttemptKeepalive).not.toHaveBeenCalled();
    expect(saved).toEqual([{ "1": "A" }]); // no second save issued behind the submit
    h.unmount();
  });

  it("writes NOTHING from a suspended tab, even during a submit", async () => {
    // `enabled: false` means a blocked duplicate tab or a mid-transition frame:
    // these answers are stale or belong to another module, and save_attempt
    // REPLACES the map — writing here destroys the primary tab's real work.
    const h = setup({ answers: { "1": "A" } });
    await tick(1500);
    await act(async () => {
      resolvers[0]?.();
      await vi.advanceTimersByTimeAsync(0);
    });

    h.rerender({ answers: { "1": "A", "2": "B" }, enabled: false, submitting: true });
    await tick(5000);

    expect(api.saveAttemptKeepalive).not.toHaveBeenCalled();
    expect(api.saveAttempt).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  it("does not blast the freshly-rehydrated answer map at the server", async () => {
    // On resume, `answers` goes {} -> the whole restored map in one step. That is
    // not a student answering, and treating it as one would fire an instant save
    // (and a version bump) on every module load.
    const h = setup();
    h.rerender({ answers: { "1": "A", "2": "B", [SPR_QID]: "7" } });
    await tick(100);
    expect(api.saveAttempt).not.toHaveBeenCalled();
    h.unmount();
  });
});
