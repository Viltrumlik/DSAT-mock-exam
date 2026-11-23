/**
 * A centre student's page in lc-up's shape (StudentProfile board, 22 Nov 2026): the left card (photo, name, ✎, ID,
 * the signed balance, Take payment, SMS, ⋮ and the facts), and lc-up's tabs on the right in lc-up's order, then
 * Attendance and Security. Every part of the old page is still reachable: the forms behind ✎, the account actions
 * behind ⋮, Results split into Exams / Exercises / Coins, the lc-up link on Payments.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ me: undefined as Record<string, unknown> | undefined }));
vi.mock("@/hooks/useMe", async (importOriginal) => {
  const { ADMIN_ME } = await import("@/features/ops/testing/me");
  return { ...(await importOriginal<typeof import("@/hooks/useMe")>()), useMe: () => ({ me: session.me ?? ADMIN_ME }) };
});

import type { PersonCore } from "../personApi";

const get = vi.fn();
const patch = vi.fn();
const post = vi.fn();
const toast = vi.fn();
const replace = vi.fn();
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
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
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
    parent: { name: "Karim", phone: "998903001172" },
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
    sat: { exam_date: "2026-12-05", target_score: 1400, target_english: null, target_math: null },
    groups: [
      {
        id: 59,
        name: "Junior G21 Math",
        subject: "MATH",
        teacher: "Vali Aliyev",
        joined_at: "2026-09-02T10:00:00+05:00",
        lcup_managed: true,
        level: "junior",
        lesson_days: "ODD",
        lesson_time: "16:00-18:00",
        monthly_price: 500000,
        start_date: "2026-09-01",
        seat_status: "active",
        seat_start_date: "2026-09-03",
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
      debt_notice: true,
      freeze_day: 6,
      monthly_cost: 500000,
      groups: [{ name: "G21", monthly_cost: 500000 }],
      payments: [],
      status: "created",
      lcup_student_id: 1,
      exempt: false,
      freeze_on: false,
      phone_prompt: null,
    },
    ledger: null,
    seats_open: false,
    coins: null,
    duplicates: [],
    staff: null,
    ...over,
  };
}

const RESULTS = {
  homework: [{ class_id: 59, class_name: "Junior G21 Math", rate: 75, completed: 3, total: 4 }],
  overdue: [],
  assessments: [],
  mocks: [{ title: "Mock 3", english: 600, math: 650, total: 1250, at: "2026-10-01T10:00:00+05:00" }],
  practice: [],
  midterms: [],
  events: [],
  rewards: { xp: 120, coins: 9 },
};

const PARTS: Record<string, unknown> = {
  attendance: { classes: [], recent: [] },
  results: RESULTS,
  security: { sessions: [], telegram_linked: false, email_verified: false, last_password_change: null },
  history: { items: [], truncated: false },
  purchases: {
    orders: [
      { id: 1, item: "Notebook", currency: "COIN", price: 3, status: "FULFILLED", status_label: "Handed over", note: "", at: "2026-10-02T10:00:00+05:00", settled_at: null },
    ],
    truncated: false,
  },
};

const CORE_URL = "/users/admin/people/7/";

const ACCOUNT = {
  id: 5,
  name: "Tursunov Aziz",
  phone: "",
  balance: -250000,
  seats: [
    { id: 11, group_name: "Junior G21 Math", state: "active", price: 500000, personal_price: null, price_changes: [] },
    { id: 12, group_name: "English G4", state: "active", price: 400000, personal_price: 300000, price_changes: [
      { at: "2026-10-03T10:00:00+05:00", old_price: null, new_price: 300000, reason: "sibling", by: "boss" },
    ] },
  ],
  rows: [],
  payments_open: true,
};

function route(person: PersonCore, overrides: Record<string, () => Promise<unknown>> = {}) {
  get.mockImplementation((url: string) => {
    if (overrides[url]) return overrides[url]();
    if (url === CORE_URL) return Promise.resolve({ data: person });
    if (url === "/billing/accounts/5/") return Promise.resolve({ data: ACCOUNT });
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

async function renderPage(query = "") {
  search = query;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <PersonPage section="students" id={7} />
      </QueryClientProvider>,
    ),
  );
  await settle();
}

function remount() {
  act(() => root.unmount());
  root = createRoot(host);
  get.mockClear();
}

const box = (title: string, scope: ParentNode = document.body) =>
  ([...scope.querySelectorAll("section")].find((s) => s.getAttribute("aria-label") === title) as HTMLElement | undefined) ?? null;
const tabName = (t: Element) => {
  const c = t.cloneNode(true) as Element;
  c.querySelectorAll("[data-tab-count]").forEach((n) => n.remove());
  return c.textContent?.trim();
};
const tabLabels = () => [...host.querySelectorAll('[role="tab"]')].map(tabName);
const tab = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((t) => tabName(t) === label);
const button = (scope: ParentNode, text: string) =>
  [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
const card = () => host.querySelector('aside[aria-label="Student"]') as HTMLElement;
const sheet = () => [...document.body.querySelectorAll('[role="dialog"]')].pop() as HTMLElement | undefined;

async function click(el: Element | null | undefined) {
  await act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
}

/** Opens a ⋮ and picks the item whose name starts with `label`. */
async function menuPick(menuLabel: string, label: string, scope: ParentNode = host) {
  await click(scope.querySelector(`button[aria-label="${menuLabel}"]`));
  const item = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((b) => b.textContent?.startsWith(label));
  expect(item, `menu item ${label}`).toBeTruthy();
  await click(item);
}

