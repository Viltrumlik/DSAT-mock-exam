export type CoalescedRuns = {
  /** Run the task, or ask for one more run after the one under way. Settles with the run that answers. */
  run: () => Promise<void>;
  /** Drop the run asked for but not started, settling its callers, and ignore every later `run()`. */
  cancel: () => void;
};

type Waiters = { resolve: () => void; reject: (reason: unknown) => void };

/**
 * Runs `task` one at a time.
 *
 * `run()` starts the task at once when it is not running. Called while it runs, it asks for one more run,
 * which starts the moment the current one ends: the current run may have read its data before whatever
 * prompted the call. Every call made before that run starts shares it, so a burst of calls costs two runs
 * at most, not one each.
 *
 * The promise from `run()` settles with the run that answers the call — the one it started, or the one it
 * asked for — resolving or rejecting as that run did. A failed run does not stop the one asked for after
 * it. `cancel()` cannot stop a run already under way; that run still settles its callers.
 */
export function coalesceRuns(task: () => Promise<unknown>): CoalescedRuns {
  let running = false;
  let cancelled = false;
  /** The run asked for while one was under way, and the promise its callers share. */
  let next: (Waiters & { promise: Promise<void> }) | null = null;

  const start = (waiters: Waiters) => {
    running = true;
    let result: Promise<unknown>;
    try {
      result = task();
    } catch (err) {
      result = Promise.reject(err);
    }
    const end = (settle: () => void) => {
      running = false;
      const queued = next;
      next = null;
      // Now, not on a later tick: by the time this run's callers hear that it ended, the next is under way.
      if (queued) start(queued);
      settle();
    };
    Promise.resolve(result).then(
      () => end(waiters.resolve),
      (reason: unknown) => end(() => waiters.reject(reason)),
    );
  };

  return {
    run() {
      if (cancelled) return Promise.resolve();
      if (!running) return new Promise<void>((resolve, reject) => start({ resolve, reject }));
      if (!next) {
        let resolve!: () => void;
        let reject!: (reason: unknown) => void;
        const promise = new Promise<void>((res, rej) => {
          resolve = res;
          reject = rej;
        });
        next = { promise, resolve, reject };
      }
      return next.promise;
    },
    cancel() {
      cancelled = true;
      const queued = next;
      next = null;
      queued?.resolve();
    },
  };
}
