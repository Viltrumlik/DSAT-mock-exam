import { describe, expect, it, vi } from "vitest";
import { coalesceRuns } from "../coalesceRuns";

/**
 * coalesceRuns — one run of a task at a time, and at most one more asked for behind it.
 *
 * The homework grading hub refreshes through it on every realtime event, so a batch of events costs one
 * reload and one after it rather than a reload each. See `components/homework/__tests__/homeworkGradingHubRefreshes.test.tsx`.
 */

/** A task whose every run waits until the test ends it. */
function heldTask() {
  const runs: { resolve: () => void; reject: (reason: unknown) => void }[] = [];
  const task = vi.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        runs.push({ resolve, reject });
      }),
  );
  return { task, runs };
}

/** Let the promise callbacks already queued run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** How a promise has settled so far. */
function track(promise: Promise<unknown>) {
  const state: { settled: false | "resolved" | "rejected"; reason?: unknown } = { settled: false };
  promise.then(
    () => {
      state.settled = "resolved";
    },
    (reason: unknown) => {
      state.settled = "rejected";
      state.reason = reason;
    },
  );
  return state;
}

describe("coalesceRuns", () => {
  it("runs the task at once when it is not running", () => {
    const { task } = heldTask();
    void coalesceRuns(task).run();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("runs it once more after the run under way, however many calls came meanwhile", async () => {
    const { task, runs } = heldTask();
    const runner = coalesceRuns(task);
    void runner.run();
    void runner.run();
    void runner.run();
    void runner.run();
    expect(task).toHaveBeenCalledTimes(1);

    runs[0].resolve();
    await flush();
    expect(task).toHaveBeenCalledTimes(2);

    runs[1].resolve();
    await flush();
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("settles each call with the run that answers it", async () => {
    const { task, runs } = heldTask();
    const runner = coalesceRuns(task);
    const first = track(runner.run());
    const second = track(runner.run());
    const third = track(runner.run());

    runs[0].resolve();
    await flush();
    expect(first.settled).toBe("resolved");
    expect(second.settled).toBe(false);
    expect(third.settled).toBe(false);

    runs[1].resolve();
    await flush();
    expect(second.settled).toBe("resolved");
    expect(third.settled).toBe("resolved");
  });

  it("has the run asked for under way by the time a caller hears that its own run ended", async () => {
    const { task, runs } = heldTask();
    const runner = coalesceRuns(task);
    const first = runner.run();
    void runner.run();

    runs[0].resolve();
    await first;
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("starts a new run for a call made after the last run ended", async () => {
    const { task, runs } = heldTask();
    const runner = coalesceRuns(task);
    void runner.run();
    runs[0].resolve();
    await flush();

    void runner.run();
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("still runs the run asked for after one that fails, and fails only the calls the failed run answered", async () => {
    const { task, runs } = heldTask();
    const runner = coalesceRuns(task);
    const first = track(runner.run());
    const second = track(runner.run());

    const boom = new Error("boom");
    runs[0].reject(boom);
    await flush();
    expect(first).toEqual({ settled: "rejected", reason: boom });
    expect(second.settled).toBe(false);
    expect(task).toHaveBeenCalledTimes(2);

    runs[1].resolve();
    await flush();
    expect(second.settled).toBe("resolved");
  });

  it("counts a task that throws before it returns a promise as a failed run", async () => {
    const boom = new Error("boom");
    const task = vi
      .fn(() => Promise.resolve())
      .mockImplementationOnce(() => {
        throw boom;
      });
    const runner = coalesceRuns(task);

    await expect(runner.run()).rejects.toBe(boom);
    await expect(runner.run()).resolves.toBeUndefined();
    expect(task).toHaveBeenCalledTimes(2);
  });

  describe("cancel", () => {
    it("drops the run asked for, settling its calls without running it, and lets the run under way finish", async () => {
      const { task, runs } = heldTask();
      const runner = coalesceRuns(task);
      const first = track(runner.run());
      const second = track(runner.run());

      runner.cancel();
      await flush();
      expect(second.settled).toBe("resolved");
      expect(first.settled).toBe(false);

      runs[0].resolve();
      await flush();
      expect(first.settled).toBe("resolved");
      expect(task).toHaveBeenCalledTimes(1);
    });

    it("ignores every call after it", async () => {
      const { task } = heldTask();
      const runner = coalesceRuns(task);
      runner.cancel();

      await expect(runner.run()).resolves.toBeUndefined();
      expect(task).not.toHaveBeenCalled();
    });
  });
});
