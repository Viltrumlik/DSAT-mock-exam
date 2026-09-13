/**
 * The classroom Gradebook tab when the class has nothing published.
 *
 * The overview leaves drafts out (nobody has been given one, so nobody can be missing it). A class
 * whose only homework is still a draft therefore gets the empty state, and it has to say why the
 * homework the Assignments tab lists is not here.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClassroomWithRole } from "../types";

const get = vi.fn();

vi.mock("@/lib/api", () => ({
  default: { get: (...args: unknown[]) => get(...args), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  classesApi: { gradeSubmission: vi.fn(), returnSubmission: vi.fn() },
}));

const { Gradebook } = await import("../pages/Gradebook");

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  // React 19 only flushes work inside `act` when the environment declares itself one.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  get.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

async function mount(overview: object) {
  get.mockImplementation(async (url: string) => {
    if (url === "/classes/34/gradebook/") return { data: overview };
    throw new Error(`unexpected GET ${url}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const classroom = { id: 34, name: "Middle G13", my_role: "OWNER" } as unknown as ClassroomWithRole;
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Gradebook classroom={classroom} />
      </QueryClientProvider>,
    );
  });
  for (let tick = 0; tick < 50 && !host.textContent?.includes("Gradebook"); tick++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  if (!host.textContent?.includes("Gradebook")) throw new Error("the gradebook never rendered");
}

describe("Gradebook tab — a class with nothing published", () => {
  it("says assignments appear once they are published", async () => {
    // What the server sends for a class of three whose only homework is a draft.
    await mount({ assignments: [], needs_grading_total: 0, students: 3 });

    expect(get).toHaveBeenCalledWith("/classes/34/gradebook/");
    expect(host.textContent).toContain("No assignments yet");
    expect(host.textContent).toContain("Assignments show up here once they are published.");
  });
});
