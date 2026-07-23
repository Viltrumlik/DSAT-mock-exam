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

function makeAttempt(version = 1): Attempt {
  return {
    id: ATTEMPT_ID,
    current_state: "MODULE_1_ACTIVE",
    is_completed: false,
    version_number: version,
    current_module_details: { id: MODULE_ID, module_order: 1 },
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
  let api: { saveAttempt: ReturnType<typeof vi.fn> };
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
