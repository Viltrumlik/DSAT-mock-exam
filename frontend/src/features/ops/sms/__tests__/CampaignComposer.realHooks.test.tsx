import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { campaign, template } from "./fixtures";

/**
 * The composer on the real hooks, with only the API stubbed. `CampaignComposer.test.tsx` mocks the
 * hooks whole, so it cannot see what a refetch, an invalidation or two mutation hooks do to the page,
 * and each bug here was invisible to it: all three are about a paid send.
 */

let query = "";
const push = vi.fn();
const toast = vi.fn();
const api: Record<string, Mock> = {};

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(query), useRouter: () => ({ push }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/components/ToastProvider", () => ({ useToast: () => ({ push: toast }) }));
vi.mock("@/features/ops/sms/smsApi", async (original) => ({
  ...(await original<typeof import("../smsApi")>()),
  smsApi: new Proxy({}, { get: (_target, name: string) => (...args: unknown[]) => (api[name] as unknown as (...a: unknown[]) => unknown)(...args) }),
}));

const { CampaignComposer } = await import("@/features/ops/sms/CampaignComposer");

const NAMED = template({ alias: "Debt reminder", label: "Debt reminder", used_count: 3 });
const AUDIENCE = { count: 142, over_limit: false, limit: 300, skipped: {}, recipients: [] };
const PRICED = { ...AUDIENCE, samples: [{ name: "M", phone: "998", text: "MASTER", parts: 1 }], parts_total: 142, cost: 24140 };
const SOURCE = campaign({ id: 12, status: "DONE", audience: "debtors", audience_ids: [], audience_label: "Debtors" });

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
const text = () => document.body.textContent ?? "";
const buttons = () => Array.from(document.body.querySelectorAll("button"));
const send = () => buttons().find((b) => b.textContent?.trim().startsWith("Send"))!;
const priced = () => send()?.disabled === false;
const click = (el: HTMLElement) => act(async () => el.click());
const pass = (ms: number) => act(async () => void (await new Promise((resolve) => setTimeout(resolve, ms))));
const networkDown = () =>
  vi.fn(async () => {
    throw new Error("Network Error");
  });

/**
 * The 400 ms debounce and the answers run on real timers, so a fixed wait fails on a busy machine:
 * in the full suite Send came on at 595-653 ms, past a 500 ms wait. The assertion after it says what never came.
 */
async function until(done: () => boolean, ms = 3000) {
  const deadline = performance.now() + ms;
  while (!done() && performance.now() < deadline) await pass(10);
}

async function mount(search: string) {
  query = search;
  // No query retries, so a failed refresh fails now and not three seconds from now.
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 15_000 } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<QueryClientProvider client={client}><CampaignComposer /></QueryClientProvider>));
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("confirm", vi.fn(() => true));
  push.mockReset();
  toast.mockReset();
  Object.assign(api, {
    templates: vi.fn(async () => ({ templates: [NAMED], synced_at: null })),
    classrooms: vi.fn(async () => []),
    audienceOptions: vi.fn(async () => ({ subjects: [], levels: [], branches: [], days: [] })),
    overview: vi.fn(async () => ({ balance: 1_000_000, price_per_part: 170 })),
    students: vi.fn(async () => []),
    campaign: vi.fn(async () => ({ campaign: SOURCE, messages: [] })),
    previewCampaign: vi.fn(async () => PRICED),
    previewAudience: vi.fn(async () => AUDIENCE),
    createCampaign: vi.fn(async () => campaign({ id: 99, status: "SENDING" })),
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("CampaignComposer on the real hooks", () => {
  it("a send with no answer, then a failed refresh of the campaign being repeated, keeps the page and Send off", async () => {
    await mount("from=12");
    await until(priced);
    expect(send().disabled).toBe(false);
    api.createCampaign = networkDown();
    api.campaign = networkDown();
    await click(send());
    // The no-answer invalidates the panel, and the source campaign's refresh fails: the page stays.
    await until(() => api.campaign.mock.calls.length > 0 && client.isFetching() === 0);
    await pass(50);
    expect(api.campaign).toHaveBeenCalled();
    expect(text()).not.toContain("didn't load");
    expect(text()).toContain("may already have sent");
    expect(send().disabled).toBe(true);
    expect(api.createCampaign).toHaveBeenCalledTimes(1);
  });

  it("Send stays off once the campaign is created, until the page has moved on", async () => {
    await mount("from=12");
    await until(priced);
    await click(send());
    await until(() => push.mock.calls.length > 0);
    expect(push).toHaveBeenCalledWith("/ops/sms/campaigns/99");
    expect(send().disabled).toBe(true);
    await click(send());
    expect(api.createCampaign).toHaveBeenCalledTimes(1);
  });

  it("an audience answer that comes after the draft's does not undo it", async () => {
    let answerAudience: (reply: unknown) => void = () => {};
    api.previewAudience = vi.fn(() => new Promise((resolve) => (answerAudience = resolve)));
    await mount("student=5");
    await until(() => api.previewAudience.mock.calls.length > 0);
    expect(api.previewAudience).toHaveBeenCalledTimes(1);
    await click(buttons().find((b) => b.textContent?.includes("Debt reminder"))!);
    await until(priced);
    expect(send().disabled).toBe(false);
    await act(async () => answerAudience({ ...AUDIENCE, count: 1 }));
    await pass(20);
    expect(send().disabled).toBe(false);
    expect(send().textContent).toContain("Send 142 SMS");
  });
});
