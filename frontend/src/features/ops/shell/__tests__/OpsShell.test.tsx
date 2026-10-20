/**
 * The ops console's frame: a sidebar flush to the left edge, collapsible to an icon rail (the
 * choice remembered), a drawer on a phone, and a top bar with the breadcrumb, the user and Log out.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logout = vi.fn();
const get = vi.fn();

vi.mock("@/lib/api", () => ({
  authApi: { logout: (...args: unknown[]) => logout(...args) },
  default: { get: (...args: unknown[]) => get(...args) },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/ops/students",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const { OpsShell } = await import("../OpsShell");
const { BUILDER_CONSOLE } = await import("@/features/builderShell/builderNav");

const SUPER_ADMIN = { role: "super_admin", permissions: ["*"], first_name: "Aziza", last_name: "Karimova" };
const ADMIN = { role: "admin", permissions: [], username: "desk1" };
const TEACHER = { role: "teacher", permissions: [], username: "t1" };

const FOLLOWUPS_URL = "/lcup/followups/";
const followups = (pending: number) => ({
  data: { free_trial_lessons: 1, trials: [], not_on_list: [], pending },
});

let container: HTMLDivElement;
let root: Root;

function render(pathname: string, me: Record<string, unknown>, config?: typeof BUILDER_CONSOLE) {
  const client = new QueryClient();
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <OpsShell pathname={pathname} me={me} config={config}>
          <p>page body</p>
        </OpsShell>
      </QueryClientProvider>,
    );
  });
}

/** The query starts on mount and resolves a tick later; let both happen before asserting. */
async function renderSettled(pathname: string, me: Record<string, unknown>, config?: typeof BUILDER_CONSOLE) {
  render(pathname, me, config);
  for (let tick = 0; tick < 3; tick++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const followupCalls = () => get.mock.calls.filter(([url]) => url === FOLLOWUPS_URL);

const sidebar = () => container.querySelector("#ops-sidebar") as HTMLElement;
const button = (label: string) =>
  [...container.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === label || b.textContent?.trim() === label);

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  logout.mockReset();
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

describe("OpsShell", () => {
  it("renders the grouped nav, the page full width, and marks the current section", () => {
    render("/ops/students", SUPER_ADMIN);
    const captions = [...sidebar().querySelectorAll("p")].map((p) => p.textContent);
    expect(captions).toEqual(["People", "Teaching", "Centre", "Content", "System"]);
    const current = sidebar().querySelector('[aria-current="page"]');
    expect(current?.getAttribute("href")).toBe("/ops/students");
    expect(container.textContent).toContain("page body");
    expect(container.innerHTML).not.toContain("max-w-7xl");
    expect(sidebar().className).toContain("fixed");
    expect(sidebar().className).toContain("left-0");
  });

  it("hides the System group from a scoped admin", () => {
    render("/ops", ADMIN);
    const captions = [...sidebar().querySelectorAll("p")].map((p) => p.textContent);
    expect(captions).not.toContain("System");
    expect(sidebar().querySelector('a[href="/ops/journals"]')).toBeNull();
    expect(sidebar().querySelector('a[href="/ops/students"]')).not.toBeNull();
  });

  it("shows the breadcrumb, the user's name and Log out in the top bar", () => {
    render("/ops/classrooms/12", SUPER_ADMIN);
    const crumb = container.querySelector('nav[aria-label="Breadcrumb"]') as HTMLElement;
    expect(crumb.textContent).toBe("AdminClassrooms");
    // On a deeper page the section crumb links back to the section.
    expect(crumb.querySelector('a[href="/ops/classrooms"]')).not.toBeNull();
    expect(container.querySelector("header")?.textContent).toContain("Aziza Karimova");

    act(() => button("Log out")!.click());
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("falls back to the username when there is no name", () => {
    render("/ops", ADMIN);
    expect(container.querySelector("header")?.textContent).toContain("desk1");
  });

  it("collapses to an icon rail and remembers it", () => {
    render("/ops/students", SUPER_ADMIN);
    expect(sidebar().className).toContain("lg:w-60");
    act(() => button("Collapse sidebar")!.click());
    expect(sidebar().className).toContain("lg:w-16");
    expect(window.localStorage.getItem("mastersat.ops.sidebar.collapsed")).toBe("1");

    // A fresh mount reads the choice back.
    act(() => root.unmount());
    root = createRoot(container);
    render("/ops/students", SUPER_ADMIN);
    expect(sidebar().className).toContain("lg:w-16");
    expect(button("Expand sidebar")).toBeTruthy();
  });

  it("still renders when storage throws", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      render("/ops", SUPER_ADMIN);
      expect(sidebar().className).toContain("lg:w-60");
    } finally {
      spy.mockRestore();
    }
  });

  it("opens as a drawer from the hamburger and closes on Escape", () => {
    render("/ops/students", SUPER_ADMIN);
    expect(sidebar().className).toContain("max-lg:-translate-x-full");
    const hamburger = button("Open menu")!;
    act(() => hamburger.click());
    expect(hamburger.getAttribute("aria-expanded")).toBe("true");
    expect(sidebar().className).not.toContain("max-lg:-translate-x-full");

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(sidebar().className).toContain("max-lg:-translate-x-full");
    expect(hamburger.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes the drawer when a nav link is followed", () => {
    render("/ops/students", SUPER_ADMIN);
    act(() => button("Open menu")!.click());
    const link = sidebar().querySelector('a[href="/ops/finance"]') as HTMLAnchorElement;
    // No app router is mounted here, so keep jsdom from attempting a real document navigation;
    // the link's own onClick still runs.
    const stopNavigation = (e: Event) => e.preventDefault();
    document.addEventListener("click", stopNavigation, true);
    try {
      act(() => {
        link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
    } finally {
      document.removeEventListener("click", stopNavigation, true);
    }
    expect(sidebar().className).toContain("max-lg:-translate-x-full");
  });
});

describe("OpsShell for the builder", () => {
  it("wears the same frame with the builder's nav, name and home", () => {
    render("/builder/question-bank/triage", SUPER_ADMIN, BUILDER_CONSOLE);
    expect(sidebar().className).toContain("fixed");
    expect(sidebar().getAttribute("aria-label")).toBe("Builder navigation");
    expect(sidebar().textContent).toContain("MasterSAT builder");
    expect(sidebar().querySelector('a[title="MasterSAT builder"]')?.getAttribute("href")).toBe("/builder");
    const captions = [...sidebar().querySelectorAll("p")].map((p) => p.textContent);
    expect(captions).toEqual(["Learning", "Simulation"]);
    // Only Triage Queue is current — not Question Bank, which it nests under.
    const current = [...sidebar().querySelectorAll('[aria-current="page"]')].map((a) => a.getAttribute("href"));
    expect(current).toEqual(["/builder/question-bank/triage"]);
    const crumb = container.querySelector('nav[aria-label="Breadcrumb"]') as HTMLElement;
    expect(crumb.textContent).toBe("BuilderTriage Queue");
    expect(crumb.querySelector('a[href="/builder"]')).not.toBeNull();
  });

  it("remembers its own collapsed rail, apart from the ops console's", () => {
    window.localStorage.setItem("mastersat.ops.sidebar.collapsed", "1");
    render("/builder", SUPER_ADMIN, BUILDER_CONSOLE);
    expect(button("Collapse sidebar")).toBeTruthy();
    act(() => button("Collapse sidebar")!.click());
    expect(window.localStorage.getItem("mastersat.builder.sidebar.collapsed")).toBe("1");
  });
});

describe("OpsShell's Trials count", () => {
  // The followups API answers administrators only. The gate in the shell is all that keeps the
  // builder console, teachers and test auditors from calling it.
  it.each([
    ["an admin", ADMIN],
    ["a super admin", SUPER_ADMIN],
  ])("fetches the count for %s", async (_who, me) => {
    await renderSettled("/ops", me);
    expect(get).toHaveBeenCalledWith(FOLLOWUPS_URL);
  });

  it("does not fetch it for a teacher, who sees the nav item but not the API", async () => {
    await renderSettled("/ops", TEACHER);
    expect(sidebar().querySelector('a[href="/ops/trials"]')).not.toBeNull();
    expect(followupCalls()).toHaveLength(0);
  });

  it("does not fetch it in the builder console, even for a super admin", async () => {
    await renderSettled("/builder", SUPER_ADMIN, BUILDER_CONSOLE);
    expect(followupCalls()).toHaveLength(0);
  });

  it("draws the waiting count beside Trials for an admin", async () => {
    get.mockImplementation(async () => followups(3));
    await renderSettled("/ops", ADMIN);
    const trials = sidebar().querySelector('a[href="/ops/trials"]');
    expect(trials?.querySelector('[aria-label="3 waiting"]')?.textContent).toBe("3");
  });

  it("draws nothing beside Trials when nothing waits", async () => {
    await renderSettled("/ops", ADMIN);
    expect(sidebar().querySelector('a[href="/ops/trials"]')?.textContent).toBe("Trials");
  });
});
