/**
 * A student frozen because this month is unpaid (lc-up) carries a "Frozen — unpaid" badge where the
 * teacher sees them — the People page and the attendance register — and never an amount: the owner
 * decided teachers see the badge, not the money. The server sends the flag only to the teaching team.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const members = [
  { id: 1, role: "STUDENT", status: "ACTIVE", user: { id: 11, email: "", first_name: "Malika", last_name: "Karimova", username: "malika" }, frozen_for_debt: true },
  { id: 2, role: "STUDENT", status: "ACTIVE", user: { id: 12, email: "", first_name: "Aziz", last_name: "Tursunov", username: "aziz" }, frozen_for_debt: false },
];

const get = vi.fn();

vi.mock("../hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../hooks")>()),
  useClassMembers: () => ({ data: members, isLoading: false, isError: false, refetch: vi.fn() }),
}));
const post = vi.fn();

vi.mock("@/lib/api", () => ({
  default: { get: (...args: unknown[]) => get(...args), post: (...args: unknown[]) => post(...args), patch: vi.fn(), delete: vi.fn() },
}));

const { People } = await import("../pages/People");
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
});

async function render(node: React.ReactNode, until: () => boolean = () => true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  });
  for (let i = 0; i < 40 && !until(); i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe("Frozen — unpaid badge", () => {
  it("badges only the frozen student on the People page", async () => {
    await render(<People classroom={{ id: 5, my_role: "ADMIN" } as never} />);
    const cards = Array.from(host.querySelectorAll(".cr-card"));
    const badgeOn = (name: string) => cards.find((c) => c.textContent?.includes(name))?.textContent?.includes("Frozen — unpaid");
    expect(badgeOn("Malika Karimova")).toBe(true);
    expect(badgeOn("Aziz Tursunov")).toBe(false);
    expect(host.textContent).not.toMatch(/UZS|so'm/);
  });

  it("badges the frozen student in the register", async () => {
    get.mockResolvedValue({
      data: {
        id: 7, date: "2026-10-14", title: "", lesson_index: null, status: "OPEN", counts: null,
        marking: { state: "OPEN", opens_at: "", closes_at: "", can_mark: true, is_override: false, reason: null },
        roster: [
          { student_id: 11, name: "Malika Karimova", status: null, note: "", reason_id: null, frozen_for_debt: true },
          { student_id: 12, name: "Aziz Tursunov", status: null, note: "", reason_id: null, frozen_for_debt: false },
        ],
        excuse_reasons: [],
      },
    });
    await render(<RosterMarker classId={5} sessionId={7} />, () => !!host.textContent?.includes("Malika"));
    const rowOf = (name: string) =>
      Array.from(host.querySelectorAll(".py-2\\.5")).find((r) => r.textContent?.includes(name))?.textContent ?? "";
    expect(rowOf("Malika Karimova")).toContain("Frozen — unpaid");
    expect(rowOf("Aziz Tursunov")).not.toContain("Frozen — unpaid");
  });
});

/**
 * A student lc-up holds frozen in the group stays on the register but is never marked (owner,
 * 2026-10-17: "Belgilab bo'lmaydi") — lc-up refuses their marks with `not_in_group`.
 */
describe("Frozen in lc-up", () => {
  const session = {
    id: 7, date: "2026-10-14", title: "", lesson_index: null, status: "OPEN", counts: null,
    marking: { state: "OPEN", opens_at: "", closes_at: "", can_mark: true, is_override: false, reason: null },
    roster: [
      { student_id: 11, name: "Malika Karimova", status: null, note: "", reason_id: null, frozen_in_lcup: true },
      { student_id: 12, name: "Aziz Tursunov", status: null, note: "", reason_id: null, frozen_in_lcup: false },
    ],
    excuse_reasons: [],
  };
  const rowOf = (name: string) =>
    Array.from(host.querySelectorAll(".py-2\\.5")).find((r) => r.textContent?.includes(name)) as HTMLElement;
  const letter = (row: HTMLElement, l: string) =>
    Array.from(row.querySelectorAll("button")).find((b) => b.textContent === l) as HTMLButtonElement;

  it("badges them and offers no mark", async () => {
    get.mockResolvedValue({ data: session });
    await render(<RosterMarker classId={5} sessionId={7} />, () => !!host.textContent?.includes("Malika"));
    expect(rowOf("Malika Karimova").textContent).toContain("Frozen in lc-up");
    expect(rowOf("Aziz Tursunov").textContent).not.toContain("Frozen in lc-up");
    expect(Array.from(rowOf("Malika Karimova").querySelectorAll("button")).every((b) => b.disabled)).toBe(true);
    expect(Array.from(rowOf("Aziz Tursunov").querySelectorAll("button")).some((b) => b.disabled)).toBe(false);
  });

  it("never sends a mark for them", async () => {
    get.mockResolvedValue({ data: session });
    post.mockResolvedValue({ data: { status: "marked", updated: 1, frozen_in_lcup: [] } });
    await render(<RosterMarker classId={5} sessionId={7} />, () => !!host.textContent?.includes("Malika"));
    act(() => letter(rowOf("Aziz Tursunov"), "P").click());
    const save = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Save")) as HTMLButtonElement;
    await act(async () => {
      save.click();
    });
    expect(post).toHaveBeenCalledWith("/classes/5/attendance/sessions/7/mark/", { records: [{ student_id: 12, status: "PRESENT" }] });
  });
});
