/**
 * /builder/pastpapers lists past papers only. Practice tests have their own builder library, so
 * the list call must name its kind ("pastpaper"): the server applies `kind` only when it is
 * given, and without it the two libraries would be mixed.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminPastpaperSection } from "@/lib/api";

const getStandaloneSections = vi.fn();

vi.mock("@/features/examsAdmin/api", () => ({
  examsAdminApi: { getStandaloneSections: (...a: unknown[]) => getStandaloneSections(...a) },
}));

const { default: PastpapersPage } = await import("../page");

const paper: AdminPastpaperSection = {
  id: 12,
  title: "November 2025 Int. A",
  subject: "READING_WRITING",
  is_published: true,
  label: "A",
  form_type: "INTERNATIONAL",
  collection_name: "November 2025",
  practice_date: "2025-11-01",
  modules: [{ id: 120, module_order: 1 }],
};

let host: HTMLElement;
let root: Root;

async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  getStandaloneSections.mockReset();
  getStandaloneSections.mockResolvedValue([paper]);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("/builder/pastpapers", () => {
  it("asks for past papers only, never practice tests", async () => {
    act(() => root.render(<PastpapersPage />));
    await settle();
    expect(getStandaloneSections).toHaveBeenCalledWith("pastpaper");
    expect(host.textContent).toContain("November 2025 Int. A");
    expect([...host.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toContain("/builder/pastpapers/12/120");
  });

  it("keeps asking for past papers only when the list is refreshed", async () => {
    act(() => root.render(<PastpapersPage />));
    await settle();
    const refresh = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Refresh")!;
    act(() => refresh.click());
    await settle();
    expect(getStandaloneSections).toHaveBeenCalledTimes(2);
    expect(getStandaloneSections.mock.calls.map((c) => c[0])).toEqual(["pastpaper", "pastpaper"]);
  });
});
