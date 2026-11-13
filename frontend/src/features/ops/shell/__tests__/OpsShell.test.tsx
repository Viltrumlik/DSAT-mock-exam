/**
 * The consoles' frame, Shell v0.4 (design handoff, Shell board): a dark category rail, the panel of the category you
 * are in (pinned, or a flyout when folded — remembered), the top bar's three-level breadcrumb with pin-this-page,
 * the phone's tab bar and sheet. Every page, label, count and role rule as before.
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_ME, TEACHER_ME } from "@/features/ops/testing/me";

const logout = vi.fn();
const get = vi.fn();
const push = vi.fn();
let mockPath = "/ops/students";

vi.mock("@/lib/api", () => ({
  authApi: { logout: (...args: unknown[]) => logout(...args) },
  default: { get: (...args: unknown[]) => get(...args) },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => mockPath,
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
}));

const { OpsShell } = await import("../OpsShell");
const { BUILDER_CONSOLE } = await import("@/features/builderShell/builderNav");
const { Tabs } = await import("@/features/console/ui");

const SUPER_ADMIN = { id: 1, role: "super_admin", permissions: ["*"], first_name: "Aziza", last_name: "Karimova" };
// As GET /users/me/ gives them since the CRM permissions: the administrator holds every CRM permission, a teacher none.
const ADMIN = { id: 2, role: "admin", permissions: ADMIN_ME.permissions, username: "desk1" };
const TEACHER = { id: 3, role: "teacher", permissions: TEACHER_ME.permissions, username: "t1" };

const FOLLOWUPS_URL = "/lcup/followups/";
const followups = (pending: number) => ({
  data: { free_trial_lessons: 1, trials: [], not_on_list: [], pending },
});

let container: HTMLDivElement;
let root: Root;

function render(pathname: string, me: Record<string, unknown>, config?: typeof BUILDER_CONSOLE, page: React.ReactNode = <p>page body</p>) {
  mockPath = pathname;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <OpsShell pathname={pathname} me={me} config={config}>
          {page}
        </OpsShell>
      </QueryClientProvider>,
    );
  });
}

/** The queries start on mount and resolve a tick later; let both happen before asserting. */
async function settle() {
  for (let tick = 0; tick < 4; tick++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const followupCalls = () => get.mock.calls.filter(([url]) => url === FOLLOWUPS_URL);
const shell = () => container.firstElementChild as HTMLElement;
const rail = () => container.querySelector("#ops-rail") as HTMLElement;
const panel = () => container.querySelector("#ops-panel") as HTMLElement | null;
const flyout = () => container.querySelector("#ops-flyout") as HTMLElement | null;
const tabbar = () => container.querySelector("#ops-tabbar") as HTMLElement;
const tile = (id: string) => rail().querySelector<HTMLAnchorElement>(`a[data-category="${id}"]`)!;
const crumbs = () => (container.querySelector('nav[aria-label="Breadcrumb"] ol') as HTMLElement).textContent;
const button = (label: string, within: ParentNode = container) =>
  [...within.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === label || b.textContent?.trim() === label);
const categoryLabels = () => [...rail().querySelectorAll("a[data-category]")].map((a) => a.textContent);
const key = (k: string, target: EventTarget = document) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  });

/** A pointer event jsdom can carry: React reads `pointerType` off the native event. */
function pointer(type: string, el: Element, pointerType: string) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "pointerType", { value: pointerType });
  act(() => {
    el.dispatchEvent(e);
  });
}

