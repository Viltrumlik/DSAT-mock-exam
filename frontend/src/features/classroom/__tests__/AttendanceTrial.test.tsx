/**
 * The register of a class paired with lc-up shows lc-up's trial students (owner, 2026-10-20). The
 * first lesson is marked as such. One who has had the free trial is flagged "send to the admin",
 * loudest the moment they are marked present. lc-up members the register cannot show are named in
 * a banner above it.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();

vi.mock("@/lib/api", () => ({
  default: { get: (...args: unknown[]) => get(...args), post: (...args: unknown[]) => post(...args), patch: vi.fn(), delete: vi.fn() },
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
  post.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

async function mount(extra: { roster: object[]; not_on_list?: object[] }) {
  get.mockImplementation(async (url: string) => {
    if (url === "/classes/34/attendance/sessions/7/") {
      return {
        data: {
          id: 7, date: "2026-10-19", title: "", lesson_index: null, status: "OPEN", counts: null,
          marking: { state: "OPEN", opens_at: "", closes_at: "", can_mark: true, is_override: false, reason: null },
          excuse_reasons: [],
          ...extra,
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
  for (let tick = 0; tick < 50 && !host.textContent?.includes("Ali"); tick++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  if (!host.textContent?.includes("Ali")) throw new Error("the register never rendered");
}

const row = (lcup_trial: object | null) => ({
  student_id: 1, name: "Ali Valiyev", status: null, note: "", reason_id: null, lcup_trial,
});

describe("Attendance register — lc-up trial students", () => {
  it("marks a trial student's first lesson", async () => {
    await mount({ roster: [row({ lessons_before: 0, free_used: false })] });
    expect(host.textContent).toContain("Trial · 1st lesson");
    expect(host.textContent).not.toContain("send to the admin");
  });

  it("flags one who has had the free trial, and says it again when they are marked present", async () => {
    await mount({ roster: [row({ lessons_before: 1, free_used: true })] });
    expect(host.textContent).toContain("Free trial used — send to the admin");
    expect(host.textContent).not.toContain("has already had the free trial lesson");
    const present = host.querySelector<HTMLButtonElement>('button[title="Present"]');
    if (!present) throw new Error("no Present button");
    await act(async () => present.click());
    expect(host.textContent).toContain("Ali Valiyev has already had the free trial lesson — send them to the admin");
  });

  it("says nothing for a student who is not on trial", async () => {
    await mount({ roster: [row(null)] });
    expect(host.textContent).not.toContain("Trial");
  });

  it("names the lc-up members the register cannot show", async () => {
    await mount({ roster: [row(null)], not_on_list: [{ name: "Jasur Toshmatov" }, { name: "Bek Rahimov" }] });
    expect(host.textContent).toContain(
      "In lc-up but not on your list: Jasur Toshmatov, Bek Rahimov — send them to the admin.",
    );
  });
});
