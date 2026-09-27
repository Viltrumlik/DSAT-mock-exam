/**
 * Arriving at a live quiz from "running now" rather than by typing the code.
 *
 * The socket refuses a handshake from a student with no place in the room, and a handshake
 * refused before it opens carries no close code — so the client could only report that the
 * connection had dropped, and it retried for ever. The room therefore takes a place over
 * REST first, where a refusal has a reason worth reading.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiPost = vi.fn();

vi.mock("@/lib/api", () => ({
  default: {
    get: vi.fn(),
    post: (...args: unknown[]) => apiPost(...args),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));
// The game opens a WebSocket the moment it mounts, which is the thing under test: it must
// not mount until a place has been taken.
vi.mock("../StudentGame", () => ({
  StudentGame: ({ sessionId }: { sessionId: number }) => <p>playing room {sessionId}</p>,
}));

const { LiveQuizRoom } = await import("../LiveQuizRoom");

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  // React 19 only flushes work inside `act` when the environment declares itself one.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  apiPost.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const text = () => (host.textContent ?? "").replace(/\s+/g, " ").trim();

async function mount(sessionId = 7) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <LiveQuizRoom sessionId={sessionId} />
      </QueryClientProvider>,
    );
  });
  for (let tick = 0; tick < 50; tick++) {
    if (text().includes("playing room") || text().includes("cannot join")) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe("taking a place before the game opens", () => {
  it("asks for a place, then plays", async () => {
    apiPost.mockResolvedValue({
      data: { session: { id: 7, status: "LOBBY" }, participant: { id: 3 } },
    });

    await mount(7);

    expect(apiPost).toHaveBeenCalledWith("/livequiz/sessions/7/join/", {});
    expect(text()).toContain("playing room 7");
  });

  it("does not open the socket while the place is still being asked for", async () => {
    // Never resolves: the game must not have mounted by then.
    apiPost.mockImplementation(() => new Promise(() => {}));

    await mount(7);

    expect(text()).not.toContain("playing room");
    expect(text()).toContain("Joining the quiz");
  });

  it("shows why it was refused instead of retrying for ever", async () => {
    apiPost.mockRejectedValue({
      response: { status: 403, data: { detail: "The host removed you from this quiz." } },
    });

    await mount(7);

    expect(text()).toContain("The host removed you from this quiz.");
    expect(text()).not.toContain("playing room");
  });
});
