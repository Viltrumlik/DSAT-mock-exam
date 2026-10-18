import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { money } from "../format";
import { campaign, message } from "./fixtures";

/**
 * One campaign: what it said, to whom, when, how each SMS went — and only the buttons its state
 * allows: Cancel while it waits, Retry failed once it is done with failures. Both ask first.
 */

const detail = vi.fn();
const cancel = vi.fn();
const retry = vi.fn();
const confirmSpy = vi.fn();

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/features/ops/sms/smsHooks", () => ({
  useSmsCampaign: () => detail(),
  useCancelCampaign: () => ({ mutate: cancel, isPending: false }),
  useRetryCampaign: () => ({ mutate: retry, isPending: false }),
  useSmsOverview: () => ({ data: { price_per_part: 170 } }),
}));

const { CampaignPage } = await import("@/features/ops/sms/CampaignPage");

let container: HTMLDivElement;
let root: Root;
const text = () => document.body.textContent ?? "";
const button = (label: string) =>
  Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);

async function render(state: Record<string, unknown>, id = 7) {
  detail.mockReturnValue({ isPending: false, isError: false, refetch: vi.fn(), ...state });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<CampaignPage id={id} />));
}

const DONE = campaign({
  status: "DONE",
  started_at: "2026-10-20T09:30:00+05:00",
  finished_at: "2026-10-20T09:30:09+05:00",
  result: {
    sent: 2, failed: 1, rejected: 0, uncertain: 0, delivered: 1, undelivered: 0, errors: 0,
    skipped: { no_phone: [{ user_id: 11, name: "Sardor Rasulov" }] },
  },
});
const DONE_MESSAGES = [
  message(),
  message({ id: 4, status: "FAILED", user: { id: 9, name: "Bekzod Aliyev" }, phone: "998935550000", error: "HTTP 500" }),
];

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  confirmSpy.mockReset().mockReturnValue(true);
  vi.stubGlobal("confirm", confirmSpy);
  cancel.mockReset();
  retry.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("CampaignPage", () => {
  it("shows Cancel while it is scheduled, and no Retry", async () => {
    await render({ data: { campaign: campaign(), messages: [] } });
    expect(text()).toContain("Scheduled");
    expect(text()).toContain("Group: Junior G21 | Math");
    expect(text()).toContain("Admin Aliyev");
    expect(button("Cancel campaign")).toBeDefined();
    expect(button("Retry failed")).toBeUndefined();
    expect(text()).toContain("Nothing has been sent yet.");
  });

  it("cancels only after asking", async () => {
    await render({ data: { campaign: campaign(), messages: [] } });
    confirmSpy.mockReturnValueOnce(false);
    await act(async () => button("Cancel campaign")!.click());
    expect(cancel).not.toHaveBeenCalled();
    await act(async () => button("Cancel campaign")!.click());
    expect(cancel).toHaveBeenCalled();
  });

  it("shows the result, each recipient's SMS, and Retry failed once done — never Cancel", async () => {
    await render({ data: { campaign: DONE, messages: DONE_MESSAGES } });
    expect(button("Cancel campaign")).toBeUndefined();
    expect(button("Retry failed")).toBeDefined();
    expect(text()).toContain("2 sent");
    expect(text()).toContain("1 delivered");
    expect(text()).toContain("1 failed");
    expect(text()).toContain("Sardor Rasulov");
    const rows = [...container.querySelectorAll("tbody tr")].map((r) => r.textContent ?? "");
    expect(rows[0]).toContain("Malika Karimova");
    expect(rows[0]).toContain("Delivered");
    expect(rows[1]).toContain("Bekzod Aliyev");
    expect(rows[1]).toContain("HTTP 500");
  });

  it("retries the failed ones after asking with their count and price", async () => {
    retry.mockImplementation((_v: unknown, opts: { onSuccess: (r: { queued: number }) => void }) => opts.onSuccess({ queued: 1 }));
    await render({ data: { campaign: DONE, messages: DONE_MESSAGES } });
    await act(async () => button("Retry failed")!.click());
    expect(confirmSpy).toHaveBeenCalledWith(`Send again to 1 recipient whose SMS failed (~${money(170)})?`);
    expect(retry).toHaveBeenCalled();
    expect(text()).toContain("Sending again to 1 recipient.");
  });

  it("has no Retry when nothing failed", async () => {
    await render({ data: { campaign: DONE, messages: [message()] } });
    expect(button("Retry failed")).toBeUndefined();
  });

  it("shows the server's reason when an action is refused", async () => {
    cancel.mockImplementation((_v: unknown, opts: { onError: (e: unknown) => void }) =>
      opts.onError({ response: { data: { code: "not_scheduled", detail: "It has already started." } } }),
    );
    await render({ data: { campaign: campaign(), messages: [] } });
    await act(async () => button("Cancel campaign")!.click());
    expect(text()).toContain("It has already started.");
  });

  it("says a bad address is no campaign, and offers a retry when it did not load", async () => {
    await render({}, 0);
    expect(text()).toContain("That campaign doesn't exist.");
    await act(async () => root.unmount());
    container.remove();

    await render({ isError: true, data: undefined });
    expect(text()).toContain("The campaign didn't load.");
  });
});
