/**
 * The /ops person change form (`GET /users/admin/people/<id>/`): the core opens the page, a
 * person in the wrong section is sent to the right one, a missing account says so (never
 * "Nothing yet"), Save patches the account and reloads it, and a failing part leaves the page up.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PersonCore } from "../personApi";

const get = vi.fn();
const patch = vi.fn();
const post = vi.fn();
const toast = vi.fn();
const replace = vi.fn();
const routerPush = vi.fn();

vi.mock("@/lib/api", () => ({
  default: {
    get: (...a: unknown[]) => get(...a),
    patch: (...a: unknown[]) => patch(...a),
    post: (...a: unknown[]) => post(...a),
  },
}));
vi.mock("@/components/ToastProvider", () => ({ useToast: () => ({ push: toast }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: routerPush, prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/ops/students/7",
}));

const { PersonPage } = await import("../PersonPage");

function core(over: Partial<PersonCore> = {}): PersonCore {
  return {
    id: 7,
    section: "students",
    username: "aziz",
    first_name: "Aziz",
    last_name: "Tursunov",
    name: "Aziz Tursunov",
    email: "",
    email_verified: false,
    phone: "998901234567",
    role: "student",
    subject: "",
    status: "centre",
    is_frozen: false,
    frozen_reason: null,
    date_joined: "2026-09-01T10:00:00+05:00",
    last_seen: null,
    attempt_count: 0,
    telegram_linked: false,
    lcup_created: true,
    sat: { exam_date: null, target_score: null, target_english: null, target_math: null },
    groups: [
      {
        id: 59,
        name: "Junior G21 Math",
        subject: "MATH",
        teacher: "Vali Aliyev",
        joined_at: "2026-09-02T10:00:00+05:00",
        lcup_managed: true,
      },
    ],
    past_groups: [],
    open_classes: [{ id: 3, name: "Own class" }],
    lcup: {
      linked: true,
      balance: -250000,
      debt: 250000,
      updated_at: "2026-10-15T09:00:00+05:00",
      frozen_for_debt: false,
      freeze_day: 6,
      monthly_cost: 500000,
      groups: [{ name: "G21", monthly_cost: 500000 }],
      payments: [],
      status: "created",
      lcup_student_id: 1,
      exempt: false,
      phone_prompt: null,
    },
    duplicates: [],
    staff: null,
    ...over,
  };
}

/** Each part's empty shape, as the server sends it for an account with nothing yet. */
const PARTS: Record<string, unknown> = {
  attendance: { classes: [], recent: [] },
  results: {
    homework: [],
    overdue: [],
    assessments: [],
    mocks: [],
    practice: [],
    midterms: [],
    events: [],
    rewards: { xp: 0, coins: 0 },
  },
  security: { sessions: [], telegram_linked: false, email_verified: false, last_password_change: null },
  history: { items: [], truncated: false },
};

const CORE_URL = "/users/admin/people/7/";

function route(person: PersonCore, overrides: Record<string, () => Promise<unknown>> = {}) {
  get.mockImplementation((url: string) => {
    if (overrides[url]) return overrides[url]();
    if (url === CORE_URL) return Promise.resolve({ data: person });
    const part = /^\/users\/admin\/people\/7\/(\w+)\/$/.exec(url)?.[1];
    if (part && part in PARTS) return Promise.resolve({ data: PARTS[part] });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

let host: HTMLElement;
let root: Root;

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function renderPage(section: "students" | "public" | "staff" = "students") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <PersonPage section={section} id={7} />
      </QueryClientProvider>,
    ),
  );
  await settle();
}

/** The section box whose header reads `title`. */
const box = (title: string) =>
  ([...host.querySelectorAll("section")].find((s) => s.getAttribute("aria-label") === title) as HTMLElement | undefined) ??
  null;

function input(label: string): HTMLInputElement {
  const el = [...host.querySelectorAll("label")].find((l) => l.textContent?.trim() === label);
  const id = el?.getAttribute("for");
  return (id ? document.getElementById(id) : null) as HTMLInputElement;
}

