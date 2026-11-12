/**
 * /ops/branches in the console's look: the drill-down (regions → branches → classrooms) with its counts, the
 * classrooms on no branch, Add region / Add branch with the same payloads, moving a classroom with the same call,
 * the server's words on a refusal, the empty state, and a failed load that is never drawn as "no regions".
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  classrooms: vi.fn(),
  regions: vi.fn(),
  branches: vi.fn(),
  createRegion: vi.fn(),
  createBranch: vi.fn(),
  setClassroomBranch: vi.fn(),
}));

vi.mock("@/features/org/orgApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/org/orgApi")>()),
  orgApi: api,
}));

const { default: Page } = await import("../page");

const REGIONS = [{ id: 1, name: "Tashkent", code: "", is_active: true, branch_count: 2 }];
const BRANCHES = [
  { id: 10, name: "Chilonzor", code: "", address: "", is_active: true, region: 1, region_name: "Tashkent", classroom_count: 2 },
  { id: 11, name: "Yunusobod", code: "", address: "", is_active: false, region: 1, region_name: "Tashkent", classroom_count: 0 },
];
const ROOMS = [
  { id: 100, name: "SAT A", branch: 10, branch_name: "Chilonzor", region_name: "Tashkent" },
  { id: 101, name: "SAT B", branch: 10, branch_name: "Chilonzor", region_name: "Tashkent" },
  { id: 102, name: "SAT C", branch: null, branch_name: null, region_name: null },
];

let host: HTMLElement;
let root: Root;

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}
async function render() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <Page />
      </QueryClientProvider>,
    );
  });
  await settle();
}
async function click(el: Element) {
  await act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
}
async function type(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function choose(el: HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}
const buttons = () => Array.from(host.querySelectorAll<HTMLButtonElement>("button"));
const buttonStarting = (words: string) => buttons().find((b) => b.textContent?.trim().startsWith(words))!;
const addButtons = () => buttons().filter((b) => b.textContent?.trim() === "Add");
const crumbs = () => host.querySelector('nav[aria-label="Organisation"]')!;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const f of Object.values(api)) f.mockReset();
  api.regions.mockResolvedValue(REGIONS);
  api.branches.mockResolvedValue(BRANCHES);
  api.classrooms.mockResolvedValue(ROOMS);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the drill-down", () => {
  it("shows each region with its counts, the total, and the classrooms on no branch", async () => {
    await render();
    expect(host.querySelector("h1")!.textContent).toBe("Branches");
    expect(host.textContent).toContain("3 classrooms in total");
    const region = buttonStarting("Tashkent");
    expect(region.textContent).toContain("2 branches · 2 classrooms");
    expect(host.textContent).toContain(
      "1 classroom has no branch yet. Their students appear on the Global board but on no branch board.",
    );
    expect(buttonStarting("No branch yet").textContent).toContain("1 classroom on no branch board");
  });

  it("walks down to a branch's classrooms and back up by the breadcrumb", async () => {
    await render();
    await click(buttonStarting("Tashkent"));
    expect(host.textContent).toContain("Branches in Tashkent");
    expect(buttonStarting("Chilonzor").textContent).toContain("2 classrooms");
    // An inactive branch says so.
    expect(buttonStarting("Yunusobod").textContent).toContain("Inactive");
    // The add forms live only at the top.
    expect(host.querySelector("#ops-new-region")).toBeNull();

    await click(buttonStarting("Chilonzor"));
    expect(host.textContent).toContain("Classrooms at Chilonzor");
    expect(host.querySelector('[data-classroom="100"]')!.textContent).toContain("SAT A");
    expect(host.querySelector('[data-classroom="100"]')!.textContent).toContain("Chilonzor · Tashkent");
    expect(crumbs().textContent).toContain("Chilonzor");

    await click(Array.from(crumbs().querySelectorAll("button")).find((b) => b.textContent === "Tashkent")!);
    expect(host.textContent).toContain("Branches in Tashkent");
    await click(Array.from(crumbs().querySelectorAll("button")).find((b) => b.textContent === "Regions")!);
    expect(host.textContent).toContain("in total");
  });

  it("lists the classrooms with no branch on their own step", async () => {
    await render();
    await click(buttonStarting("No branch yet"));
    expect(host.textContent).toContain("Classrooms with no branch");
    const row = host.querySelector('[data-classroom="102"]')!;
    expect(row.textContent).toContain("SAT C");
    expect(row.textContent).toContain("No branch");
  });

  it("says when a branch has no classrooms yet", async () => {
    await render();
    await click(buttonStarting("Tashkent"));
    await click(buttonStarting("Yunusobod"));
    expect(host.textContent).toContain("No classrooms at this branch yet");
  });
});

describe("add and move", () => {
  it("adds a region with the name as typed", async () => {
    api.createRegion.mockResolvedValue({ id: 2, name: "Samarqand" });
    await render();
    const [addRegion] = addButtons();
    expect(addRegion.disabled).toBe(true);
    await type(host.querySelector<HTMLInputElement>("#ops-new-region")!, "Samarqand");
    await click(addButtons()[0]);
    expect(api.createRegion).toHaveBeenCalledWith({ name: "Samarqand" });
    expect(host.querySelector<HTMLInputElement>("#ops-new-region")!.value).toBe("");
  });

  it("adds a branch in the region picked", async () => {
    api.createBranch.mockResolvedValue({ id: 12 });
    await render();
    await type(host.querySelector<HTMLInputElement>("#ops-new-branch")!, "Sergeli");
    expect(addButtons()[1].disabled).toBe(true);
    await choose(host.querySelector<HTMLSelectElement>('select[aria-label="Region for the new branch"]')!, "1");
    await click(addButtons()[1]);
    expect(api.createBranch).toHaveBeenCalledWith({ name: "Sergeli", region: 1 });
  });

  it("shows the server's words when an add is refused", async () => {
    api.createRegion.mockRejectedValue({ response: { status: 400, data: { detail: "A region with that name exists." } } });
    await render();
    await type(host.querySelector<HTMLInputElement>("#ops-new-region")!, "Tashkent");
    await click(addButtons()[0]);
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("A region with that name exists.");
  });

  it("moves a classroom to a branch and says how many students moved", async () => {
    api.setClassroomBranch.mockResolvedValue({ detail: "Classroom moved.", students_affected: 12 });
    await render();
    await click(buttonStarting("No branch yet"));
    await choose(host.querySelector<HTMLSelectElement>('select[aria-label="Branch for SAT C"]')!, "10");
    expect(api.setClassroomBranch).toHaveBeenCalledWith(102, 10);
    expect(host.textContent).toContain("Classroom moved. 12 students moved.");
  });

  it("clears a classroom's branch with null, and words a refusal the page's way", async () => {
    api.setClassroomBranch.mockRejectedValue(new Error("network"));
    await render();
    await click(buttonStarting("Tashkent"));
    await click(buttonStarting("Chilonzor"));
    await choose(host.querySelector<HTMLSelectElement>('select[aria-label="Branch for SAT A"]')!, "");
    expect(api.setClassroomBranch).toHaveBeenCalledWith(100, null);
    expect(host.textContent).toContain("Couldn't change the branch.");
  });
});

describe("empty and failed", () => {
  it("shows the empty state when there are no regions and every classroom has a branch", async () => {
    api.regions.mockResolvedValue([]);
    api.branches.mockResolvedValue([]);
    api.classrooms.mockResolvedValue([]);
    await render();
    expect(host.textContent).toContain("No regions yet");
    expect(host.textContent).toContain("Add one, then a branch inside it — until there is a branch, no student has one.");
  });

  it("never draws a failed load as no regions, and tries again", async () => {
    api.regions.mockRejectedValueOnce(new Error("boom"));
    await render();
    expect(host.textContent).toContain("This didn't load.");
    expect(host.textContent).not.toContain("No regions yet");
    await click(buttonStarting("Try again"));
    expect(api.regions).toHaveBeenCalledTimes(2);
    expect(buttonStarting("Tashkent")).toBeDefined();
  });
});