const menuItems = async (menuLabel: string, scope: ParentNode = host) => {
  await click(scope.querySelector(`button[aria-label="${menuLabel}"]`));
  const items = [...document.body.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent ?? "");
  await click(scope.querySelector(`button[aria-label="${menuLabel}"]`));
  return items;
};

function typeInto(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function labelled(scope: ParentNode, label: string): HTMLInputElement {
  const l = [...scope.querySelectorAll("label")].find((x) => x.textContent?.trim().startsWith(label))!;
  return document.getElementById(l.getAttribute("for")!) as HTMLInputElement;
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  get.mockReset();
  patch.mockReset();
  post.mockReset();
  toast.mockReset();
  replace.mockReset();
  search = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  session.me = undefined;
});

describe("the tabs", () => {
  it("are lc-up's, in lc-up's order, then Attendance and Security; Groups opens first", async () => {
    route(core());
    await renderPage();
    expect(tabLabels()).toEqual([
      "Groups", "Payments", "Notes", "Discounts", "Exams", "History", "Purchases", "SMS", "Exercises", "Coins & crystals", "Attendance", "Security",
    ]);
    expect(tab("Groups")?.getAttribute("aria-selected")).toBe("true");
  });

  it("keep money and SMS to the viewers who hold them", async () => {
    session.me = { role: "teacher", permissions: ["view_people"] };
    route(core());
    await renderPage();
    expect(tabLabels()).not.toContain("Payments");
    expect(tabLabels()).not.toContain("Discounts");
    expect(tabLabels()).not.toContain("SMS");
    expect(card().textContent).not.toContain("Balance");
    expect(button(card(), "Take payment")).toBeUndefined();
    // No account actions: only what the old Groups tab offered everyone (the add picker).
    expect(await menuItems("More actions")).toEqual(["Add to group"]);
  });

  it("fetch no part until a tab needs one", async () => {
    route(core());
    await renderPage();
    expect(partCalls()).toEqual([]);
    remount();
    await renderPage("tab=attendance");
    expect(partCalls()).toEqual(["/users/admin/people/7/attendance/"]);
  });

  it("open in the address, keep the list it came from, and leave Groups out", async () => {
    route(core());
    await renderPage("_changelist_filters=status%3Dfrozen_debt");
    act(() => tab("Attendance")!.click());
    expect(replace).toHaveBeenCalledWith("/ops/students/7?_changelist_filters=status%3Dfrozen_debt&tab=attendance", { scroll: false });
    act(() => tab("Groups")!.click());
    expect(replace).toHaveBeenLastCalledWith("/ops/students/7?_changelist_filters=status%3Dfrozen_debt", { scroll: false });
  });

  it("move with the arrow keys", async () => {
    route(core());
    await renderPage();
    const list = host.querySelector('[role="tablist"]')!;
    act(() => {
      list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(replace).toHaveBeenLastCalledWith("/ops/students/7?tab=payments", { scroll: false });
  });

  it("scroll the open tab into view, so a phone opening ?tab=security sees it underlined", async () => {
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      route(core());
      await renderPage("tab=security");
      expect(scrolled.map((el) => el.textContent)).toContain("Security");
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("read the old addresses: the Overview is Groups, Results is Exams", async () => {
    route(core());
    await renderPage("tab=overview");
    expect(tab("Groups")?.getAttribute("aria-selected")).toBe("true");
    remount();
    await renderPage("tab=results");
    expect(tab("Exams")?.getAttribute("aria-selected")).toBe("true");
  });

  it("say in one line what this system does not keep, never sample rows", async () => {
    route(core());
    await renderPage("tab=notes");
    expect(host.querySelector('[data-testid="not-kept"]')?.textContent).toBe("Notes are not kept in this system yet.");
    remount();
    await renderPage("tab=coins");
    expect(host.textContent).toContain("Crystals are not kept in this system yet.");
    expect(host.querySelector('[data-testid="rewards"]')?.textContent).toContain("120");
  });

  it("split the results: Exams has the mocks, Exercises the homework", async () => {
    route(core());
    await renderPage("tab=exams");
    expect(host.textContent).toContain("Mock 3");
    expect(host.textContent).not.toContain("75%");
    remount();
    await renderPage("tab=exercises");
    expect(host.textContent).toContain("75%");
    expect(host.textContent).not.toContain("Mock 3");
  });

  it("list the shop purchases on Purchases", async () => {
    route(core());
    await renderPage("tab=purchases");
    const purchases = box("Purchases", host)!;
    expect(purchases.textContent).toContain("Notebook");
    expect(purchases.textContent).toContain("3 coins");
    expect(purchases.textContent).toContain("Handed over");
  });

  it("keep the page up when a part fails, with a retry there", async () => {
    route(core(), { "/users/admin/people/7/history/": () => Promise.reject(new Error("boom")) });
    await renderPage("tab=history");
    expect(host.querySelector("h1")?.textContent).toContain("Aziz Tursunov");
    const history = box("History", host)!;
    expect(history.textContent).toContain("Could not load.");
    expect(button(history, "Retry")).toBeDefined();
  });
});

describe("the left card", () => {
  it("shows the photo, or a placeholder without one — never invented initials", async () => {
    route(core({ avatar_url: "https://cdn.example/aziz.jpg" }));
    await renderPage();
    expect(card().querySelector("img")?.getAttribute("src")).toBe("https://cdn.example/aziz.jpg");
    remount();
    route(core());
    await renderPage();
    expect(card().querySelector("img")).toBeNull();
    expect(card().querySelector('[aria-label="No photo"]')).not.toBeNull();
  });

  it("says the name, the ID and the day the account was added", async () => {
    route(core());
    await renderPage();
    expect(host.querySelector("h1")?.textContent).toContain("Aziz Tursunov");
    expect(card().textContent).toContain("ID 7 · added 1 Sep 2026");
  });

  it("shows the balance as a signed number, tinted, with no word beside it", async () => {
    route(core());
    await renderPage();
    const balance = card().querySelector('[data-testid="balance"]') as HTMLElement;
    expect(balance.textContent).toContain("Balance, so'm−250 000");
    expect(balance.className).toContain("bg-ms-critical-soft");
    expect(card().textContent).not.toMatch(/Owes|Paid up|In debt/);
  });

  it("shows the coins only when the student has a wallet", async () => {
    route(core());
    await renderPage();
    expect(card().textContent).not.toContain("Coins");
    remount();
    route(core({ coins: 120 }));
    await renderPage();
    expect(card().textContent).toContain("Coins120");
  });

  it("edits the coins with the rewards ledger's adjustment, a reason required", async () => {
    route(core({ coins: 120 }));
    post.mockResolvedValue({ data: {} });
    await renderPage();
    await click(card().querySelector('button[aria-label="Edit coins"]'));
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    typeInto(labelled(dialog, "Coins"), "5");
    await click(button(dialog, "Save"));
    expect(post).not.toHaveBeenCalled();
    expect(dialog.textContent).toContain("Say what the coins are for.");
    typeInto(labelled(dialog, "What for"), "Olympiad prize");
    await click(button(dialog, "Save"));
    expect(post).toHaveBeenCalledWith("/rewards/wallet/7/", { action: "adjust", amount: 5, reference: "Olympiad prize" });
  });

  it("says the account's state, each in its colour, and explains a freeze in words", async () => {
    route(core({ is_frozen: true, frozen_reason: "debt", status: "frozen_debt" }));
    await renderPage();
    expect(card().textContent).toContain("Frozen for debt");
    expect(card().textContent).toContain("The freeze lifts when lc-up records the payment.");
    expect(card().textContent).toContain("lc-up linked");
    expect(card().textContent).toContain("Never signed in");
  });

  it("lists the phone, the parent, the group as its course tag, and last seen", async () => {
    route(core());
    await renderPage();
    const facts = [...card().querySelectorAll("dt")].map((d) => d.textContent);
    expect(facts).toEqual(["Phone", "Parent", "Group", "Last seen"]);
    expect(card().textContent).toContain("+998 90 123 45 67");
    expect(card().textContent).toContain("Karim · +998 90 300 11 72");
    expect(card().querySelector('[data-course="junior"]')?.textContent).toBe("Junior G21 Math");
  });

  it("says today's mark, the class and its lesson time", async () => {
    route(core({ glance: { attendance_rate: 50, homework: null, mocks_taken: 0, last_mock_total: null, today: [{ class_id: 21, class_name: "Junior G21 Math", lesson_time: "15:00", status: "LATE" }] } }));
    await renderPage();
    const dts = [...card().querySelectorAll("dt")];
    const today = dts.find((d) => d.textContent === "Today")!.nextElementSibling!;
    expect(today.textContent).toBe("Late · Junior G21 Math · lesson 15:00");
  });

  it("opens the rest under + More information", async () => {
    route(core());
    await renderPage();
    expect(card().textContent).not.toContain("SAT exam date");
    await click(button(card(), "+ More information"));
    expect(card().textContent).toContain("SAT exam date5 Dec 2026");
    expect(card().textContent).toContain("Total 1400 · set by the student");
    expect(card().textContent).toContain("Created by lc-upYes");
  });

  it("names the same-name accounts above both columns", async () => {
    route(core({ duplicates: [{ id: 8, name: "Aziz Tursunov", username: "aziz2", section: "public", status: "public", last_seen: null, groups: [] }] }));
    await renderPage();
    const notice = host.querySelector('[data-testid="same-name"]')!;
    expect(notice.textContent).toContain("Same name as 1 other account");
    expect(notice.querySelector('a[href="/ops/public/8"]')?.textContent).toBe("Aziz Tursunov");
  });

  it("keeps the card on every tab", async () => {
    route(core());
    await renderPage("tab=attendance");
    expect(card().textContent).toContain("Aziz Tursunov");
    expect(card().textContent).toContain("−250 000");
  });
});

describe("✎ — the account and parent forms", () => {
  it("open in a sheet and save the profile", async () => {
    route(core());
    patch.mockResolvedValue({ data: {} });
    await renderPage();
    await click(card().querySelector('button[aria-label="Edit student"]'));
    const profile = box("Profile")!;
    expect(profile).not.toBeNull();
    expect(box("Parent")).not.toBeNull();
    expect(profile.querySelector('input[type="password"]')).toBeNull();
    typeInto(labelled(profile, "First name"), "Azizbek");
    await click(button(profile, "Save"));
    const [url, payload] = patch.mock.calls[0];
    expect(url).toBe("/users/7/update/");
    expect(payload).toMatchObject({ first_name: "Azizbek", last_name: "Tursunov", role: "student" });
    expect(payload).not.toHaveProperty("is_frozen");
    expect(toast).toHaveBeenCalledWith({ tone: "success", message: "Saved." });
  });

  it("lock the name and phone lc-up sets", async () => {
    route(core({ lcup_locked_fields: ["first_name", "last_name", "phone_number"] }));
    await renderPage();
    await click(card().querySelector('button[aria-label="Edit student"]'));
    const profile = box("Profile")!;
    expect([labelled(profile, "First name").disabled, labelled(profile, "Phone").disabled]).toEqual([true, true]);
    expect(labelled(profile, "Username").disabled).toBe(false);
    expect(profile.textContent).toContain("Set in lc-up");
  });

  it("show the server's reason inline when a save is refused", async () => {
    route(core());
    patch.mockRejectedValue({ response: { data: { phone_number: ["This phone number is taken."] } } });
    await renderPage();
    await click(card().querySelector('button[aria-label="Edit student"]'));
    await click(button(box("Profile")!, "Save"));
    expect(box("Profile")?.textContent).toContain("This phone number is taken.");
  });

  it("offer an administrator only the learner roles", async () => {
    route(core());
    await renderPage();
    await click(card().querySelector('button[aria-label="Edit student"]'));
    const select = [...box("Profile")!.querySelectorAll("select")].find((sel) => [...sel.options].some((o) => o.value === "student"))!;
    expect([...select.options].map((o) => o.value)).toEqual(["student", "public_student"]);
  });
});

describe("⋮ — lc-up's actions that exist here", () => {
  it("lists edit, add to group, SMS, then the account's own — never 'Lidga qaytarish'", async () => {
    route(core());
    await renderPage();
    const items = await menuItems("More actions");
    expect(items).toEqual(["Edit", "Add to group", "SMS", "Freeze", "One-time password", "Log out everywhere", "Delete account"]);
  });

  it("freezes with one id on the bulk endpoint, and stays shut while that runs", async () => {
    route(core());
    let release!: () => void;
    post.mockImplementation(() => new Promise((r) => (release = () => r({ data: { results: [{ id: 7, ok: true }] } }))));
    await renderPage();
    await menuPick("More actions", "Freeze");
    expect(post).toHaveBeenCalledWith("/users/admin/bulk/", { action: "freeze", ids: [7] });
    const more = host.querySelector<HTMLButtonElement>('button[aria-label="More actions"]')!;
    expect(more.disabled).toBe(true);
    await act(async () => release());
    await settle();
    expect(more.disabled).toBe(false);
    expect(toast).toHaveBeenCalledWith({ tone: "success", message: "Account frozen." });
  });

  it("asks before logging out everywhere", async () => {
    route(core());
    post.mockResolvedValue({ data: { revoked: 2 } });
    await renderPage();
    await menuPick("More actions", "Log out everywhere");
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain("up to 3 hours");
    await click(button(dialog, "Log out everywhere"));
    expect(post).toHaveBeenCalledWith("/users/admin/people/7/revoke-sessions/");
    expect(toast).toHaveBeenCalledWith({ tone: "success", message: "Signed out of 2 devices." });
  });

  it("gives a one-time password after a confirm, and needs a phone for one", async () => {
    route(core());
    post.mockResolvedValue({ data: { login: "998901234567", code: "4567", expires_at: "2026-10-29T10:00:00+05:00" } });
    await renderPage();
    await menuPick("More actions", "One-time password");
    let dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain("+998 90 123 45 67 · password 4567");
    await click(button(dialog, "Give one-time password"));
    expect(post).toHaveBeenCalledWith("/users/admin/people/7/one-time-password/");
    dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain("One-time password is ready");

    remount();
    route(core({ phone: "" }));
    await renderPage();
    const items = await menuItems("More actions");
    expect(items).toContain("One-time passwordAdd a phone number first");
  });

  it("says why when the server refuses a one-time password", async () => {
    route(core());
    post.mockRejectedValue({ response: { data: { detail: "Another account is waiting to sign in with this phone number." } } });
    await renderPage();
    await menuPick("More actions", "One-time password");
    await click(button(host.querySelector('[role="dialog"]')!, "Give one-time password"));
    expect(toast).toHaveBeenCalledWith({ tone: "error", message: "Another account is waiting to sign in with this phone number." });
  });

  it("shows an open one-time password", async () => {
    route(core({ one_time_password: { expires_at: "2026-10-29T10:00:00+05:00", used: false, locked: false } }));
    await renderPage();
    expect(card().textContent).toContain("One-time password · until 29 Oct 2026");
  });

  it("'Add to group' opens Groups with the picker", async () => {
    route(core());
    await renderPage("tab=history");
    await menuPick("More actions", "Add to group");
    expect(replace).toHaveBeenLastCalledWith("/ops/students/7", { scroll: false });
  });
});

describe("Take payment", () => {
  it("says why it is closed while lc-up takes the money", async () => {
    route(core({ ledger: { account_id: 5, payments_open: false } }));
    await renderPage();
    expect(button(card(), "Take payment")!.disabled).toBe(true);
    expect(card().textContent).toContain("Payments are entered in lc-up until the cutover.");
  });

  it("asks for the group when the student has two, and saves it on the payment, not in the note", async () => {
    route(core({ ledger: { account_id: 5, payments_open: true } }));
    post.mockResolvedValue({ data: { balance: 0 } });
    await renderPage();
    await click(button(card(), "Take payment"));
    const form = sheet()!;
    expect(form.textContent).toContain("Group");
    // The chips are the account's own numbers: its debt, the chosen group's month.
    expect(button(form, "Debt 250 000")).toBeDefined();
    await click(button(form, "Debt 250 000"));
    expect(form.textContent).toContain("Balance after, so'm: 0");
    expect(button(form, "Take 250 000 so'm")!.disabled).toBe(true);
    await click(form.querySelector('button[aria-haspopup="listbox"]'));
    await click([...document.body.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes("English G4")));
    expect(button(form, "1 month 300 000")).toBeDefined();
    await click(button(form, "Take 250 000 so'm"));
    expect(post).toHaveBeenCalledTimes(1);
    const [url, body] = post.mock.calls[0];
    expect(url).toBe("/billing/accounts/5/entries/");
    // The group is the payment's own field (its seat); the note stays the person's words.
    expect(body).toMatchObject({ kind: "payment", amount: 250000, method: "Naqd pul", note: "", seat: 12 });
  });

  it("is a group card's first ⋮ item, with that group chosen", async () => {
    route(core({ ledger: { account_id: 5, payments_open: true } }));
    await renderPage();
    await menuPick("Group actions for Junior G21 Math", "Take payment");
    expect(sheet()!.textContent).toContain("Aziz Tursunov · Junior G21 Math");
  });

  it("offers a refund and an edit of the balance in ⋮ once money is entered here", async () => {
    route(core({ ledger: { account_id: 5, payments_open: true } }));
    await renderPage();
    const items = await menuItems("More actions");
    expect(items).toContain("Refund a payment");
    expect(items).toContain("Edit balance");
  });
});

describe("Groups", () => {
  it("gives each group a card: the course tag, the seat, and lc-up's fields", async () => {
    route(core());
    await renderPage();
    const seat = host.querySelector('[data-testid="group-card"]') as HTMLElement;
    expect(seat.querySelector('[data-course="junior"]')?.textContent).toBe("Junior G21 Math · Aliyev");
    expect(seat.textContent).toContain("Active");
    expect(seat.textContent).toContain("Synced from lc-up");
    const facts = Object.fromEntries([...seat.querySelectorAll("dt")].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]));
    expect(facts).toEqual({
      Teacher: "Vali Aliyev",
      Days: "Mon Wed Fri",
      Time: "16:00–18:00",
      Course: "Junior Math",
      "Group price": "500 000 so'm",
      "Group starts": "1 Sep 2026",
      "Joined the group": "2 Sep 2026",
      "Activated in the group": "3 Sep 2026",
    });
    // No tool changes the activation date while lc-up runs, so no ✎.
    expect(seat.querySelector('button[aria-label="Change Activated in the group"]')).toBeNull();
    // A seat lc-up runs has no remove; with the ledger shut there is nothing in a ⋮ either.
    expect(seat.querySelector('button[aria-label="Group actions for Junior G21 Math"]')).toBeNull();
  });

  it("'Attendance & marks' opens the Attendance tab", async () => {
    route(core());
    await renderPage();
    await click(button(host, "Attendance & marks"));
    expect(replace).toHaveBeenLastCalledWith("/ops/students/7?tab=attendance", { scroll: false });
  });

  it("lets an unpaired seat be removed, and a student be added to another group", async () => {
    route(core({ groups: [{ ...core().groups[0], id: 3, name: "Own class", lcup_managed: false }], open_classes: [{ id: 4, name: "Other class" }] }));
    patch.mockResolvedValue({ data: {} });
    post.mockResolvedValue({ data: {} });
    await renderPage();
    await menuPick("Group actions for Own class", "Remove from group");
    expect(patch).toHaveBeenCalledWith("/classes/3/members/7/", { status: "REMOVED" });

    await click(button(host, "Add to another group"));
    await click(host.querySelector('button[aria-label="Add to another group"]'));
    await click([...document.body.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes("Other class")));
    await click(button(host, "Add"));
    expect(post).toHaveBeenCalledWith("/classes/4/members/", { user_id: 7 });
  });

  it("once lc-up is off, freezes a seat and fixes its activation date with the seat tools", async () => {
    route(core({ seats_open: true }));
    post.mockResolvedValue({ data: {} });
    await renderPage();
    await menuPick("Group actions for Junior G21 Math", "Freeze");
    let dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain("Freeze Aziz Tursunov?");
    await click(button(dialog, "Freeze"));
    expect(post.mock.calls[0][0]).toBe("/classes/admin/classrooms/59/seats/7/freeze/");

    await click(host.querySelector('button[aria-label="Change Activated in the group"]'));
    dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect((dialog.querySelector('input[type="date"]') as HTMLInputElement).value).toBe("2026-09-03");
  });

  it("once lc-up is off, adds them to another group with the seat tools: trial or paid, from a date", async () => {
    route(core({ seats_open: true, open_classes: [{ id: 4, name: "Other class" }] }));
    post.mockResolvedValue({ data: {} });
    await renderPage();
    await click(button(host, "Add to another group"));
    await click(host.querySelector('button[aria-label="Add to another group"]'));
    await click([...document.body.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes("Other class")));
    await click(button(host, "Add"));
    expect(post).not.toHaveBeenCalled(); // never the bare roster add, which writes no money
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain("Add Aziz Tursunov to this group?");
    await click(button(dialog, "Add to group"));
    expect(post.mock.calls[0][0]).toBe("/classes/admin/classrooms/4/seats/");
    expect(post.mock.calls[0][1]).toMatchObject({ user_id: 7, status: "trial" });
  });
});

describe("Payments", () => {
  it("shows the month's fee, what was paid toward it, every payment signed, and the lc-up link", async () => {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const base = core();
    route(
      core({
        lcup: {
          ...base.lcup!,
          payments: [
            { id: 1, date: `${month}-03`, kind: "payment", amount: 300000, method: "Naqd pul", month, group: "Junior G21 Math" },
            { id: 2, date: `${month}-04`, kind: "refund", amount: 50000, method: "Plastik karta", month, group: "Junior G21 Math" },
          ],
        },
      }),
    );
    await renderPage("tab=payments");
    const payments = box("Payments", host)!;
    expect(payments.textContent).toContain("Paid toward it250 000");
    expect(payments.textContent).toContain("Left to pay250 000");
    const cells = [...payments.querySelectorAll("tbody tr")].map((tr) => tr.querySelectorAll("td")[1]);
    expect(cells.map((td) => [td.textContent, td.getAttribute("data-verdict")])).toEqual([
      ["+300 000", "positive"],
      ["−50 000", "critical"],
    ]);
    expect(payments.querySelector('button[aria-label="Payment method"]')).not.toBeNull();
    expect(payments.textContent).toContain("lc-up ID1");
  });
});

describe("Discounts", () => {
  it("shows the ledger's personal prices and who set them", async () => {
    route(core({ ledger: { account_id: 5, payments_open: false } }));
    await renderPage("tab=discounts");
    const discounts = box("Discounts", host)!;
    const rows = [...discounts.querySelectorAll("tbody tr")].map((tr) => tr.textContent);
    expect(rows[0]).toContain("Group price");
    expect(rows[1]).toContain("300 000 so'm");
    expect(rows[1]).toContain("sibling");
  });

  it("says so when the student has no ledger account", async () => {
    route(core());
    await renderPage("tab=discounts");
    expect(host.querySelector('[data-testid="not-kept"]')?.textContent).toContain("no account in the centre's ledger");
  });
});
