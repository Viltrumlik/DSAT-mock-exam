/**
 * A register held on a day whose lesson was then called off or moved (owner, 2026-11-25): a banner says so in place
 * of the marking, "Lesson cancelled: <reason>" or "Lesson moved to <date>". Any other register is marked as before.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();

vi.mock("@/lib/api", () => ({
  default: { get: (...args: unknown[]) => get(...args), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const { RosterMarker } = await import("../pages/Attendance");

let host: HTMLElement;
let root: Root;

beforeEach(() => {
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

async function mount(change: object | null) {
  get.mockImplementation(async (url: string) => {
    if (url === "/classes/34/attendance/sessions/7/") {
      return {
        data: {
          id: 7, date: "2026-12-07", title: "", lesson_index: null, status: "OPEN", counts: null,
          marking: { state: "OPEN", opens_at: "", closes_at: "", can_mark: true, is_override: false, reason: null },
          excuse_reasons: [], change,
          roster: [{ student_id: 1, name: "Ali Valiyev", status: null, note: "", reason_id: null }],
        },
      };
    }
    throw new Error(`unexpected GET ${url}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <RosterMarker classId={34} sessionId={7} />
      </QueryClientProvider>,
    );
  });
  for (let tick = 0; tick < 50 && !/Lesson|Ali/.test(host.textContent ?? ""); tick++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const buttons = () => [...host.querySelectorAll("button")].map((b) => b.textContent?.trim());

describe("Attendance register — a lesson cancelled or moved", () => {
  it("says the lesson was cancelled and why, and offers no marking", async () => {
    await mount({ kind: "cancel", reason: "Teacher ill", new_day: null });
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Lesson cancelled: Teacher ill");
    expect(buttons()).not.toContain("Mark all present");
    expect(host.textContent).not.toContain("Ali Valiyev");
  });

  it("says where a moved lesson went", async () => {
    await mount({ kind: "move", reason: "Room taken", new_day: "2026-12-09" });
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Lesson moved to 9 Dec");
    expect(buttons()).not.toContain("Save");
  });

  it("marks any other register as before", async () => {
    await mount(null);
    expect(host.textContent).toContain("Ali Valiyev");
    expect(buttons()).toContain("Mark all present");
  });
});
