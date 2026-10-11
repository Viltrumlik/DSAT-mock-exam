/**
 * The midterm wake lock (2026-10-11, the school's request): a display that sleeps after
 * inactivity reads as the page going hidden, and the off-screen guard spends a strike on it.
 *
 * Everything the hook promises is about the edges, so that is what is pinned here: it asks
 * only while visible, re-asks after the browser lets go on a hide, lets go itself the moment
 * the paper is in (including a request still in flight), and never throws into the exam when
 * the API is missing or says no.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useScreenWakeLock } from "../hooks/useScreenWakeLock";

/** A WakeLockSentinel as the browser hands it out: an EventTarget that fires "release" once. */
class FakeSentinel extends EventTarget {
  released = false;
  readonly type = "screen" as const;
  release = vi.fn(async () => {
    this.drop();
  });
  /** The browser letting go by itself (page hidden) — the same event, without our call. */
  drop() {
    if (this.released) return;
    this.released = true;
    this.dispatchEvent(new Event("release"));
  }
}

function renderLock(initial: boolean) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;

  function Probe({ active }: { active: boolean }) {
    useScreenWakeLock(active);
    return null;
  }

  act(() => {
    root = createRoot(container);
    root.render(<Probe active={initial} />);
  });

  return {
    rerender(active: boolean) {
      act(() => {
        root.render(<Probe active={active} />);
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** Let resolved request promises run their `.then`s. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useScreenWakeLock — keep a midterm's display awake, best-effort", () => {
  let visible: boolean;
  let sentinels: FakeSentinel[];
  let request: ReturnType<typeof vi.fn>;
  const hadWakeLock = "wakeLock" in navigator;

  beforeEach(() => {
    visible = true;
    sentinels = [];
    Object.defineProperty(document, "hidden", { configurable: true, get: () => !visible });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (visible ? "visible" : "hidden"),
    });
    request = vi.fn(async (_type: string) => {
      const s = new FakeSentinel();
      sentinels.push(s);
      return s;
    });
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });
  });

  afterEach(() => {
    // The stubs are own properties shadowing jsdom's prototype getters; deleting them restores
    // jsdom's own document.hidden / visibilityState and its (absent) wakeLock.
    delete (document as unknown as Record<string, unknown>).hidden;
    delete (document as unknown as Record<string, unknown>).visibilityState;
    delete (navigator as unknown as Record<string, unknown>).wakeLock;
    expect("wakeLock" in navigator).toBe(hadWakeLock);
    vi.restoreAllMocks();
  });

  async function setVisible(next: boolean) {
    visible = next;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
  }

  it("asks for a screen lock as soon as it is active on a visible page", async () => {
    const h = renderLock(true);
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("screen");
    h.unmount();
  });

  it("does nothing while inactive", async () => {
    const h = renderLock(false);
    await flush();
    expect(request).not.toHaveBeenCalled();
    h.unmount();
  });

  it("does not ask while the page is hidden, and asks once it is visible again", async () => {
    visible = false;
    const h = renderLock(true);
    await flush();
    expect(request).not.toHaveBeenCalled();

    await setVisible(true);
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  it("re-asks on hidden → visible after the browser released the lock", async () => {
    const h = renderLock(true);
    await flush();
    expect(request).toHaveBeenCalledTimes(1);

    // Alt-tab: the browser drops the lock itself and fires "release" on the sentinel.
    visible = false;
    sentinels[0].drop();
    await setVisible(false);
    expect(request).toHaveBeenCalledTimes(1);

    await setVisible(true);
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    h.unmount();
  });

  it("does not stack a second lock while the first is still held", async () => {
    const h = renderLock(true);
    await flush();
    await setVisible(true); // a spurious visible → visible
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  it("releases the lock when the paper is in (deactivation)", async () => {
    const h = renderLock(true);
    await flush();
    expect(sentinels[0].release).not.toHaveBeenCalled();

    h.rerender(false);
    expect(sentinels[0].release).toHaveBeenCalledTimes(1);

    // And it stays let go: coming back to the page asks for nothing.
    await setVisible(false);
    await setVisible(true);
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  it("releases the lock on unmount and stops listening", async () => {
    const h = renderLock(true);
    await flush();
    h.unmount();
    expect(sentinels[0].release).toHaveBeenCalledTimes(1);

    await setVisible(false);
    await setVisible(true);
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("releases a lock whose request was still in flight at unmount", async () => {
    let resolve!: (s: FakeSentinel) => void;
    request.mockImplementationOnce(
      () =>
        new Promise<FakeSentinel>((r) => {
          resolve = r;
        }),
    );
    const h = renderLock(true);
    expect(request).toHaveBeenCalledTimes(1);
    h.unmount();

    const late = new FakeSentinel();
    await act(async () => {
      resolve(late);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(late.release).toHaveBeenCalledTimes(1);
  });

  it("asks again when the page came back while a request was in flight and it lost the race", async () => {
    let resolve!: (s: FakeSentinel) => void;
    request.mockImplementationOnce(
      () =>
        new Promise<FakeSentinel>((r) => {
          resolve = r;
        }),
    );
    const h = renderLock(true);
    expect(request).toHaveBeenCalledTimes(1);

    // Hidden and back before the first answer lands; that answer is a lock already let go.
    await setVisible(false);
    await setVisible(true);
    expect(request).toHaveBeenCalledTimes(1);
    const stale = new FakeSentinel();
    stale.drop();
    await act(async () => {
      resolve(stale);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(request).toHaveBeenCalledTimes(2);
    h.unmount();
  });

  it("is a no-op where the browser has no Wake Lock API", async () => {
    delete (navigator as unknown as Record<string, unknown>).wakeLock;
    expect("wakeLock" in navigator).toBe(false);
    const h = renderLock(true);
    await flush();
    await setVisible(false);
    await setVisible(true);
    h.rerender(false);
    h.unmount();
    expect(request).not.toHaveBeenCalled();
  });

  // An escaped rejection here would surface as vitest's "Unhandled Rejection" and fail the run,
  // so passing is itself the proof that the refusal was swallowed.
  it("swallows a refused request (power saving, policy) and tries again on the next visible", async () => {
    request.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    const h = renderLock(true);
    await flush();
    expect(request).toHaveBeenCalledTimes(1);

    await setVisible(false);
    await setVisible(true);
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    h.unmount();
    await flush();
  });

  it("survives a request that throws synchronously", async () => {
    request.mockImplementationOnce(() => {
      throw new Error("not in this embedder");
    });
    const h = renderLock(true);
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    h.unmount();
  });
});
