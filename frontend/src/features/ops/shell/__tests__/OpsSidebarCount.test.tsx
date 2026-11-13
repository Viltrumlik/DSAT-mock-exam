/** The Trials item carries the desk's waiting count; zero draws nothing. */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OpsSidebar } from "../OpsSidebar";
import { OPS_NAV_GROUPS, visibleNav } from "../opsNav";

/** What GET /users/me/ gives an administrator since the CRM permissions (PR 2). */
const ADMIN = {
  role: "admin",
  permissions: ["adjust_balance", "assign_access", "create_classroom", "debt_freeze", "edit_people", "enroll", "events_shop", "lcup_tools", "manage_groups", "manage_seats", "manage_tests", "manage_users", "send_debt_sms", "send_sms", "set_prices", "submit_test", "take_payment", "view_dashboard", "view_money", "view_people", "view_reports", "void_payment"],
};
let host: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(counts?: { trials?: number }, collapsed = false) {
  act(() => {
    root.render(
      <OpsSidebar
        groups={visibleNav(OPS_NAV_GROUPS, ADMIN)}
        pathname="/ops"
        collapsed={collapsed}
        mobileOpen={false}
        onCloseMobile={() => {}}
        onToggleCollapsed={() => {}}
        counts={counts}
      />,
    );
  });
  return host.querySelector<HTMLAnchorElement>('a[href="/ops/trials"]');
}

describe("ops sidebar count", () => {
  it("shows the waiting count beside Trials", () => {
    const link = render({ trials: 3 });
    expect(link?.textContent).toBe("Trials3");
    expect(link?.querySelector('[aria-label="3 waiting"]')).not.toBeNull();
  });

  it("keeps the count for screen readers on the icon rail, and draws a dot", () => {
    const link = render({ trials: 16 }, true);
    expect(link?.querySelector('[aria-label="16 waiting"]')).not.toBeNull();
    expect(link?.querySelector("[data-count-dot]")).not.toBeNull();
    expect(link?.getAttribute("title")).toBe("Trials");
  });

  it("marks the current section for assistive tech and in bold, without the old blue", () => {
    render();
    const current = host.querySelector('[aria-current="page"]') as HTMLElement;
    expect(current.getAttribute("href")).toBe("/ops");
    expect(current.className).toContain("font-bold");
    expect(current.className).not.toMatch(/text-primary|bg-primary-soft/);
  });

  it("draws nothing for zero", () => {
    expect(render({ trials: 0 })?.textContent).toBe("Trials");
  });
});
