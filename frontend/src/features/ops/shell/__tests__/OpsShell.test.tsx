/**
 * The consoles' frame (lc-up structure canvas, 22 Nov 2026 — Rail, TopBar and Shell boards): one light sidebar of
 * captioned sections that folds to icons (remembered), a top bar with lc-up's two searches, "+ New", the branch, the
 * timetable, the bell and the person, and the phone's tabs with More. Every page and role rule as before; counts
 * only on verdicts.
 */
import { act } from "react";
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

const SUPER_ADMIN = { id: 1, role: "super_admin", permissions: ["*"], first_name: "Aziza", last_name: "Karimova" };
// As GET /users/me/ gives them since the CRM permissions: the administrator holds every CRM permission, a teacher none.
const ADMIN = { id: 2, role: "admin", permissions: ADMIN_ME.permissions, username: "desk1" };
const TEACHER = { id: 3, role: "teacher", permissions: TEACHER_ME.permissions, username: "t1" };

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

const DEBTORS_URL = "/lcup/finance/debtors/";
const debtorCalls = () => get.mock.calls.filter(([url]) => url === DEBTORS_URL);
const shell = () => container.firstElementChild as HTMLElement;
const sidebar = () => container.querySelector("#ops-sidebar") as HTMLElement;
const tabbar = () => container.querySelector("#ops-tabbar") as HTMLElement;
const item = (href: string) => sidebar().querySelector<HTMLAnchorElement>(`a[data-nav-item="${href}"]`);
const crumbs = () => (container.querySelector('nav[aria-label="Breadcrumb"] ol') as HTMLElement).textContent;
const button = (label: string, within: ParentNode = container) =>
  [...within.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === label || b.textContent?.trim() === label);
const itemLabels = () => [...sidebar().querySelectorAll("a[data-nav-item]")].map((a) => a.textContent);
const captions = () => [...sidebar().querySelectorAll("div.uppercase")].map((d) => d.textContent);
const options = () => [...document.body.querySelectorAll('[role="option"]')].map((o) => o.textContent ?? "");
const closePalette = () =>
  act(() => {
    document.body.querySelector('[role="combobox"]')?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
const key = (k: string, target: EventTarget = document) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  });

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

describe("the sidebar", () => {
  it("lists every page this person may open under its section, the current one marked", () => {
    render("/ops/students", SUPER_ADMIN);
    expect(sidebar().getAttribute("aria-label")).toBe("Admin sections");
    expect(captions()).toEqual(["Daily work", "Teaching", "Centre", "Content", "People & system"]);
    expect(itemLabels()).toEqual([
      "Today",
      "Students",
      "Groups",
      "Finance",
      "Archive",
      "Journals",
      "Midterm results",
      "Mock sittings",
      "Exam dates",
      "Branches",
      "Trials",
      "SMS",
      "Telegram posts",
      "Support hours",
      "Reward shop",
      "lc-up link",
      "Events",
      "Surveys",
      "Stories",
      "Public users",
      "Staff",
      "Access",
      "Mobile app",
      "Broadcast",
    ]);
    expect(item("/ops/students")!.getAttribute("aria-current")).toBe("page");
    expect(item("/ops")!.getAttribute("aria-current")).toBeNull();
    // Timetable is routed and guarded, not listed.
    expect(item("/ops/timetable")).toBeNull();
    expect(sidebar().className).toContain("fixed");
    expect(container.textContent).toContain("page body");
  });

  it("gives every page a small coloured tile, and the daily places a taller row", () => {
    render("/ops/students", SUPER_ADMIN);
    const tile = item("/ops/finance")!.querySelector<HTMLElement>("span[aria-hidden]")!;
    expect(tile.style.backgroundColor).not.toBe("");
    expect(item("/ops/finance")!.className).toContain("min-h-[42px]");
    expect(item("/ops/journals")!.className).toContain("min-h-9");
  });

  it("lights Groups on a group's own page and on the timetable it opens", () => {
    render("/ops/classrooms/12", ADMIN);
    expect(item("/ops/classrooms")!.getAttribute("aria-current")).toBe("page");
  });

  it("keeps from a desk admin the pages the desk may not open", () => {
    render("/ops/classrooms", ADMIN);
    for (const href of ["/ops/journals", "/ops/midterms", "/ops/mobile", "/ops/broadcast", "/ops/surveys", "/ops/stories"]) expect(item(href)).toBeNull();
    expect(captions()).toEqual(["Daily work", "Teaching", "Centre", "Content", "People & system"]);
  });

  it("keeps a teacher's own pages and drops the desk's", () => {
    render("/ops/journals", TEACHER);
    expect(captions()).not.toContain("Daily work");
    expect(item("/ops/journals")!.getAttribute("aria-current")).toBe("page");
    expect(item("/ops/finance")).toBeNull();
  });

  it("switches console from the name under the logo — never for a test admin, whom AuthGuard keeps to the Builder", () => {
    render("/ops/students", SUPER_ADMIN);
    act(() => button("Admin console — switch", sidebar())!.click());
    const menu = sidebar().querySelector('[role="menu"][aria-label="Console"]') as HTMLElement;
    expect(menu.querySelector('[aria-current="true"]')?.textContent).toBe("Admin");
    expect(menu.querySelector("a")?.getAttribute("href")).toBe("/builder");

    act(() => root.unmount());
    root = createRoot(container);
    render("/builder", { role: "test_admin", permissions: ["*"], username: "author1" }, BUILDER_CONSOLE);
    expect(button("Builder console — switch", sidebar())).toBeUndefined();
    expect(sidebar().textContent).toContain("Builder");
  });
});

