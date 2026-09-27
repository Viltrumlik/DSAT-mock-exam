/**
 * The teacher's live-quiz console (`/teacher/live`).
 *
 * `classesApi.list()` hands every caller the same normalised envelope — `{ items }` — because
 * the contract parser flattens both a bare array and DRF's `{ results }` before the hook ever
 * sees it. The console read `.results` off it through an `as unknown` cast, so the list was
 * empty whatever the server said, every teacher was told they had no classes, and nobody could
 * open a room. The cast is why tsc stayed quiet: it threw away the type that would have caught it.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseClassroomList } from "@/lib/criticalApiContract";

const listClassrooms = vi.fn();
const apiGet = vi.fn();

vi.mock("@/lib/api", () => ({
  default: {
    get: (...args: unknown[]) => apiGet(...args),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  classesApi: { list: (...args: unknown[]) => listClassrooms(...args) },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/teacher/live",
  useRouter: () => ({ push: vi.fn() }),
}));

const { HostConsole } = await import("../HostConsole");

/** A `GET /api/classes/` row as a teacher receives it. */
const classroom = (id: number, name: string) => ({
  id,
  name,
  subject: "ENGLISH",
  lesson_days: "ODD",
  join_code: "XJ42QP",
  members_count: 12,
});

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  // React 19 only flushes work inside `act` when the environment declares itself one.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  listClassrooms.mockReset();
  apiGet.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

/** Serve `rows` through the real contract parser and mount the console. */
async function mount(rows: object[]) {
  listClassrooms.mockImplementation(async () => parseClassroomList(rows, "GET /classes/"));
  apiGet.mockImplementation(async (url: string) => {
    if (String(url).startsWith("/livequiz/sessions/")) return { data: { results: [] } };
    if (String(url).startsWith("/livequiz/options/")) {
      return { data: { classroom: classroom(34, "Middle G13"), vocab_sets: [] } };
    }
    throw new Error(`the console asked for an endpoint the test does not serve: ${url}`);
  });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <HostConsole />
      </QueryClientProvider>,
    );
  });

  // Settle the classroom query: either the picker appears or the console gives up on it.
  for (let tick = 0; tick < 50; tick++) {
    if (host.querySelector("select") || text(host).includes("No classes yet")) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  throw new Error("the console never settled on either a class picker or an empty state");
}

const optionLabels = () =>
  [...host.querySelectorAll("select")].flatMap((select) =>
    [...select.querySelectorAll("option")].map((option) => text(option)),
  );

describe("live quiz console — the classes a teacher can play with", () => {
  it("offers the classes the server returned", async () => {
    await mount([classroom(34, "Middle G13"), classroom(35, "Senior G2")]);

    expect(text(host)).not.toContain("No classes yet");
    expect(optionLabels()).toContain("Middle G13");
    expect(optionLabels()).toContain("Senior G2");
  });

  it("says so only when the teacher really has none", async () => {
    await mount([]);

    expect(text(host)).toContain("No classes yet");
  });
});
