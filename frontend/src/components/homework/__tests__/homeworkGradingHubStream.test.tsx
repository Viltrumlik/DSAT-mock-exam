import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * Opening the homework grading hub holds no realtime stream unless the build turns the stream on.
 *
 * The hub subscribes to `@/lib/realtime` to refresh its list. Each open stream holds one of
 * production's three sync gunicorn workers, so a few teachers with the hub open would leave nobody
 * to answer the rest of the site. Unlike the hub's other tests, this one keeps the real
 * `@/lib/realtime`, where the guard lives, and stands in only for the browser's EventSource.
 */

const api = vi.hoisted(() => ({ list: vi.fn(), listAssignments: vi.fn() }));

vi.mock("@/lib/api", () => ({ classesApi: api }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

import HomeworkGradingHub from "../HomeworkGradingHub";

/** The URL of every EventSource the page opened. jsdom has no EventSource of its own. */
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

let host: HTMLDivElement;
let root: Root;

const loading = () => host.querySelector(".animate-spin") != null;

/** Mount the hub and wait until it has finished loading. */
async function mountHub() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <HomeworkGradingHub
        basePath="/teacher/homework/grading"
        homeworkManagementHref="/teacher/homework"
        homeworkManagementLabel="Homework"
      />,
    ),
  );
  for (let tick = 0; tick < 50 && loading(); tick++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  if (loading()) throw new Error("the hub never finished loading");
}

beforeEach(() => {
  // React 19 only flushes work inside `act` when the environment declares itself one.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  opened.length = 0;
  vi.stubGlobal("EventSource", FakeEventSource);
  api.list.mockResolvedValue({
    items: [{ id: 1, name: "SAT Math A", subject: "MATH", members_count: 3, my_role: "ADMIN" }],
  });
  api.listAssignments.mockResolvedValue({
    items: [
      { id: 100, title: "Linear equations", created_at: "2026-09-01T09:00:00+05:00", due_at: null, submissions_count: 1 },
    ],
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("HomeworkGradingHub — the realtime stream", () => {
  it("lists the homework without opening a stream while NEXT_PUBLIC_REALTIME_STREAM is unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_STREAM", undefined);

    await mountHub();

    expect(host.textContent).toContain("Linear equations");
    expect(opened).toEqual([]);
  });

  it("opens one stream when the build turns it on", async () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_STREAM", "1");

    await mountHub();

    // The path's tail only: `check:api-layer` fails CI on a quoted API prefix outside the API layer.
    expect(opened.map((url) => new URL(url).pathname)).toEqual([expect.stringMatching(/\/realtime\/events\/$/)]);
  });
});
