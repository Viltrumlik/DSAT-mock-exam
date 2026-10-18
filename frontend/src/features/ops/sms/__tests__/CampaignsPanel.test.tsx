import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { campaign } from "./fixtures";

/** The campaigns list: what each one says, to whom, when, how it went — and the way to a new one. */

const campaigns = vi.fn();
const refetch = vi.fn();

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/features/ops/sms/smsHooks", () => ({ useSmsCampaigns: () => campaigns() }));
vi.mock("@/features/ops/sms/CampaignWizard", () => ({
  CampaignWizard: () => <div role="dialog">wizard-open</div>,
}));

const { CampaignsPanel } = await import("@/features/ops/sms/CampaignsPanel");

let container: HTMLDivElement;
let root: Root;
const text = () => document.body.textContent ?? "";
const button = (label: string) =>
  Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim() === label)!;

async function render(state: Record<string, unknown>) {
  campaigns.mockReturnValue({ isPending: false, isError: false, refetch, ...state });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<CampaignsPanel />));
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  refetch.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("CampaignsPanel", () => {
  it("lists each campaign with its status, text, audience, time, counts and author", async () => {
    await render({
      data: [
        campaign(),
        campaign({
          id: 8, status: "DONE", audience: "debtors", audience_ids: [], audience_label: "Debtors",
          result: { sent: 12, failed: 1, rejected: 0, uncertain: 0, delivered: 10, undelivered: 1, errors: 0, skipped: {} },
        }),
      ],
    });
    const [scheduled, done] = [...container.querySelectorAll("tbody tr")];
    expect(scheduled.textContent).toContain("Scheduled");
    expect(scheduled.textContent).toContain("MASTER SAT'dan yozyabmiz. (STUDENT), sizda");
    expect(scheduled.textContent).toContain("Group: Junior G21 | Math");
    expect(scheduled.textContent).toContain("20 Oct 2026");
    expect(scheduled.textContent).toContain("Admin Aliyev");
    expect(scheduled.querySelector('a[href="/ops/sms/campaigns/7"]')).not.toBeNull();
    expect(done.textContent).toContain("Done");
    expect(done.textContent).toContain("Debtors");
    expect(done.textContent).toContain("12 sent · 10 delivered · 1 failed");
  });

  it("opens the wizard from New campaign", async () => {
    await render({ data: [] });
    expect(text()).not.toContain("wizard-open");
    await act(async () => button("New campaign").click());
    expect(text()).toContain("wizard-open");
  });

  it("says there are none yet, and offers a retry when the list did not load", async () => {
    await render({ data: [] });
    expect(text()).toContain("No campaigns yet");
    await act(async () => root.unmount());
    container.remove();

    await render({ isError: true, data: undefined });
    expect(text()).toContain("The campaigns didn't load.");
    await act(async () => button("Try again").click());
    expect(refetch).toHaveBeenCalled();
  });
});