function typeInto(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The header texts of `table`'s columns a phone hides (`hidden sm:table-cell`); every row hides the same ones. */
function phoneHidden(table: Element | null | undefined): string[] {
  const wideOnly = (el: Element) => el.classList.contains("hidden") && el.classList.contains("sm:table-cell");
  expect(table).toBeTruthy();
  const heads = [...table!.querySelectorAll("thead th")];
  for (const tr of table!.querySelectorAll("tbody tr")) {
    expect([...tr.querySelectorAll("td")].map(wideOnly)).toEqual(heads.map(wideOnly));
  }
  return heads.filter(wideOnly).map((th) => th.textContent?.trim() ?? "");
}

const button = (scope: ParentNode, text: string) =>
  [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  get.mockReset();
  patch.mockReset();
  post.mockReset();
  toast.mockReset();
  replace.mockReset();
  routerPush.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the person change form", () => {
  it("opens with the name, the lc-up seat read-only and what they owe", async () => {
    route(core());
    await renderPage();
    expect(host.querySelector("h1")?.textContent).toBe("Aziz Tursunov");

    const groups = box("Groups")!;
    const seat = [...groups.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes("Junior G21 Math"))!;
    expect(seat.textContent).toContain("Change in lc-up");
    expect(button(seat, "Remove")).toBeUndefined();

    expect(box("lc-up & payments")?.textContent).toContain("250,000 UZS");
  });

  it("keeps each table's essential columns on a phone", async () => {
    const base = core();
    route(
      core({
        lcup: {
          ...base.lcup!,
          payments: [
            { id: 1, date: "2026-10-01", kind: "payment", amount: 650000, method: "", month: "2026-10", group: "G21" },
          ],
        },
        duplicates: [
          { id: 8, name: "Aziz Tursunov", username: "aziz2", section: "public", status: "public", last_seen: null, groups: [] },
        ],
      }),
    );
    await renderPage();
    expect(phoneHidden(box("Groups")?.querySelector("table"))).toEqual(["Teacher", "Joined"]);
    expect(phoneHidden(box("lc-up & payments")?.querySelector("table"))).toEqual(["Month", "Group"]);
    expect(phoneHidden(box("Same-name accounts")?.querySelector("table"))).toEqual(["Username", "Status", "Groups"]);
  });

  it("fits the password hint in its box", async () => {
    route(core());
    await renderPage();
    expect(input("New password").placeholder).toBe("Leave blank to keep");
  });

  it("shows a learner's SAT goal and lc-up origin", async () => {
    route(core());
    await renderPage();
    const profile = box("Profile")!.textContent;
    expect(profile).toContain("SAT exam date");
    expect(profile).toContain("Set by the student");
    expect(profile).toContain("Created by lc-up");
  });

  it("gives a public user no attendance box and asks for none", async () => {
    route(core({ section: "public", status: "public", groups: [], lcup: null }));
    await renderPage("public");
    expect(host.querySelector("h1")?.textContent).toBe("Aziz Tursunov");
    expect(box("Attendance (last 30 days)")).toBeNull();
    expect(get.mock.calls.some(([url]) => url === "/users/admin/people/7/attendance/")).toBe(false);
  });

  it("offers no class seat to a public user — joining the centre is a new lc-up account", async () => {
    route(core({ section: "public", status: "public", groups: [] }));
    await renderPage("public");
    expect(host.querySelector("h1")?.textContent).toBe("Aziz Tursunov");
    expect(box("Groups")?.textContent).not.toContain("Add to class");
  });

  it("sends a person opened under the wrong section to the right one", async () => {
    route(core({ section: "public", status: "public" }));
    await renderPage("students");
    expect(replace).toHaveBeenCalledWith("/ops/public/7");
  });

  it("says a missing account does not exist — never that there is nothing yet", async () => {
    route(core(), { [CORE_URL]: () => Promise.reject({ response: { status: 404 } }) });
    await renderPage();
    expect(host.textContent).toContain("This account does not exist or is outside your scope.");
    expect(host.textContent).not.toContain("Nothing yet");
  });

  it("saves the profile and reloads the account", async () => {
    route(core());
    patch.mockResolvedValue({ data: {} });
    await renderPage();
    const callsBefore = get.mock.calls.filter(([url]) => url === CORE_URL).length;

    typeInto(input("First name"), "Azizbek");
    act(() => button(box("Profile")!, "Save")!.click());
    await settle();

    expect(patch).toHaveBeenCalledTimes(1);
    const [url, payload] = patch.mock.calls[0];
    expect(url).toBe("/users/7/update/");
    expect(payload).toMatchObject({ first_name: "Azizbek", last_name: "Tursunov", role: "student", subject: null });
    // Freezing is the header's action; the form never sends a stale frozen flag.
    expect(payload).not.toHaveProperty("is_frozen");
    expect(get.mock.calls.filter(([u]) => u === CORE_URL).length).toBeGreaterThan(callsBefore);
    expect(toast).toHaveBeenCalledWith({ tone: "success", message: "Saved." });
  });

  it("shows the server's reason inline when a save is refused", async () => {
    route(core());
    patch.mockRejectedValue({ response: { data: { phone_number: ["This phone number is taken."] } } });
    await renderPage();
    act(() => button(box("Profile")!, "Save")!.click());
    await settle();
    expect(box("Profile")?.textContent).toContain("This phone number is taken.");
  });

  it("keeps the page up when one part fails, and offers a retry there", async () => {
    route(core(), { "/users/admin/people/7/history/": () => Promise.reject(new Error("boom")) });
    await renderPage();
    expect(host.querySelector("h1")?.textContent).toBe("Aziz Tursunov");
    const history = box("History")!;
    expect(history.textContent).toContain("Could not load.");
    expect(button(history, "Retry")).toBeDefined();
    expect(history.textContent).not.toContain("Nothing yet");
  });

  it("lets an unpaired seat be removed, and a learner be added to an open class", async () => {
    route(
      core({
        groups: [
          { id: 3, name: "Own class", subject: "MATH", teacher: "Vali Aliyev", joined_at: null, lcup_managed: false },
        ],
        open_classes: [{ id: 4, name: "Other class" }],
      }),
    );
    patch.mockResolvedValue({ data: {} });
    post.mockResolvedValue({ data: {} });
    await renderPage();

    const groups = box("Groups")!;
    act(() => button(groups, "Remove")!.click());
    await settle();
    expect(patch).toHaveBeenCalledWith("/classes/3/members/7/", { status: "REMOVED" });

    const select = groups.querySelector("select") as HTMLSelectElement;
    act(() => {
      select.value = "4";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() => button(groups, "Add")!.click());
    await settle();
    expect(post).toHaveBeenCalledWith("/classes/4/members/", { user_id: 7 });
  });

  it("freezes from the header with one id on the bulk endpoint", async () => {
    route(core());
    post.mockResolvedValue({ data: { results: [{ id: 7, ok: true, is_frozen: true }] } });
    await renderPage();
    act(() => button(host, "Freeze")!.click());
    await settle();
    expect(post).toHaveBeenCalledWith("/users/admin/bulk/", { action: "freeze", ids: [7] });
    expect(toast).toHaveBeenCalledWith({ tone: "success", message: "Account frozen." });
  });

  it("asks before logging out everywhere, then says how many devices", async () => {
    route(core());
    post.mockResolvedValue({ data: { revoked: 2 } });
    await renderPage();
    act(() => button(host, "Log out everywhere")!.click());
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain("up to 3 hours");
    act(() => button(dialog, "Log out everywhere")!.click());
    await settle();
    expect(post).toHaveBeenCalledWith("/users/admin/people/7/revoke-sessions/");
    expect(toast).toHaveBeenCalledWith({ tone: "success", message: "Signed out of 2 devices." });
  });

  it("a staff member gets their classes instead of groups and lc-up", async () => {
    route(
      core({
        section: "staff",
        role: "teacher",
        subject: "math",
        status: "active",
        groups: [],
        open_classes: [],
        lcup: null,
        staff: {
          lcup_teacher: { status: "confirmed", name: "Aliyev Vali" },
          classes: [{ id: 59, name: "Junior G21 Math", subject: "MATH", as: "teacher", students: 12, lcup_managed: true }],
          workload: { classes: 1, students: 12, to_review: 3 },
        },
      }),
    );
    await renderPage("staff");
    expect(box("Groups")).toBeNull();
    expect(box("lc-up & payments")).toBeNull();
    const classes = box("Classes")!;
    expect(classes.textContent).toContain("1 class · 12 students · 3 to review");
    expect(classes.querySelector('a[href="/ops/classrooms/59"]')?.textContent).toBe("Junior G21 Math");
    expect(phoneHidden(classes.querySelector("table"))).toEqual(["lc-up"]);
    // A learner's facts are not a staff member's.
    const profile = box("Profile")!.textContent;
    expect(profile).not.toContain("SAT exam date");
    expect(profile).not.toContain("Set by the student");
    expect(profile).not.toContain("Created by lc-up");
  });
});