/** Clicks a link without letting jsdom try a real document navigation (no app router here). */
function follow(link: Element) {
  const stop = (e: Event) => e.preventDefault();
  document.addEventListener("click", stop, true);
  try {
    act(() => {
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
  } finally {
    document.removeEventListener("click", stop, true);
  }
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  logout.mockReset();
  push.mockReset();
  get.mockReset();
  get.mockImplementation(async () => followups(0));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("the category rail", () => {
  it("shows the categories this person may open, the current one marked, each going to its first page", () => {
    render("/ops/students", SUPER_ADMIN);
    expect(rail().getAttribute("aria-label")).toBe("Admin categories");
    expect(categoryLabels()).toEqual(["Today", "People", "Teaching", "Centre", "Content", "System"]);
    expect(tile("people").getAttribute("aria-current")).toBe("true");
    expect(tile("today").getAttribute("aria-current")).toBeNull();
    expect(tile("centre").getAttribute("href")).toBe("/ops/trials");
    expect(tile("centre").getAttribute("aria-keyshortcuts")).toBe("G C");
    expect(rail().className).toContain("fixed");
    expect(container.textContent).toContain("page body");
  });

  it("drops System for a desk admin — and inside, the pages the desk may not open", () => {
    render("/ops/classrooms", ADMIN);
    expect(categoryLabels()).toEqual(["Today", "People", "Teaching", "Centre", "Content"]);
    expect(panel()!.querySelector('a[href="/ops/journals"]')).toBeNull();
    expect([...panel()!.querySelectorAll("button[data-group]")].map((b) => b.textContent)).toEqual(["Classes2"]);
  });

  it("drops System for a teacher too, but keeps their pages", () => {
    render("/ops/journals", TEACHER);
    expect(categoryLabels()).not.toContain("System");
    expect(panel()!.querySelector('a[href="/ops/journals"]')?.getAttribute("aria-current")).toBe("page");
  });

  it("has the person at the bottom, with Log out in their menu", () => {
    render("/ops/students", SUPER_ADMIN);
    const person = rail().querySelector<HTMLButtonElement>('button[aria-haspopup="menu"][aria-label^="Aziza Karimova"]')!;
    expect(person).toBeTruthy();
    act(() => person.click());
    act(() => button("Log out")!.click());
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("switches console from the ADMIN pill — never for a test admin, whom AuthGuard keeps to the Builder", () => {
    render("/ops/students", SUPER_ADMIN);
    const pill = button("Admin console — switch", rail())!;
    act(() => pill.click());
    const menu = rail().querySelector('[role="menu"][aria-label="Console"]') as HTMLElement;
    expect(menu.querySelector('[aria-current="true"]')?.textContent).toBe("Admin");
    expect(menu.querySelector("a")?.getAttribute("href")).toBe("/builder");

    act(() => root.unmount());
    root = createRoot(container);
    render("/builder", { role: "test_admin", permissions: ["*"], username: "author1" }, BUILDER_CONSOLE);
    expect(button("Builder console — switch", rail())).toBeUndefined();
    expect(rail().textContent).toContain("builder");
  });

  it("opens ⌘K from its Search, offering the pages of this person's map", () => {
    render("/ops/students", ADMIN);
    act(() => button("Search", rail())!.click());
    const options = [...document.body.querySelectorAll('[role="option"]')].map((o) => o.textContent ?? "");
    expect(options.some((o) => o.includes("Students"))).toBe(true);
    expect(options.some((o) => o.includes("Broadcast"))).toBe(false);
    act(() => {
      document.body.querySelector('[role="combobox"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
  });

  it("flags a category with what needs action inside it — Today carries all of it", async () => {
    get.mockImplementation(async () => followups(3));
    render("/ops/trials", ADMIN);
    await settle();
    const flag = tile("centre").querySelector("[data-flag]")!;
    expect(flag.textContent).toBe("1");
    expect(flag.getAttribute("data-flag")).toBe("attention");
    expect(tile("centre").textContent).toContain("1 need you");
    expect(tile("today").querySelector("[data-flag]")?.textContent).toBe("1");
    expect(tile("people").querySelector("[data-flag]")).toBeNull();
  });
});

describe("the sub-category panel", () => {
  it("shows the current category: its name, its groups, its pages, the current page marked", () => {
    render("/ops/students", SUPER_ADMIN);
    expect(panel()!.getAttribute("aria-label")).toBe("People");
    expect(panel()!.querySelector("h2")?.textContent).toBe("People");
    expect(panel()!.textContent).toContain("Learners and team");
    expect([...panel()!.querySelectorAll("button[data-group]")].map((b) => b.textContent)).toEqual(["Learners2", "Team2"]);
    expect(panel()!.querySelector('[aria-current="page"]')?.getAttribute("href")).toBe("/ops/students");
    expect(panel()!.textContent).toContain("jump to People");
  });

  it("folds a group and remembers it per person — never the group of the page you are on", () => {
    render("/ops/students", SUPER_ADMIN);
    const team = panel()!.querySelector<HTMLButtonElement>('button[data-group="people/team"]')!;
    act(() => team.click());
    expect(team.getAttribute("aria-expanded")).toBe("false");
    expect((document.getElementById(team.getAttribute("aria-controls")!) as HTMLElement).hidden).toBe(true);
    expect(JSON.parse(window.localStorage.getItem("ms-nav-folded:ops:1")!)).toEqual(["people/team"]);

    const learners = panel()!.querySelector<HTMLButtonElement>('button[data-group="people/learners"]')!;
    act(() => learners.click());
    expect(learners.getAttribute("aria-expanded")).toBe("true");
    expect(panel()!.querySelector('a[href="/ops/students"]')).not.toBeNull();
  });

  it("draws a page's own tabs as a tree under it, in sync with the page's tab bar", () => {
    const onChange = vi.fn();
    function FinanceLike() {
      const [tab, setTab] = useState("overview");
      return (
        <Tabs
          label="Finance sections"
          idPrefix="finance"
          tree
          value={tab}
          onChange={(id) => {
            onChange(id);
            setTab(id);
          }}
          tabs={[
            { id: "overview", label: "Overview" },
            { id: "debtors", label: "Debtors", count: 13, tone: "critical" },
            { id: "payments", label: "Payments" },
            { id: "ledger", label: "Ledger" },
          ]}
        />
      );
    }
    render("/ops/finance", SUPER_ADMIN, undefined, <FinanceLike />);
    const tree = panel()!.querySelector('ul[aria-label="Finance tabs"]') as HTMLElement;
    expect([...tree.querySelectorAll("a")].map((a) => a.textContent)).toEqual(["Overview", "Debtors13", "Payments", "Ledger"]);
    expect(tree.querySelector('[aria-current="true"]')?.textContent).toBe("Overview");
    expect(crumbs()).toBe("CentreFinanceOverview");

    follow(tree.querySelector('a[data-tab="debtors"]')!);
    expect(onChange).toHaveBeenCalledWith("debtors");
    expect(panel()!.querySelector('ul[aria-label="Finance tabs"] [aria-current="true"]')?.textContent).toBe("Debtors13");
    expect(crumbs()).toBe("CentreFinanceDebtors");
  });

  it("opens another page's tree from its chevron — one tree at a time", () => {
    render("/ops/finance", SUPER_ADMIN);
    expect(panel()!.querySelector('ul[aria-label="Finance tabs"]')).not.toBeNull();
    const sms = button("SMS tabs", panel()!)!;
    expect(sms.getAttribute("aria-expanded")).toBe("false");
    act(() => sms.click());
    const tree = panel()!.querySelector('ul[aria-label="SMS tabs"]') as HTMLElement;
    expect([...tree.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual([
      "/ops/sms",
      "/ops/sms?tab=journal",
      "/ops/sms?tab=campaigns",
      "/ops/sms?tab=debt",
      "/ops/sms?tab=templates",
    ]);
    expect(panel()!.querySelector('ul[aria-label="Finance tabs"]')).toBeNull();
  });

  it("lists Today's cards (On this page) and the recently opened pages", async () => {
    window.localStorage.setItem("ms-recent", JSON.stringify([{ kind: "class", id: 12, name: "Middle M5", href: "/ops/classrooms/12", at: 1 }]));
    render(
      "/ops",
      SUPER_ADMIN,
      undefined,
      <>
        <section id="section-lessons-today" data-ms-section="Lessons today" />
        <section id="section-needs-you" data-ms-section="Needs you" />
      </>,
    );
    await settle();
    const groups = [...panel()!.querySelectorAll("section[aria-label]")].map((s) => s.getAttribute("aria-label"));
    expect(groups).toEqual(["On this page", "Recent"]);
    expect([...panel()!.querySelectorAll('a[href^="#section-"]')].map((a) => a.textContent)).toEqual(["Lessons today", "Needs you"]);
    expect(panel()!.querySelector('a[href="/ops/classrooms/12"]')?.textContent).toBe("Middle M5");
    expect(panel()!.textContent).toContain("Today from anywhere");
    expect(crumbs()).toBe("Today");
  });

  it("puts the live Trials count beside Trials", async () => {
    get.mockImplementation(async () => followups(3));
    render("/ops/trials", ADMIN);
    await settle();
    const trials = panel()!.querySelector('a[href="/ops/trials"]')!;
    expect(trials.querySelector('[aria-label="3 waiting"]')?.textContent).toBe("3");
  });

  it("draws nothing beside Trials when nothing waits", async () => {
    render("/ops/trials", ADMIN);
    await settle();
    expect(panel()!.querySelector('a[href="/ops/trials"]')?.textContent).toBe("Trials");
  });
});

describe("folding the panel", () => {
  it("folds with its button and pins again with [ — remembered, and never while typing", () => {
    render("/ops/students", SUPER_ADMIN);
    expect(shell().getAttribute("data-panel")).toBe("pinned");
    act(() => button("Collapse panel")!.click());
    expect(panel()).toBeNull();
    expect(shell().getAttribute("data-panel")).toBe("flyout");
    expect(window.localStorage.getItem("mastersat.ops.sidebar.collapsed")).toBe("1");

    // A fresh mount reads the choice back.
    act(() => root.unmount());
    root = createRoot(container);
    render("/ops/students", SUPER_ADMIN);
    expect(panel()).toBeNull();

    key("[");
    expect(panel()).not.toBeNull();
    expect(window.localStorage.getItem("mastersat.ops.sidebar.collapsed")).toBe("0");

    const input = document.createElement("input");
    container.appendChild(input);
    key("[", input);
    expect(panel()).not.toBeNull();
  });

  it("still renders, pinned, when storage throws", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      render("/ops", SUPER_ADMIN);
      expect(panel()).not.toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it("floats a category's panel beside the rail on a tap when folded, and closes it after a choice or Escape", () => {
    window.localStorage.setItem("mastersat.ops.sidebar.collapsed", "1");
    render("/ops/students", SUPER_ADMIN);
    pointer("pointerdown", tile("centre"), "touch");
    follow(tile("centre"));
    expect(flyout()?.getAttribute("aria-label")).toBe("Centre");
    expect(tile("centre").getAttribute("aria-expanded")).toBe("true");
    follow(flyout()!.querySelector('a[href="/ops/finance"]')!);
    expect(flyout()).toBeNull();

    pointer("pointerdown", tile("people"), "touch");
    follow(tile("people"));
    expect(flyout()?.getAttribute("aria-label")).toBe("People");
    key("Escape");
    expect(flyout()).toBeNull();
  });

  it("opens a category's panel as a sheet from the left on a tablet", () => {
    // Narrower than 1024 px; reduced motion, so the sheet leaves without its exit animation.
    const matchMedia = vi.fn((query: string) => ({ matches: query.includes("reduced-motion"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    vi.stubGlobal("matchMedia", matchMedia);
    try {
      render("/ops/students", SUPER_ADMIN);
      follow(tile("centre"));
      const sheet = container.querySelector('nav[aria-label="Centre"]') as HTMLElement;
      expect(sheet).toBeTruthy();
      expect(sheet.querySelector('a[href="/ops/sms"]')).not.toBeNull();
      act(() => button("Close menu", sheet)!.click());
      expect(container.querySelector('nav[aria-label="Centre"]')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("the top bar", () => {
  it("names the open record in the breadcrumb, linking back to its page", () => {
    window.localStorage.setItem("ms-recent", JSON.stringify([{ kind: "class", id: 12, name: "Middle M5", href: "/ops/classrooms/12", at: 1 }]));
    render("/ops/classrooms/12", SUPER_ADMIN);
    expect(crumbs()).toBe("TeachingClassroomsMiddle M5");
    const ol = container.querySelector('nav[aria-label="Breadcrumb"] ol')!;
    expect(ol.querySelector('a[href="/ops/classrooms"]')).not.toBeNull();
    expect(ol.querySelector('[aria-current="page"]')?.textContent).toBe("Middle M5");
  });

  it("keeps Admin › <page> for a page the map does not list", () => {
    render("/ops/users", SUPER_ADMIN);
    expect(crumbs()).toBe("AdminUsers");
  });

  it("pins this page from the bookmark: on top of the panel and first in ⌘K", () => {
    render("/ops/students", SUPER_ADMIN);
    act(() => button("Pin this page")!.click());
    expect(JSON.parse(window.localStorage.getItem("ms-pins:ops:1")!)).toEqual([{ href: "/ops/students", label: "Students", icon: "users" }]);
    const pinned = panel()!.querySelector('section[aria-label="Pinned"]')!;
    expect(pinned.querySelector('a[href="/ops/students"]')?.textContent).toBe("Students");
    const bookmark = button("Pinned — unpin this page")!;
    expect(bookmark.getAttribute("aria-pressed")).toBe("true");

    act(() => button("Search", rail())!.click());
    const first = document.body.querySelector('[role="option"]');
    expect(first?.textContent).toContain("Students");
    act(() => {
      document.body.querySelector('[role="combobox"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    act(() => bookmark.click());
    expect(JSON.parse(window.localStorage.getItem("ms-pins:ops:1")!)).toEqual([]);
  });

  it("refuses a seventh pin and says why", () => {
    const six = ["/ops/public", "/ops/staff", "/ops/access", "/ops/branches", "/ops/shop", "/ops/events"].map((href) => ({ href, label: href, icon: "users" }));
    window.localStorage.setItem("ms-pins:ops:1", JSON.stringify(six));
    render("/ops/students", SUPER_ADMIN);
    const bookmark = button("Pin this page")!;
    expect(bookmark.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(bookmark.getAttribute("aria-describedby")!)?.textContent).toBe("Up to 6 pins — unpin one first");
    act(() => bookmark.click());
    expect(JSON.parse(window.localStorage.getItem("ms-pins:ops:1")!)).toHaveLength(6);
  });

  it("reorders pins with ⌥← / ⌥→", () => {
    const two = [
      { href: "/ops/public", label: "Public users", icon: "user" },
      { href: "/ops/staff", label: "Staff", icon: "shield" },
    ];
    window.localStorage.setItem("ms-pins:ops:1", JSON.stringify(two));
    render("/ops/students", SUPER_ADMIN);
    const first = panel()!.querySelector('[data-pin="/ops/public"]')!;
    act(() => {
      first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, bubbles: true }));
    });
    expect(JSON.parse(window.localStorage.getItem("ms-pins:ops:1")!).map((p: { href: string }) => p.href)).toEqual(["/ops/staff", "/ops/public"]);
  });
});

describe("keys", () => {
  it("G then a category's letter goes to its first page", () => {
    render("/ops/students", SUPER_ADMIN);
    key("g");
    key("c");
    expect(push).toHaveBeenCalledWith("/ops/trials");
    key("g");
    key("s");
    expect(push).toHaveBeenLastCalledWith("/ops/mobile");
  });

  it("never jumps to a category the person cannot open", () => {
    render("/ops/students", ADMIN);
    key("g");
    key("s");
    expect(push).not.toHaveBeenCalled();
  });
});

describe("the phone", () => {
  it("has the categories as bottom tabs, Content and System under More", () => {
    render("/ops/students", SUPER_ADMIN);
    expect([...tabbar().querySelectorAll("a, button")].map((t) => t.textContent)).toEqual(["Today", "People", "Teaching", "Centre", "More"]);
    expect(tabbar().querySelector('[aria-current="true"]')?.textContent).toBe("People");
  });

  it("opens the open category's tiles on a second tap, and More's", () => {
    render("/ops/students", SUPER_ADMIN);
    follow(tabbar().querySelector('a[data-category="people"]')!);
    const sheet = container.querySelector('[role="dialog"][aria-label="People"]') as HTMLElement;
    expect([...sheet.querySelectorAll("a")].map((a) => a.textContent)).toEqual(["Students", "Public users", "Staff", "Access"]);
    expect(sheet.querySelector('[aria-current="page"]')?.getAttribute("href")).toBe("/ops/students");
    key("Escape");
    expect(container.querySelector('[role="dialog"][aria-label="People"]')).toBeNull();

    act(() => button("More", tabbar())!.click());
    const more = container.querySelector('[role="dialog"][aria-label="More"]') as HTMLElement;
    expect([...more.querySelectorAll("h3")].map((h) => h.textContent)).toEqual(["Content", "System"]);
  });

  it("gives a desk admin five tabs with no More, since they have five categories", () => {
    render("/ops", ADMIN);
    expect([...tabbar().querySelectorAll("a, button")].map((t) => t.textContent)).toEqual(["Today", "People", "Teaching", "Centre", "Content"]);
  });
});

describe("the builder", () => {
  it("wears the same frame with its own four categories, name and home", () => {
    render("/builder/question-bank/new", SUPER_ADMIN, BUILDER_CONSOLE);
    expect(rail().getAttribute("aria-label")).toBe("Builder categories");
    expect(categoryLabels()).toEqual(["Home", "Learning", "Simulation", "Archive"]);
    expect(rail().querySelector('a[aria-label="MasterSAT builder"]')?.getAttribute("href")).toBe("/builder");
    expect(tile("learning").getAttribute("aria-current")).toBe("true");
    expect(panel()!.getAttribute("aria-label")).toBe("Learning");
    expect(panel()!.textContent).toContain("Questions, sets and words");
    // A question's own page lights the Question bank.
    expect(panel()!.querySelector('[aria-current="true"]')?.getAttribute("href")).toBe("/builder/question-bank");
    expect(crumbs()).toBe("LearningQuestion bank");
    expect([...tabbar().querySelectorAll("a, button")].map((t) => t.textContent)).toEqual(["Home", "Learning", "Simulation", "Archive"]);
  });

  it("wears the Builder temperature and remembers its own folded panel", () => {
    window.localStorage.setItem("mastersat.ops.sidebar.collapsed", "1");
    render("/builder", SUPER_ADMIN, BUILDER_CONSOLE);
    expect(shell().getAttribute("data-ms-temp")).toBe("builder");
    expect(panel()).not.toBeNull();
    act(() => button("Collapse panel")!.click());
    expect(window.localStorage.getItem("mastersat.builder.sidebar.collapsed")).toBe("1");
  });

  it("gives a test admin no Switch to Admin in ⌘K", () => {
    render("/builder", { role: "test_admin", permissions: ["*"], username: "author1" }, BUILDER_CONSOLE);
    const pill = container.querySelector<HTMLButtonElement>("header button[aria-keyshortcuts]")!;
    expect(pill.textContent).toContain("Search questions, pages…");
    act(() => pill.click());
    const options = [...document.body.querySelectorAll('[role="option"]')].map((o) => o.textContent ?? "");
    expect(options.some((o) => o.includes("Switch to Admin"))).toBe(false);
    act(() => {
      document.body.querySelector('[role="combobox"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
  });
});

describe("the Trials count's request", () => {
  // The followups API answers administrators only. The gate in the shell is all that keeps the
  // builder console, teachers and test auditors from calling it.
  it.each([
    ["an admin", ADMIN],
    ["a super admin", SUPER_ADMIN],
  ])("goes out for %s", async (_who, me) => {
    render("/ops", me);
    await settle();
    expect(get).toHaveBeenCalledWith(FOLLOWUPS_URL);
  });

  it("neither shows nor fetches it for a teacher, who holds no enroll", async () => {
    render("/ops", TEACHER);
    await settle();
    expect(container.querySelector('a[href="/ops/trials"]')).toBeNull();
    expect(followupCalls()).toHaveLength(0);
  });

  it("does not go out in the builder console, even for a super admin", async () => {
    render("/builder", SUPER_ADMIN, BUILDER_CONSOLE);
    await settle();
    expect(followupCalls()).toHaveLength(0);
  });
});

describe("the console surface", () => {
  it("is `.ms` with the Admin temperature", () => {
    render("/ops/students", SUPER_ADMIN);
    expect(shell().classList.contains("ms")).toBe(true);
    expect(shell().hasAttribute("data-ms-temp")).toBe(false);
  });
});
