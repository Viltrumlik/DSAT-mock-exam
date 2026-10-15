/**
 * The /ops person change form (`GET /users/admin/people/<id>/`), in tabs: the Overview opens with
 * the form and a read-only Summary, each other tab shows one subject and fetches its part only when
 * it opens, the open tab lives in `?tab=` beside the list's `_changelist_filters`, a person in the
 * wrong section is sent to the right one, and a missing account says so (never "Nothing yet").
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
/** The page's query string, as `useSearchParams` reads it. */
let search = "";

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
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/ops/students/7",
}));

const { PersonPage } = await import("../PersonPage");

function core(over: Partial<PersonCore> = {}): PersonCore {
  return {
    id: 7,
    section: "students",
    avatar_url: null,
    glance: { attendance_rate: 50, homework: { completed: 3, total: 4 }, mocks_taken: 0, last_mock_total: null },
    one_time_password: null,
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

const STAFF: Partial<PersonCore> = {
  section: "staff",
  glance: null,
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
};

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

const partCalls = () => get.mock.calls.map(([url]) => url as string).filter((url) => url !== CORE_URL);

let host: HTMLElement;
let root: Root;

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** Renders the page with `query` as its address's query string (e.g. "tab=groups"). */
async function renderPage(section: "students" | "public" | "staff" = "students", query = "") {
  search = query;
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

/** A fresh mount, for a second render inside one test. */
function remount() {
  act(() => root.unmount());
  root = createRoot(host);
  get.mockClear();
}

/** The section box whose header reads `title`. */
const box = (title: string) =>
  ([...host.querySelectorAll("section")].find((s) => s.getAttribute("aria-label") === title) as HTMLElement | undefined) ??
  null;

const tabLabels = () => [...host.querySelectorAll('[role="tab"]')].map((t) => t.textContent?.trim());
const tab = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((t) => t.textContent?.trim() === label);

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
  search = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the person page's tabs", () => {
  it("gives a student every subject, Payments only with lc-up", async () => {
    route(core());
    await renderPage();
    expect(tabLabels()).toEqual(["Overview", "Groups", "Payments", "Attendance", "Results", "Security", "History"]);
    expect(tab("Overview")?.getAttribute("aria-selected")).toBe("true");

    remount();
    route(core({ lcup: null }));
    await renderPage();
    expect(tabLabels()).not.toContain("Payments");
  });

  it("gives a public user no Attendance, and Groups only with earlier groups", async () => {
    route(core({ section: "public", status: "public", groups: [], lcup: null }));
    await renderPage("public");
    expect(tabLabels()).toEqual(["Overview", "Results", "Security", "History"]);

    remount();
    route(core({ section: "public", status: "public", groups: [], past_groups: [{ id: 2, name: "Old", left_at: null }] }));
    await renderPage("public");
    expect(tabLabels()).toEqual(["Overview", "Results", "Payments", "Groups", "Security", "History"]);
  });

  it("gives a staff member Overview, Classes, Security and History", async () => {
    route(core(STAFF));
    await renderPage("staff");
    expect(tabLabels()).toEqual(["Overview", "Classes", "Security", "History"]);
  });

  it("fetches no part until its tab opens", async () => {
    route(core());
    await renderPage();
    expect(partCalls()).toEqual([]);

    remount();
    await renderPage("students", "tab=attendance");
    expect(partCalls()).toEqual(["/users/admin/people/7/attendance/"]);
    expect(box("Attendance")).not.toBeNull();
  });

  it("opens a tab in the address and keeps the list it came from", async () => {
    route(core());
    await renderPage("students", "_changelist_filters=status%3Dfrozen_debt");
    act(() => tab("Attendance")!.click());
    expect(replace).toHaveBeenCalledWith(
      "/ops/students/7?_changelist_filters=status%3Dfrozen_debt&tab=attendance",
      { scroll: false },
    );
  });

  it("leaves the Overview out of the address", async () => {
    route(core());
    await renderPage("students", "tab=history&_changelist_filters=q%3Daziz");
    act(() => tab("Overview")!.click());
    expect(replace).toHaveBeenCalledWith("/ops/students/7?_changelist_filters=q%3Daziz", { scroll: false });
  });

  it("moves between tabs with the arrow keys", async () => {
    route(core());
    await renderPage();
    const list = host.querySelector('[role="tablist"]')!;
    act(() => {
      list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(replace).toHaveBeenLastCalledWith("/ops/students/7?tab=groups", { scroll: false });
    act(() => {
      list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });
    expect(replace).toHaveBeenLastCalledWith("/ops/students/7?tab=history", { scroll: false });
  });

  it("scrolls the open tab into view, so a phone opening ?tab=security sees it underlined", async () => {
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      route(core());
      await renderPage("students", "tab=security");
      expect(scrolled.map((el) => el.textContent)).toContain("Security");
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("opens the Overview for a tab it does not know, or one this person has not", async () => {
    route(core({ section: "public", status: "public", groups: [], lcup: null }));
    await renderPage("public", "tab=attendance");
    expect(tab("Overview")?.getAttribute("aria-selected")).toBe("true");
    expect(box("Profile")).not.toBeNull();
    expect(partCalls()).toEqual([]);
  });
});

describe("the Overview", () => {
  it("opens with the name, the form and a Summary of what they owe", async () => {
    route(core());
    await renderPage();
    expect(host.querySelector("h1")?.textContent).toBe("Aziz Tursunov");
    expect(box("Profile")).not.toBeNull();
    const summary = box("Summary")!.textContent;
    expect(summary).toContain("Owes 250,000 UZS");
    expect(summary).toContain("Junior G21 Math");
    expect(summary).toContain("SAT exam date");
    expect(summary).toContain("Created by lc-up");
    // The form holds only what an admin can change.
    expect(box("Profile")!.textContent).not.toContain("SAT exam date");
    expect(box("Groups")).toBeNull();
  });

  it("names the same-name accounts at the top of the Summary", async () => {
    route(
      core({
        duplicates: [
          { id: 8, name: "Aziz Tursunov", username: "aziz2", section: "public", status: "public", last_seen: null, groups: [] },
        ],
      }),
    );
    await renderPage();
    const notice = host.querySelector('[data-testid="same-name"]')!;
    expect(notice.textContent).toContain("Same name as 1 other account");
    expect(notice.querySelector('a[href="/ops/public/8"]')?.textContent).toBe("Aziz Tursunov");
    expect(notice.textContent).toContain("Public users");
  });

  it("has no new-password field — the header gives a one-time password instead", async () => {
    route(core());
    await renderPage();
    expect(input("New password")).toBeNull();
    expect(box("Profile")!.querySelector('input[type="password"]')).toBeNull();
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

  it("shows a public user only the learner facts they have", async () => {
    route(core({ section: "public", status: "public", groups: [], lcup: null, lcup_created: false }));
    await renderPage("public");
    const summary = box("Summary")!.textContent;
    expect(summary).not.toContain("Created by lc-up");
    expect(summary).not.toContain("SAT exam date");

    remount();
    route(
      core({
        section: "public",
        status: "public",
        groups: [],
        lcup: null,
        lcup_created: false,
        sat: { exam_date: "2026-12-05", target_score: 1400, target_english: null, target_math: null },
      }),
    );
    await renderPage("public");
    expect(box("Summary")!.textContent).toContain("Total 1400");
  });

  it("names the subject as the form's select does", async () => {
    route(core(STAFF));
    await renderPage("staff");
    expect(box("Summary")!.textContent).toContain("Mathematics");
  });

  it("gives a staff member their workload, and none of a learner's facts", async () => {
    route(core(STAFF));
    await renderPage("staff");
    const summary = box("Summary")!.textContent;
    expect(summary).toContain("1 · 12 students");
    expect(summary).toContain("Aliyev Vali");
    expect(summary).not.toContain("SAT exam date");
    expect(summary).not.toContain("Created by lc-up");
  });
});

describe("the subject tabs", () => {
  it("shows an lc-up seat read-only on the Groups tab", async () => {
    route(core());
    await renderPage("students", "tab=groups");
    const groups = box("Groups")!;
    const seat = [...groups.querySelectorAll('[data-testid="group-card"]')].find((c) => c.textContent?.includes("Junior G21 Math"))!;
    expect(seat.textContent).toContain("Synced from lc-up");
    expect(seat.textContent).toContain("Vali Aliyev");
    expect(button(seat, "Remove")).toBeUndefined();
    expect(box("Profile")).toBeNull();
  });

  it("lets an unpaired seat be removed, and a student be added to an open class", async () => {
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
    await renderPage("students", "tab=groups");

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

  it("offers no class seat to a public user — joining the centre is a new lc-up account", async () => {
    route(core({ section: "public", status: "public", groups: [], past_groups: [{ id: 2, name: "Old", left_at: null }] }));
    await renderPage("public", "tab=groups");
    const groups = box("Groups")!;
    expect(groups.textContent).toContain("Old");
    expect(groups.textContent).not.toContain("Add to class");
  });

  it("shows the payments on the Payments tab, essential columns on a phone", async () => {
    const base = core();
    route(
      core({
        lcup: {
          ...base.lcup!,
          payments: [
            { id: 1, date: "2026-10-01", kind: "payment", amount: 650000, method: "", month: "2026-10", group: "G21" },
          ],
        },
      }),
    );
    await renderPage("students", "tab=payments");
    const payments = box("lc-up & payments")!;
    expect(payments.textContent).toContain("250,000 UZS");
    expect(phoneHidden(payments.querySelector("table"))).toEqual(["Month", "Group"]);
  });

  it("keeps the page up when a part fails, and offers a retry there", async () => {
    route(core(), { "/users/admin/people/7/history/": () => Promise.reject(new Error("boom")) });
    await renderPage("students", "tab=history");
    expect(host.querySelector("h1")?.textContent).toBe("Aziz Tursunov");
    const history = box("History")!;
    expect(history.textContent).toContain("Could not load.");
    expect(button(history, "Retry")).toBeDefined();
    expect(history.textContent).not.toContain("Nothing yet");
  });

  it("shows a staff member's classes on the Classes tab", async () => {
    route(core(STAFF));
    await renderPage("staff", "tab=classes");
    const classes = box("Classes")!;
    expect(classes.textContent).toContain("1 class · 12 students · 3 to review");
    expect(classes.querySelector('a[href="/ops/classrooms/59"]')?.textContent).toBe("Junior G21 Math");
    expect(phoneHidden(classes.querySelector("table"))).toEqual(["lc-up"]);
  });
});

describe("the page around the tabs", () => {
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
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="More actions"]')!.click());
    act(() => [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent === "Log out everywhere")!.click());
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain("up to 3 hours");
    act(() => button(dialog, "Log out everywhere")!.click());
    await settle();
    expect(post).toHaveBeenCalledWith("/users/admin/people/7/revoke-sessions/");
    expect(toast).toHaveBeenCalledWith({ tone: "success", message: "Signed out of 2 devices." });
  });
});

describe("the header", () => {
  it("shows the photo beside the name, or the initials without one", async () => {
    route(core({ avatar_url: "https://cdn.example/aziz.jpg" }));
    await renderPage();
    expect(host.querySelector("img")?.getAttribute("src")).toBe("https://cdn.example/aziz.jpg");

    remount();
    route(core());
    await renderPage();
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain("AT");
  });

  it("says what the account is and its state, each in its colour", async () => {
    route(core({ is_frozen: true, frozen_reason: "debt", status: "frozen_debt" }));
    await renderPage();
    const header = host.querySelector("h1")!.closest(".rounded-2xl") as HTMLElement;
    expect(header.textContent).toContain("Student");
    expect(header.textContent).toContain("Frozen — unpaid");
    expect(header.textContent).toContain("lc-up linked");
    expect(header.textContent).toContain("Never signed in");
    expect(header.textContent).toContain("+998 90 123 45 67");
  });

  it("puts what matters at a glance: the debt, attendance and homework", async () => {
    route(core());
    await renderPage();
    const header = host.querySelector("h1")!.closest(".rounded-2xl") as HTMLElement;
    expect(header.textContent).toContain("Owes250,000 UZS");
    expect(header.textContent).toContain("50%");
    expect(header.textContent).toContain("3 / 4");
  });

  it("gives a one-time password after a confirm, and says what to tell them", async () => {
    route(core());
    post.mockResolvedValue({ data: { login: "998901234567", code: "4567", expires_at: "2026-10-29T10:00:00+05:00" } });
    await renderPage();
    act(() => button(host, "One-time password")!.click());
    let dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain("+998 90 123 45 67 · password 4567");
    act(() => button(dialog, "Give one-time password")!.click());
    await settle();
    expect(post).toHaveBeenCalledWith("/users/admin/people/7/one-time-password/");
    dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain("One-time password is ready");
    expect(dialog.textContent).toContain("4567");
    act(() => button(dialog, "Done")!.click());
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("says why when the server refuses a one-time password", async () => {
    route(core());
    post.mockRejectedValue({ response: { data: { detail: "Another account is waiting to sign in with this phone number." } } });
    await renderPage();
    act(() => button(host, "One-time password")!.click());
    act(() => button(host.querySelector('[role="dialog"]')!, "Give one-time password")!.click());
    await settle();
    expect(toast).toHaveBeenCalledWith({ tone: "error", message: "Another account is waiting to sign in with this phone number." });
  });

  it("needs a phone for a one-time password, and offers none for an admin", async () => {
    route(core({ phone: "" }));
    await renderPage();
    expect(button(host, "One-time password")!.disabled).toBe(true);

    remount();
    route(core({ ...STAFF, role: "admin", subject: "" }));
    await renderPage("staff");
    expect(button(host, "One-time password")).toBeUndefined();
  });

  it("shows an open one-time password", async () => {
    route(core({ one_time_password: { expires_at: "2026-10-29T10:00:00+05:00", used: false, locked: false } }));
    await renderPage();
    expect(host.textContent).toContain("One-time password · until Oct 29, 2026");
  });
});
