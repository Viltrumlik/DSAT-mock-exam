/**
 * /ops/lcup → Attendance: every register sent to lc-up, and the students lc-up did not take
 * (a debt block, not in the group, …) — so an administrator can settle those in lc-up by hand.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();

vi.mock("@/lib/api", () => ({
  default: { get: (...args: unknown[]) => get(...args), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const { AttendancePushesPanel } = await import("../LcupPanels");

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

async function mount(pushes: object[]) {
  get.mockImplementation(async (url: string) => {
    if (url === "/lcup/attendance/pushes/") return { data: pushes };
    throw new Error(`unexpected GET ${url}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <AttendancePushesPanel />
      </QueryClientProvider>,
    );
  });
  for (let tick = 0; tick < 50 && get.mock.calls.length === 0; tick++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("lc-up attendance pushes panel", () => {
  it("lists each push and names the students lc-up did not take", async () => {
    await mount([
      {
        id: 1, group: "Junior G21 | Math | Vali", date: "2026-10-15", state: "sent", attempts: 1, marks: 3,
        summary: { saved: 2, failed: 1 },
        failures: [{ student: { id: 9, name: "Aziz Tursunov", username: "aziz", phone: "" }, code: "blocked_debt", message: "x" }],
        error: "", sent_at: "2026-10-15T20:05:00+05:00",
      },
    ]);
    expect(host.textContent).toContain("Junior G21 | Math | Vali");
    expect(host.textContent).toContain("Sent");
    expect(host.textContent).toContain("3 marks · 2 saved");
    expect(host.textContent).toContain("Aziz Tursunov — lc-up did not take this mark (blocked_debt)");
  });

  it("says when nothing has been sent yet", async () => {
    await mount([]);
    expect(host.textContent).toContain("Nothing sent to lc-up yet");
  });
});