describe("counts, only on verdicts", () => {
  it("puts Needs you beside Today and the students who owe beside Finance", async () => {
    get.mockImplementation(async (url: string) => (url === DEBTORS_URL ? { data: [{ link_id: 1 }, { link_id: 2 }, { link_id: 3 }] } : followups(3)));
    render("/ops/students", ADMIN);
    await settle();
    expect(item("/ops")!.querySelector("[data-nav-count]")?.textContent).toBe("1");
    expect(item("/ops/finance")!.querySelector("[data-nav-count]")?.textContent).toBe("3");
    // Trials waiting is a "Needs you" item, not a count of its own.
    expect(item("/ops/trials")!.querySelector("[data-nav-count]")).toBeNull();
    expect(item("/ops/students")!.querySelector("[data-nav-count]")).toBeNull();
  });

  it("draws nothing when nothing waits", async () => {
    get.mockImplementation(async (url: string) => (url === DEBTORS_URL ? { data: [] } : followups(0)));
    render("/ops/students", ADMIN);
    await settle();
    expect(sidebar().querySelector("[data-nav-count]")).toBeNull();
  });

  it("never asks for the debtors without view_money", async () => {
    render("/ops", TEACHER);
    await settle();
    expect(debtorCalls()).toHaveLength(0);
    act(() => root.unmount());
    root = createRoot(container);
    render("/builder", SUPER_ADMIN, BUILDER_CONSOLE);
    await settle();
    expect(debtorCalls()).toHaveLength(0);
  });
});

