import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeRealtime } from "../realtime";

/**
 * The realtime stream stays closed unless the build turns it on with NEXT_PUBLIC_REALTIME_STREAM=1.
 *
 * `/api/realtime/events/` holds a gunicorn worker for as long as the stream is open, up to 25 s, and
 * the client opens the next one as soon as it ends. Production runs three sync workers, so three open
 * streams leave none for anyone else: the 2026-08-23 freeze (5a6828f7).
 */

/** The URL of every EventSource the code under test opened. jsdom has no EventSource of its own. */
const opened: string[] = [];

class FakeEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((m: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    opened.push(url);
  }

  addEventListener() {}

  close() {}
}

function handlers() {
  return { onEvent: vi.fn(), onStatus: vi.fn() };
}

beforeEach(() => {
  opened.length = 0;
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("subscribeRealtime", () => {
  it("opens no stream, and calls no handler, while NEXT_PUBLIC_REALTIME_STREAM is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_STREAM", undefined);
    const h = handlers();

    const unsubscribe = subscribeRealtime(h);
    unsubscribe();

    expect(opened).toEqual([]);
    expect(h.onStatus).not.toHaveBeenCalled();
    expect(h.onEvent).not.toHaveBeenCalled();
  });

  it.each(["0", "false", "off", ""])("opens no stream when NEXT_PUBLIC_REALTIME_STREAM is %j", (value) => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_STREAM", value);

    subscribeRealtime(handlers())();

    expect(opened).toEqual([]);
  });

  it("opens the stream when NEXT_PUBLIC_REALTIME_STREAM is 1", () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_STREAM", "1");
    const h = handlers();

    const unsubscribe = subscribeRealtime(h);

    // The path's tail only: `check:api-layer` fails CI on a quoted API prefix outside the API layer.
    expect(opened.map((url) => new URL(url).pathname)).toEqual([expect.stringMatching(/\/realtime\/events\/$/)]);
    expect(h.onStatus).toHaveBeenCalledWith("connecting");
    unsubscribe();
  });
});
