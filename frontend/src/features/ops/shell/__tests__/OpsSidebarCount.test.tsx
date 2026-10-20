/** The Trials item carries the desk's waiting count; zero draws nothing. */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OpsSidebar } from "../OpsSidebar";
import { OPS_NAV_GROUPS, visibleNav } from "../opsNav";

const ADMIN = { role: "admin", permissions: [] };
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

function render(counts?: { trials?: number }) {
  act(() => {
    root.render(
      <OpsSidebar
        groups={visibleNav(OPS_NAV_GROUPS, ADMIN)}
        pathname="/ops"
        collapsed={false}
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

  it("draws nothing for zero", () => {
    expect(render({ trials: 0 })?.textContent).toBe("Trials");
  });
});
