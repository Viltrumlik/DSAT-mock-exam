import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { money } from "../format";
import type { SmsOverview } from "../smsApi";

/**
 * The Overview: what the account has left, whether eskiz is answering, whether the debt warning
 * will go out and when, and how the last days went — plus the two warnings that mean nothing at
 * all will be sent.
 */

const overview = vi.fn();
const refetch = vi.fn();

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/features/ops/sms/smsHooks", () => ({
  useSmsOverview: () => overview(),
  useSmsTemplates: () => ({ data: { templates: [], synced_at: null }, isPending: false, isError: false }),
  useSendTestSms: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { OverviewPanel } = await import("@/features/ops/sms/OverviewPanel");

function data(over: Partial<SmsOverview> = {}): SmsOverview {
  return {
    configured: true,
    balance: 63460,
    price_per_part: 170,
    sender: "4546",
    eskiz: { token_cached: true, login_refused: false, last_error: "" },
    debt: {
      enabled: true, env_enabled: true, db_enabled: true, freeze_enabled: true, hour: 10, next_day: "2026-11-01",
      next_count: 12,
    },
    today: { total: 2, by_status: { DELIVERED: 2 } },
    last7: { total: 9, by_status: { DELIVERED: 6, UNDELIVERED: 1, FAILED: 1, SENT: 1 } },
    ...over,
  };
}

let container: HTMLDivElement;
let root: Root;
const text = () => document.body.textContent ?? "";

async function render(state: Record<string, unknown>) {
  overview.mockReturnValue({ isPending: false, isError: false, refetch, ...state });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<OverviewPanel />));
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  refetch.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("OverviewPanel", () => {
  it("shows the balance with the price of a part, the sender and eskiz's health", async () => {
    await render({ data: data() });
    expect(text()).toContain(money(63460));
    expect(text()).toContain(`${money(170)} per SMS part`);
    expect(text()).toContain("4546");
    expect(text()).toContain("Signed in");
    expect(text()).not.toContain("not configured");
  });

  it("says when and to how many the debt warning goes next, with a way to its tab", async () => {
    await render({ data: data() });
    expect(text()).toContain("On");
    expect(text()).toContain("Sends at 10:00");
    expect(text()).toContain("Next: 1 Nov 2026 · 12 students");
    expect(document.body.querySelector('a[href="/ops/sms?tab=debt"]')).not.toBeNull();
  });

  it("splits the last 7 days into delivered, not delivered and the rest", async () => {
    await render({ data: data() });
    expect(text()).toContain("6 delivered");
    expect(text()).toContain("2 not delivered");
    expect(text()).toContain("1 other");
    expect(text()).toContain("2 delivered");
  });

  it("warns when eskiz is not configured on the server", async () => {
    await render({ data: data({ configured: false, balance: null }) });
    expect(text()).toContain("eskiz is not configured on this server");
    expect(text()).toContain("Couldn't ask eskiz");
  });

  it("warns when the server's master switch keeps the debt warning off, and says why it is off", async () => {
    await render({
      data: data({ debt: { ...data().debt, enabled: false, env_enabled: false } }),
    });
    expect(text()).toContain("master switch is off on this server");
    expect(text()).toContain("Off");
    expect(text()).toContain("the server's master switch is off");
  });

  it("names a refused login and the last error", async () => {
    await render({
      data: data({ eskiz: { token_cached: false, login_refused: true, last_error: "HTTP 422: mobile_phone" } }),
    });
    expect(text()).toContain("Login refused");
    expect(text()).toContain("HTTP 422: mobile_phone");
  });

  it("offers a retry when the overview did not load, not an empty page", async () => {
    await render({ isError: true, data: undefined });
    expect(text()).toContain("The overview didn't load.");
    const retry = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent === "Try again")!;
    await act(async () => retry.click());
    expect(refetch).toHaveBeenCalled();
  });

  it("shows it is loading", async () => {
    await render({ isPending: true, data: undefined });
    expect(text()).toContain("Loading…");
  });
});
