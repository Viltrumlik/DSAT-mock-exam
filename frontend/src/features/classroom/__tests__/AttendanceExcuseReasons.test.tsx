/**
 * The register of a class paired with lc-up: an excused absence names one of lc-up's reasons.
 *
 * lc-up receives an EXCUSED mark as an absence WITH a reason, so in a paired class (the session
 * lists `excuse_reasons`) choosing E opens the reasons, Save waits until each E has one, and the
 * payload carries `reason_id`. A class lc-up does not run has no reasons and no picker.
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
  post.mockResolvedValue({ data: { status: "marked", updated: 1 } });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const REASONS = [{ id: 3034, title: "Kasal" }, { id: 3035, title: "Uzoqga ketib qolgan" }];

async function mount(excuseReasons: { id: number; title: string }[]) {
  get.mockImplementation(async (url: string) => {
    if (url === "/classes/34/attendance/sessions/7/") {
      return {
        data: {
          id: 7, date: "2026-10-14", title: "", lesson_index: null, status: "OPEN", counts: null,
          marking: { state: "OPEN", opens_at: "", closes_at: "", can_mark: true, is_override: false, reason: null },
          roster: [{ student_id: 1, name: "Aziz Tursunov", status: null, note: "", reason_id: null }],
          excuse_reasons: excuseReasons,
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
  for (let tick = 0; tick < 50 && !host.textContent?.includes("Aziz"); tick++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  if (!host.textContent?.includes("Aziz")) throw new Error("the register never rendered");
}

function button(title: string) {
  const found = host.querySelector<HTMLButtonElement>(`button[title="${title}"]`);
  if (!found) throw new Error(`no button titled ${title}`);
  return found;
}

function saveButton() {
  const found = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Save"));
  if (!found) throw new Error("no Save button");
  return found as HTMLButtonElement;
}

describe("Attendance register — lc-up excuse reasons", () => {
  it("asks for one of lc-up's reasons when E is chosen, and sends it", async () => {
    await mount(REASONS);
    await act(async () => button("Excused").click());

    const select = host.querySelector<HTMLSelectElement>("select[aria-label='Reason for Aziz Tursunov']");
    expect(select).not.toBeNull();
    expect(Array.from(select!.options).map((o) => o.textContent)).toEqual(["Choose a reason", "Kasal", "Uzoqga ketib qolgan"]);
    expect(saveButton().disabled).toBe(true);

    await act(async () => {
      select!.value = "3035";
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(saveButton().disabled).toBe(false);
    await act(async () => saveButton().click());

    expect(post).toHaveBeenCalledWith("/classes/34/attendance/sessions/7/mark/", {
      records: [{ student_id: 1, status: "EXCUSED", reason_id: 3035 }],
    });
  });

  it("offers no picker in a class lc-up does not run", async () => {
    await mount([]);
    await act(async () => button("Excused").click());

    expect(host.querySelector("select")).toBeNull();
    expect(saveButton().disabled).toBe(false);
    await act(async () => saveButton().click());
    expect(post).toHaveBeenCalledWith("/classes/34/attendance/sessions/7/mark/", {
      records: [{ student_id: 1, status: "EXCUSED" }],
    });
  });
});
