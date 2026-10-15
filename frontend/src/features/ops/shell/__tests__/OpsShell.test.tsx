/**
 * The ops console's frame: a sidebar flush to the left edge, collapsible to an icon rail (the
 * choice remembered), a drawer on a phone, and a top bar with the breadcrumb, the user and Log out.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logout = vi.fn();

vi.mock("@/lib/api", () => ({
  authApi: { logout: (...args: unknown[]) => logout(...args) },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/ops/students",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const { OpsShell } = await import("../OpsShell");

const SUPER_ADMIN = { role: "super_admin", permissions: ["*"], first_name: "Aziza", last_name: "Karimova" };
const ADMIN = { role: "admin", permissions: [], username: "desk1" };

let container: HTMLDivElement;
let root: Root;

function render(pathname: string, me: Record<string, unknown>) {
  const client = new QueryClient();
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <OpsShell pathname={pathname} me={me}>
          <p>page body</p>
        </OpsShell>
      </QueryClientProvider>,
    );
  });
}

const sidebar = () => container.querySelector("#ops-sidebar") as HTMLElement;
const button = (label: string) =>
  [...container.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === label || b.textContent?.trim() === label);

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  logout.mockReset();
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
