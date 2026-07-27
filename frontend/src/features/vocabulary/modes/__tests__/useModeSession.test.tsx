/**
 * The finish endpoint APPENDS what it is given, so the client is only correct if
 * it never hands over the same answer twice — and only useful if it hands over
 * the ones a student gave before walking out. Everything here is about that
 * boundary: what a flush sends, what the completing finish sends after it, and
 * what a failed send owes the next attempt.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionResult, SessionSummary } from "../../types";
import { createResultLedger, useModeSession, type ModeSession } from "../useModeSession";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  finish: vi.fn(),
  flush: vi.fn(),
}));

vi.mock("../../hooks", () => ({
  useStartSession: () => ({ mutateAsync: mocks.start }),
  useFinishSession: () => ({ mutateAsync: mocks.finish }),
}));

vi.mock("../../api", () => ({
  vocabularyApi: { flushSessionPartial: mocks.flush },
}));

const SET_ID = 7;
const SESSION_ID = 4242;

const summary = (): SessionSummary =>
  ({ id: SESSION_ID, mode: "flashcard", set_completed: true }) as unknown as SessionSummary;

/** Mount the hook on its own, the way `useOffscreenGuard`'s test does. */
function renderSession() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  const state: { last: ModeSession | null } = { last: null };

  function Probe() {
    state.last = useModeSession(SET_ID, "flashcard");
    return null;
  }

  act(() => {
    root = createRoot(container);
    root.render(<Probe />);
  });

  return {
    get current(): ModeSession {
      return state.last as ModeSession;
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** Drain the start mutation so the hook has a session id to send against. */
async function booted() {
  const session = renderSession();
  await act(async () => {
    await Promise.resolve();
  });
  return session;
}

const answered = (session: ModeSession, ...ids: number[]) =>
  act(() => {
    ids.forEach((word_id) => session.report({ word_id, correct: true }));
  });

/** The results a given `flushSessionPartial` / `mutateAsync` call carried. */
const flushedAt = (call: number): SessionResult[] => mocks.flush.mock.calls[call][1].results;
const finishedAt = (call: number): SessionResult[] => mocks.finish.mock.calls[call][0].results;

describe("createResultLedger — a result reaches the server exactly once", () => {
  it("hands over only the tail that has not gone out yet", () => {
    const ledger = createResultLedger();
    ledger.append({ word_id: 1, correct: true });
    ledger.append({ word_id: 2, correct: false });
    expect(ledger.take().map((r) => r.word_id)).toEqual([1, 2]);

    ledger.append({ word_id: 3, correct: true });
    expect(ledger.take().map((r) => r.word_id)).toEqual([3]);
    expect(ledger.take()).toEqual([]);
  });

  it("re-queues a batch the server never received", () => {
    const ledger = createResultLedger();
    ledger.append({ word_id: 1, correct: true });
    const failed = ledger.take();
    expect(ledger.unsent).toBe(0);

    ledger.restore(failed);
    expect(ledger.unsent).toBe(1);
    expect(ledger.take().map((r) => r.word_id)).toEqual([1]);
  });
});

describe("useModeSession — an abandoned round records what was answered", () => {
  let visibility: DocumentVisibilityState = "visible";

  /** Backgrounding the tab, as iOS Safari delivers it: no pagehide, ever. */
  const background = () => {
    visibility = "hidden";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
  };

  beforeEach(() => {
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
    mocks.start.mockReset();
    mocks.finish.mockReset();
    mocks.flush.mockReset();
    mocks.start.mockResolvedValue({ id: SESSION_ID, set_id: SET_ID, mode: "flashcard" });
    mocks.finish.mockResolvedValue(summary());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("flushes the answers given so far when the page goes away", async () => {
    const h = await booted();
    answered(h.current, 1, 2, 3);

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(mocks.flush).toHaveBeenCalledTimes(1);
    expect(mocks.flush.mock.calls[0][0]).toBe(SESSION_ID);
    expect(flushedAt(0).map((r) => r.word_id)).toEqual([1, 2, 3]);
    // A flush may never complete the set — that is the server's `partial` flag,
    // owned by the api layer, so the hook must not be asking to finish.
    expect(mocks.finish).not.toHaveBeenCalled();
    h.unmount();
  });

  it("sends only the NEW tail on a second flush", async () => {
    const h = await booted();
    answered(h.current, 1, 2);
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    answered(h.current, 3);
    background();

    expect(mocks.flush).toHaveBeenCalledTimes(2);
    expect(flushedAt(1).map((r) => r.word_id)).toEqual([3]);
    h.unmount();
  });

  it("finishes with only what no flush has sent, and completes even when that is empty", async () => {
    const h = await booted();
    answered(h.current, 1, 2);
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    answered(h.current, 3);
    await act(async () => {
      h.current.finish();
      await Promise.resolve();
    });
    expect(finishedAt(0).map((r) => r.word_id)).toEqual([3]);

    // Everything already flushed, nothing new: the finish still has to happen,
    // because it is what stamps the session complete.
    const h2 = await booted();
    answered(h2.current, 9);
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await act(async () => {
      h2.current.finish();
      await Promise.resolve();
    });
    expect(finishedAt(1)).toEqual([]);
    h.unmount();
    h2.unmount();
  });

  it("stops flushing once the session is graded", async () => {
    const h = await booted();
    answered(h.current, 1);
    await act(async () => {
      h.current.finish();
      await Promise.resolve();
    });

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    background();
    h.unmount();

    expect(mocks.flush).not.toHaveBeenCalled();
    expect(mocks.finish).toHaveBeenCalledTimes(1);
  });

  it("flushes on unmount — leaving by the in-app Back link fires no pagehide", async () => {
    const h = await booted();
    answered(h.current, 1, 2);
    h.unmount();

    expect(mocks.flush).toHaveBeenCalledTimes(1);
    expect(flushedAt(0).map((r) => r.word_id)).toEqual([1, 2]);
  });

  it("re-sends the same tail when the finish request failed", async () => {
    mocks.finish.mockRejectedValueOnce({ status: 500, message: "Server error." });
    const h = await booted();
    answered(h.current, 1, 2);

    await act(async () => {
      h.current.finish();
      await Promise.resolve();
    });
    expect(h.current.error).toBe("Server error.");

    await act(async () => {
      h.current.retry();
      await Promise.resolve();
    });
    expect(finishedAt(1).map((r) => r.word_id)).toEqual([1, 2]);
    expect(h.current.summary).not.toBeNull();
    h.unmount();
  });

  it("ignores a second finish, so a completed round is never graded twice", async () => {
    const h = await booted();
    answered(h.current, 1);
    await act(async () => {
      h.current.finish();
      h.current.finish();
      await Promise.resolve();
    });

    expect(mocks.finish).toHaveBeenCalledTimes(1);
    h.unmount();
  });
});