describe("folding the sidebar", () => {
  it("folds to icons with its button and opens again with [ — remembered, and never while typing", () => {
    render("/ops/students", ADMIN);
    expect(sidebar().getAttribute("data-folded")).toBeNull();
    act(() => button("Collapse the sidebar")!.click());
    expect(sidebar().getAttribute("data-folded")).toBe("true");
    expect(window.localStorage.getItem("mastersat.ops.sidebar.v2.folded")).toBe("1");
    // Folded, a page keeps its name for screen readers and as a tooltip.
    expect(item("/ops/students")!.getAttribute("aria-label")).toBe("Students");
    expect(captions()).toEqual([]);

    const input = document.createElement("input");
    container.appendChild(input);
    key("[", input);
    expect(sidebar().getAttribute("data-folded")).toBe("true");
    key("[");
    expect(sidebar().getAttribute("data-folded")).toBeNull();
    expect(window.localStorage.getItem("mastersat.ops.sidebar.v2.folded")).toBe("0");
  });

  it("ignores the old v0.4 panel's preference", () => {
    window.localStorage.setItem("mastersat.ops.sidebar.collapsed", "1");
    render("/ops/students", ADMIN);
    expect(sidebar().getAttribute("data-folded")).toBeNull();
  });

  it("still renders, open, when storage throws", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      render("/ops/students", ADMIN);
      expect(sidebar().getAttribute("data-folded")).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("the top bar", () => {
  it("names the page, its open record, and puts the timetable under Groups", () => {
    render("/ops/students", SUPER_ADMIN);
    expect(crumbs()).toBe("Students");
    act(() => root.unmount());
    root = createRoot(container);
    render("/ops/timetable", SUPER_ADMIN);
    expect(crumbs()).toBe("GroupsTimetable");
  });

  it("keeps Admin › <page> for a page the map does not list", () => {
    render("/ops/assignments", SUPER_ADMIN);
    expect(crumbs()).toBe("AdminAssignments");
  });

  it("has lc-up's two searches: the data search and Sections ⌘K", () => {
    render("/ops/students", ADMIN);
    const data = container.querySelector<HTMLButtonElement>('header button[data-search="data"]')!;
    expect(data.textContent).toBe("Search students, groups, phones");
    act(() => data.click());
    // The data search offers no pages: it looks people and groups up on the server.
    expect(options().some((o) => o.includes("Broadcast") || o.includes("Finance"))).toBe(false);
    closePalette();

    act(() => button("Jump to a section")!.click());
    expect(options().some((o) => o.includes("Students"))).toBe(true);
    expect(options().some((o) => o.includes("Broadcast"))).toBe(false);
    closePalette();
  });

  it("offers + New with what this person may create, and the timetable", () => {
    render("/ops/students", ADMIN);
    const newButton = [...container.querySelectorAll<HTMLButtonElement>("header button")].find((b) => b.textContent?.trim() === "New")!;
    act(() => newButton.click());
    const links = [...document.body.querySelectorAll('[role="menu"] a')].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([
      ["New group", "/ops/classrooms?new=1"],
      ["SMS campaign", "/ops/sms/campaigns/new"],
    ]);
    expect(container.querySelector('header a[aria-label="Timetable of all groups"]')?.getAttribute("href")).toBe("/ops/timetable");
  });

  it("gives a teacher no + New, no timetable and no data search for groups", () => {
    render("/ops/journals", TEACHER);
    expect([...container.querySelectorAll("header button")].some((b) => b.textContent?.trim() === "New")).toBe(false);
    expect(container.querySelector('header a[aria-label="Timetable of all groups"]')).toBeNull();
  });

  it("has the person at the right, with Log out in their menu", () => {
    render("/ops/students", SUPER_ADMIN);
    const person = container.querySelector<HTMLButtonElement>('header button[aria-haspopup="menu"][aria-label^="Aziza Karimova"]')!;
    expect(person).toBeTruthy();
    act(() => person.click());
    act(() => button("Log out")!.click());
    expect(logout).toHaveBeenCalledTimes(1);
  });
});

describe("keys", () => {
  it("G then a section's letter goes to its first page", () => {
    render("/ops/students", SUPER_ADMIN);
    key("g");
    key("c");
    expect(push).toHaveBeenCalledWith("/ops/trials");
    key("g");
    key("d");
    expect(push).toHaveBeenLastCalledWith("/ops/students");
  });

  it("never jumps to a section the person cannot open", () => {
    render("/ops/journals", TEACHER);
    key("g");
    key("d");
    expect(push).not.toHaveBeenCalled();
  });
});

describe("the phone", () => {
  it("has Today, Students, Groups and Finance as tabs, the rest under More", () => {
    render("/ops/students", SUPER_ADMIN);
    expect([...tabbar().querySelectorAll("a, button")].map((t) => t.textContent)).toEqual(["Today", "Students", "Groups", "Finance", "More"]);
    expect(tabbar().querySelector('[aria-current="page"]')?.textContent).toBe("Students");
  });

  it("opens More's sheet with every other page under its section, and closes on Escape", () => {
    render("/ops/sms", SUPER_ADMIN);
    expect(button("More", tabbar())!.getAttribute("aria-current")).toBe("true");
    act(() => button("More", tabbar())!.click());
    const more = container.querySelector('[role="dialog"][aria-label="More sections"]') as HTMLElement;
    expect([...more.querySelectorAll("h2")].map((h) => h.textContent)).toEqual(["Daily work", "Teaching", "Centre", "Content", "People & system"]);
    expect(more.querySelector('a[href="/ops/archive"]')).not.toBeNull();
    expect(more.querySelector('[aria-current="page"]')?.getAttribute("href")).toBe("/ops/sms");
    key("Escape");
    expect(container.querySelector('[role="dialog"][aria-label="More sections"]')).toBeNull();
  });
});

describe("the builder", () => {
  it("wears the same frame with its own sections, name and home", () => {
    render("/builder/question-bank/new", SUPER_ADMIN, BUILDER_CONSOLE);
    expect(sidebar().getAttribute("aria-label")).toBe("Builder sections");
    expect(captions()).toEqual(["Learning", "Simulation", "Archive"]);
    expect(sidebar().querySelector('a[aria-label="MasterSAT Builder — home"]')?.getAttribute("href")).toBe("/builder");
    // A question's own page lights the Question bank.
    expect(sidebar().querySelector('[aria-current="page"]')?.getAttribute("href")).toBe("/builder/question-bank");
    expect(crumbs()).toBe("Question bank");
    expect(container.querySelector('header a[aria-label="Timetable of all groups"]')).toBeNull();
  });

  it("wears the Builder temperature, on <html> too, and remembers its own fold", () => {
    render("/builder", SUPER_ADMIN, BUILDER_CONSOLE);
    expect(shell().getAttribute("data-ms-temp")).toBe("builder");
    expect(document.documentElement.getAttribute("data-ms-temp")).toBe("builder");
    act(() => button("Collapse the sidebar")!.click());
    expect(window.localStorage.getItem("mastersat.builder.sidebar.v2.folded")).toBe("1");
    expect(window.localStorage.getItem("mastersat.ops.sidebar.v2.folded")).toBeNull();
  });

  it("searches questions, and gives a test admin no Switch to Admin in ⌘K", () => {
    render("/builder", { role: "test_admin", permissions: ["*"], username: "author1" }, BUILDER_CONSOLE);
    expect(container.querySelector('header button[data-search="data"]')?.textContent).toBe("Search questions");
    act(() => button("Jump to a section")!.click());
    expect(options().some((o) => o.includes("Switch to Admin"))).toBe(false);
    closePalette();
  });
});

describe("the console surface", () => {
  it("is `.ms` with the Admin temperature, put on <html> while mounted and taken off after", () => {
    render("/ops/students", SUPER_ADMIN);
    expect(shell().classList.contains("ms")).toBe(true);
    expect(shell().getAttribute("data-ms-temp")).toBe("admin");
    expect(document.documentElement.getAttribute("data-ms-temp")).toBe("admin");
    act(() => root.unmount());
    expect(document.documentElement.hasAttribute("data-ms-temp")).toBe(false);
    root = createRoot(container);
  });
});
