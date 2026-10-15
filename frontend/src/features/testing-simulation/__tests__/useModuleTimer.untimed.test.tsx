/**
 * An untimed practice-test sitting has no clock: the module timer must never anchor, tick or
 * auto-submit, however old the module's start time is.
 */
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useModuleTimer } from "../hooks/useModuleTimer";
import type { ServerClock } from "../hooks/useServerClock";
import type { Attempt } from "../types";

const NOW = new Date("2026-10-15T12:00:00Z").getTime();
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

const clock = {
  sync: () => {},
  now: () => Date.now(),
  offsetMsRef: { current: 0 },
} as unknown as ServerClock;

/** A module whose server anchor is two hours old: by any clock, it ran out long ago. */
const longRunning = (over: Record<string, unknown> = {}) =>
  ({
    id: 1,
    current_state: "MODULE_1_ACTIVE",
    current_module_details: { id: 11, module_order: 1, time_limit_minutes: 35, questions: [] },
    current_module_start_time: new Date(NOW - TWO_HOURS_MS).toISOString(),
    remaining_seconds: null,
    module_duration_seconds: 2100,
    ...over,
  }) as unknown as Attempt;

let container: HTMLDivElement;
let root: Root;
/** Every `ready` the hook has reported, in order. */
const readyLog = vi.fn<(ready: boolean) => void>();
const ready = () => readyLog.mock.calls.at(-1)?.[0] ?? null;

type ProbeProps = { attempt: Attempt; onExpire: () => void; untimed?: boolean };

// One stable component type, so a second `mountTimer` is an UPDATE of the same hook instance
// (a snapshot arriving), not a fresh mount.
function Probe(props: ProbeProps) {
  const { ready: isReady } = useModuleTimer({ clock, paused: false, ...props });
  useEffect(() => {
    readyLog(isReady);
  }, [isReady]);
  return null;
}

function mountTimer(props: ProbeProps) {
  act(() => {
    root.render(<Probe {...props} />);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  readyLog.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("useModuleTimer, untimed", () => {
  it("control: the same attempt, timed, is anchored and expires", () => {
    const onExpire = vi.fn();
    mountTimer({ attempt: longRunning(), onExpire });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(ready()).toBe(true);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("never anchors, never ticks and never auto-submits", () => {
    const onExpire = vi.fn();
    mountTimer({ attempt: longRunning(), onExpire, untimed: true });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(ready()).toBe(false);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("stays dormant when the limit falls back to the module's own minutes", () => {
    // `module_duration_seconds` is null for an untimed attempt, and the hook then falls back to
    // `time_limit_minutes` — which is exactly why the explicit flag is needed.
    const onExpire = vi.fn();
    mountTimer({ attempt: longRunning({ module_duration_seconds: null }), onExpire, untimed: true });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(ready()).toBe(false);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("lets go of a running clock if the attempt turns out to be untimed", () => {
    // A timed snapshot lands first, then the server's untimed one: the countdown must stop and
    // must not fire after the fact.
    const onExpire = vi.fn();
    const fresh = longRunning({ current_module_start_time: new Date(NOW).toISOString() });
    mountTimer({ attempt: fresh, onExpire });
    expect(ready()).toBe(true);
    mountTimer({ attempt: fresh, onExpire, untimed: true });
    act(() => {
      vi.advanceTimersByTime(3 * 60 * 60 * 1000);
    });
    expect(ready()).toBe(false);
    expect(onExpire).not.toHaveBeenCalled();
  });
});
