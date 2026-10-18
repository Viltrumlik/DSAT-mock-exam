import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * /ops/sms: one page, five tabs, the open one in `?tab=` so a link and a reload land on it. The
 * panels are each tested on their own; here only which one the address opens.
 */

let search = "";
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/ops/sms",
}));
vi.mock("@/features/ops/sms/OverviewPanel", () => ({ OverviewPanel: () => <p>overview-panel</p> }));
vi.mock("@/features/ops/sms/JournalPanel", () => ({ JournalPanel: () => <p>journal-panel</p> }));
vi.mock("@/features/ops/sms/CampaignsPanel", () => ({ CampaignsPanel: () => <p>campaigns-panel</p> }));
vi.mock("@/features/ops/sms/DebtPanel", () => ({ DebtPanel: () => <p>debt-panel</p> }));
vi.mock("@/features/ops/sms/TemplatesPanel", () => ({ TemplatesPanel: () => <p>templates-panel</p> }));

const { SmsPage } = await import("@/features/ops/sms/SmsPage");

let container: HTMLDivElement;
let root: Root;
const text = () => document.body.textContent ?? "";
const tab = (label: string) =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((b) => b.textContent?.trim() === label)!;

async function render(query = "") {
  search = query;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<SmsPage />));
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  replace.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("SmsPage", () => {
  it("opens on the Overview, under the SMS header", async () => {
    await render();
    expect(text()).toContain("Admin console · SMS");
    expect(text()).toContain("overview-panel");
    expect(text()).not.toContain("journal-panel");
    const labels = Array.from(document.body.querySelectorAll('[role="tab"]')).map((t) => t.textContent?.trim());
    expect(labels).toEqual(["Overview", "Journal", "Campaigns", "Debt warnings", "Templates"]);
    expect(tab("Overview").getAttribute("aria-selected")).toBe("true");
  });

  it.each([
    ["tab=journal", "journal-panel"],
    ["tab=campaigns", "campaigns-panel"],
    ["tab=debt", "debt-panel"],
    ["tab=templates", "templates-panel"],
  ])("opens the tab the address names (%s)", async (query, panel) => {
    await render(query);
    expect(text()).toContain(panel);
    expect(text()).not.toContain("overview-panel");
  });

  it("treats an unknown tab as the Overview", async () => {
    await render("tab=nonsense");
    expect(text()).toContain("overview-panel");
  });

  it("puts the chosen tab in the address, and the Overview as the bare page", async () => {
    await render("tab=journal&kind=test&q=998");
    await act(async () => tab("Campaigns").click());
    expect(replace).toHaveBeenLastCalledWith("/ops/sms?tab=campaigns", { scroll: false });
    await act(async () => tab("Overview").click());
    expect(replace).toHaveBeenLastCalledWith("/ops/sms", { scroll: false });
  });
});
