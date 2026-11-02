/**
 * "Try again" on the reconnect screen must always do something the student can see: a handshake
 * hanging on a dead network can sit for a long time before the browser gives up on it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openLiveQuizSocket } from "../socket";

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static made: FakeSocket[] = [];

  readyState = FakeSocket.CONNECTING;
  closedByClient = false;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    FakeSocket.made.push(this);
  }
  send() {}
  close() {
    this.closedByClient = true;
    this.readyState = FakeSocket.CLOSED;
  }
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  drop(code = 1006) {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code });
  }
}

const open = () => {
  const statuses: Array<[string, number | undefined]> = [];
  const handle = openLiveQuizSocket(7, {
    onFrame: () => {},
    onStatus: (status, detail) => statuses.push([status, detail?.attempt]),
  });
  return { handle, statuses };
};

describe("trying again", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.made = [];
    vi.stubGlobal("WebSocket", FakeSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("replaces a handshake that is still hanging", () => {
    const { handle, statuses } = open();
    expect(FakeSocket.made).toHaveLength(1);

    handle.retryNow();

    expect(FakeSocket.made).toHaveLength(2);
    expect(FakeSocket.made[0].closedByClient).toBe(true);
    expect(statuses.at(-1)).toEqual(["connecting", 2]);
    handle.close();
  });

  it("does not schedule a second try when the replaced socket's close arrives", () => {
    const { handle } = open();
    handle.retryNow();
    FakeSocket.made[0].drop();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.made).toHaveLength(2);
    handle.close();
  });

  it("stops waiting out the backoff and tries now", () => {
    const { handle } = open();
    FakeSocket.made[0].drop();
    expect(FakeSocket.made).toHaveLength(1);

    handle.retryNow();
    expect(FakeSocket.made).toHaveLength(2);

    // The backoff it cut short does not fire as well.
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.made).toHaveLength(2);
    handle.close();
  });

  it("leaves a working connection alone", () => {
    const { handle } = open();
    FakeSocket.made[0].open();
    handle.retryNow();
    expect(FakeSocket.made).toHaveLength(1);
    expect(FakeSocket.made[0].closedByClient).toBe(false);
    handle.close();
  });

  it("does nothing once the screen has gone", () => {
    const { handle } = open();
    handle.close();
    handle.retryNow();
    expect(FakeSocket.made).toHaveLength(1);
  });

  it("counts the tries, and starts again once connected", () => {
    const { handle, statuses } = open();
    FakeSocket.made[0].drop();
    vi.advanceTimersByTime(1_000);
    expect(statuses.at(-1)).toEqual(["connecting", 2]);
    FakeSocket.made[1].open();
    expect(statuses.at(-1)).toEqual(["open", 0]);
    handle.close();
  });
});
