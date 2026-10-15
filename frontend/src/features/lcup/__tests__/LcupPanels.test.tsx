/**
 * /ops/lcup as dense tables: the status as plain fields with the sync buttons, a group row that
 * pairs with the class picked in it, and a student row whose candidate links in one click.
 */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();

vi.mock("@/lib/api", () => ({
  default: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const { GroupsPanel, StatusPanel, StudentsPanel } = await import("../LcupPanels");

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  get.mockReset();
  post.mockReset().mockResolvedValue({ data: {} });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

async function flush() {
  for (let tick = 0; tick < 5; tick++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mount(ui: ReactElement, routes: Record<string, unknown>) {
  get.mockImplementation(async (url: string) => {
    if (!(url in routes)) throw new Error(`unexpected GET ${url}`);
    return { data: routes[url] };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  });
  for (let tick = 0; tick < 50 && get.mock.calls.length === 0; tick++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  await flush();
}

function button(label: string, within: ParentNode = host): HTMLButtonElement {
  const found = [...within.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
  if (!found) throw new Error(`no button "${label}"`);
  return found;
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
  await flush();
}

const STATUS = {
  enabled: false,
  initial_review_done_at: null,
  last_run: null,
  recent_runs: [
    {
      id: 5,
      started_at: "2026-10-14T09:00:00+05:00",
      finished_at: "2026-10-14T09:01:00+05:00",
      dry_run: true,
      ok: false,
      counts: { groups_seen: 24, students_linked: 0 },
      errors: [{ stage: "students", error: "timeout" }],
      alerts: ["3 groups have no teacher"],
    },
  ],
  counts: {
    needs_review_students: 0,
    unmatched_students: 4,
    needs_review_teachers: 1,
    groups_pending: 2,
    unclaimed_accounts: 7,
  },
};

describe("lc-up status", () => {
  it("lists the state as fields and each run as a row; Sync now waits for the sync to be on", async () => {
    await mount(<StatusPanel />, { "/lcup/status/": STATUS });
    const fields = [...host.querySelectorAll("dl > div")].map((row) => row.textContent);
    expect(fields).toContain("SyncOff");
    expect(fields).toContain("Initial reviewNot done yet");
    expect(fields).toContain("Accounts not claimed yet7");

    const run = host.querySelector("tbody tr")?.textContent ?? "";
    expect(run).toContain("Dry run");
    expect(run).toContain("Errors");
    expect(run).toContain("groups seen: 24");
    expect(run).not.toContain("students linked");
    expect(run).toContain("3 groups have no teacher");
    expect(run).toContain("students: timeout");

    expect(button("Sync now").disabled).toBe(true);
    await click(button("Dry run"));
    expect(post).toHaveBeenCalledWith("/lcup/sync/?dry_run=1");
  });

  it("asks before marking the initial review done", async () => {
    await mount(<StatusPanel />, { "/lcup/status/": STATUS });
    await click(button("Mark initial review done"));
    expect(post).not.toHaveBeenCalled();
    await click(button("Yes, mark it done"));
    expect(post).toHaveBeenCalledWith("/lcup/review-done/");
  });
});

describe("lc-up groups", () => {
  const GROUPS = [
    {
      id: 1, lcup_group_id: 101, name: "Junior G21 | Math", course: "Math", days: [1, 3, 5], start_time: "14:00",
      finish_time: "15:30", teachers: ["Vali Karimov"], status: "suggested", deleted: false, classroom: null,
      suggestion: { id: 30, name: "Math Junior G21", score: 12, reasons: ["same teacher", "same days"] }, notes: [],
      member_count: 12,
    },
    {
      id: 2, lcup_group_id: 102, name: "Senior G5 | English", course: "English", days: [2, 4], start_time: "",
      finish_time: "", teachers: [], status: "confirmed", deleted: false, classroom: { id: 31, name: "English Senior G5" },
      suggestion: null, notes: [], member_count: null,
    },
  ];

  it("pairs a group with the class picked in its row, and leaves a paired group without actions", async () => {
    await mount(<GroupsPanel />, {
      "/lcup/groups/": GROUPS,
      "/classes/directory/": [{ id: 30, name: "Math Junior G21" }, { id: 31, name: "English Senior G5" }, { id: 32, name: "Spare class" }],
    });
    const rows = [...host.querySelectorAll("tbody tr")];
    const open = rows.find((tr) => tr.textContent?.includes("Junior G21 | Math"))!;
    const paired = rows.find((tr) => tr.textContent?.includes("Senior G5 | English"))!;

    expect(open.textContent).toContain("Mon/Wed/Fri 14:00–15:30");
    expect(open.textContent).toContain("To pair");
    expect(open.textContent).toContain("Suggested: Math Junior G21 (12/14)");
    expect(open.textContent).toContain("same teacher, same days");
    expect(paired.textContent).toContain("Paired");
    expect(paired.textContent).toContain("English Senior G5");
    expect(paired.querySelector("button")).toBeNull();

    // The paired class is taken; the suggestion is chosen to start with.
    const select = open.querySelector("select")!;
    expect([...select.options].map((o) => o.textContent)).toEqual(["Choose a class…", "Math Junior G21", "Spare class"]);
    expect(select.value).toBe("30");

    await click(button("Pair", open));
    expect(post).toHaveBeenCalledWith("/lcup/groups/1/confirm/", { classroom_id: 30 });
    await click(button("Ignore", open));
    expect(post).toHaveBeenCalledWith("/lcup/groups/1/ignore/");
  });
});

describe("lc-up students", () => {
  it("links a student to a suggested account, or creates one with a sibling's phone", async () => {
    await mount(<StudentsPanel />, {
      "/lcup/students/": [
        {
          id: 7, lcup_id: 707, name: "Aziz Tursunov", phone: "", status: "needs_review", reason: "two accounts share the name",
          candidates: [{ user_id: 9, name: "Aziz Tursunov", reason: "same name" }], user: null,
          groups: ["Junior G21 | Math"], deleted: false,
        },
      ],
      "/lcup/unlinked-members/": [],
    });
    expect(get).toHaveBeenCalledWith("/lcup/students/", { params: { status: "needs_review" } });
    const row = host.querySelector("tbody tr")!;
    expect(row.textContent).toContain("no phone in lc-up");
    expect(row.textContent).toContain("Needs review");
    expect(row.textContent).toContain("two accounts share the name");
    expect(host.textContent).toContain("Every student of a paired class is linked to lc-up.");

    await click(button("Link", row));
    expect(post).toHaveBeenCalledWith("/lcup/students/7/link/", { user_id: 9 });

    const phone = row.querySelector<HTMLInputElement>('input[aria-label="Another phone"]')!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setValue.call(phone, "+998901234567");
      phone.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(button("Create account", row));
    expect(post).toHaveBeenCalledWith("/lcup/students/7/create-account/", { phone: "+998901234567" });
  });
});
