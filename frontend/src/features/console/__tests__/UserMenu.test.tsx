/**
 * The person in the top bar (design handoff v0.3, Shell board): initials, name and role; a menu
 * with the theme, the keyboard shortcuts and Log out. An auditor is told they are read-only.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logout = vi.fn();
const setTheme = vi.fn();
vi.mock("@/lib/api", () => ({ authApi: { logout: (...a: unknown[]) => logout(...a) } }));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "system", resolvedTheme: "light", setTheme }) }));

const { UserMenu } = await import("../UserMenu");

let host: HTMLDivElement;
let root: Root;

function render(me: Record<string, unknown>) {
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <UserMenu me={me} />
      </QueryClientProvider>,
    ),
  );
}
const trigger = () => host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
const menu = () => host.querySelector('[role="menu"]');
const item = (text: string) =>
  [...host.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find((el) => el.textContent?.includes(text));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  logout.mockReset();
  setTheme.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("UserMenu", () => {
  it("shows the person's initials, name and role in words", () => {
    render({ id: 4, role: "admin", first_name: "Dilnoza", last_name: "Karimova" });
    expect(trigger().textContent).toContain("DK");
    expect(trigger().textContent).toContain("Dilnoza Karimova");
    expect(trigger().textContent).toContain("Desk admin");
  });

  it("opens a menu, focuses its first item, and closes on Escape with focus back on the button", () => {
    render({ id: 1, role: "super_admin", username: "owner" });
    act(() => trigger().click());
    expect(menu()).not.toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement?.getAttribute("role")).toMatch(/^menuitem/);
    act(() => {
      menu()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("moves between items with the arrows", () => {
    render({ id: 1, role: "super_admin", username: "owner" });
    act(() => trigger().click());
    const first = document.activeElement;
    act(() => {
      menu()!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(document.activeElement).not.toBe(first);
    expect(document.activeElement?.getAttribute("role")).toMatch(/^menuitem/);
  });

  it("switches the theme", () => {
    render({ id: 1, role: "super_admin", username: "owner" });
    act(() => trigger().click());
    expect(item("System")?.getAttribute("aria-checked")).toBe("true");
    act(() => item("Dark")!.click());
    expect(setTheme).toHaveBeenCalledWith("dark");
  });

  it("logs out once", () => {
    render({ id: 1, role: "super_admin", username: "owner" });
    act(() => trigger().click());
    act(() => item("Log out")!.click());
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("tells an auditor they are read-only", () => {
    render({ id: 9, role: "test_auditor", username: "audit1" });
    expect(host.textContent).toContain("Read-only");
  });

  it("does not call anyone else read-only", () => {
    render({ id: 4, role: "admin", username: "desk1" });
    expect(host.textContent).not.toContain("Read-only");
  });
});
