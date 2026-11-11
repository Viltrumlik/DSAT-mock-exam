import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { money } from "../format";
import type { AudiencePreview, CampaignPreview } from "../smsApi";
import { campaign, EVENT_TEMPLATE, REJECTED_TEMPLATE, template } from "./fixtures";

/**
 * A campaign on one page. Worth pinning: Send only ever follows a preview of exactly what is on the
 * screen, it asks with the count and the price, and a send that may have gone out cannot be sent again.
 */

const previewDraft = vi.fn();
const previewAudience = vi.fn();
const create = vi.fn();
const toast = vi.fn();
const push = vi.fn();
const confirmSpy = vi.fn();
const sourceArgs = vi.fn();
let query = "";
let balance: number | null = 1_000_000;
let source: Record<string, unknown> = {};

const NAMED = template({ alias: "Debt reminder", label: "Debt reminder", used_count: 12 });

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(query),
  useRouter: () => ({ push }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/components/ToastProvider", () => ({ useToast: () => ({ push: toast }) }));
vi.mock("@/features/ops/sms/smsHooks", () => ({
  STUDENT_SEARCH_MIN: 2,
  useSmsTemplates: () => ({
    data: { templates: [NAMED, EVENT_TEMPLATE, REJECTED_TEMPLATE], synced_at: null },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useAudienceClassrooms: () => ({
    data: [{ id: 61, name: "Junior G21 | Math", students: 14, with_phone: 12 }],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useAudienceOptions: () => ({
    data: { subjects: [{ value: "MATH", label: "Math", classes: 2 }], levels: [], branches: [], days: [] },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useAudienceStudents: () => ({ data: undefined, isPending: false, isError: false, isFetching: false }),
  useSmsOverview: () => ({ data: { balance } }),
  useSmsCampaign: (...args: unknown[]) => {
    sourceArgs(...args);
    return source;
  },
  usePreviewCampaign: () => ({ mutate: previewDraft }),
  usePreviewAudience: () => ({ mutate: previewAudience }),
  useCreateCampaign: () => ({ mutate: create, isPending: false }),
}));

const { CampaignComposer } = await import("@/features/ops/sms/CampaignComposer");

const RECIPIENT = { user_id: 5, name: "Malika Karimova", phone: "99890***4567", groups: ["Junior G21 | Math"] };

function audienceAnswer(over: Partial<AudiencePreview> = {}): AudiencePreview {
  return {
    count: 142,
    over_limit: false,
    limit: 300,
    skipped: { no_phone: [{ user_id: 11, name: "Sardor Rasulov" }] },
    recipients: [RECIPIENT],
    ...over,
  };
}

function draftAnswer(over: Partial<CampaignPreview> = {}): CampaignPreview {
  return {
    count: 142,
    over_limit: false,
    limit: 300,
    samples: [{ name: "Malika Karimova", phone: "998901234567", text: "MASTER SAT'dan yozyabmiz. Karimova Malika", parts: 1 }],
    parts_total: 284,
    cost: 48280,
    skipped: { no_phone: [{ user_id: 11, name: "Sardor Rasulov" }] },
    recipients: [RECIPIENT],
    ...over,
  };
}

let container: HTMLDivElement;
let root: Root;
const text = () => document.body.textContent ?? "";
const buttons = () => Array.from(document.body.querySelectorAll("button"));
const button = (label: string) => buttons().find((b) => b.textContent?.trim() === label)!;
const sendButtons = () => buttons().filter((b) => b.textContent?.trim().startsWith("Send"));
const radio = (label: string) =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find((b) => b.textContent?.trim() === label)!;
const cardHead = (title: string) => buttons().find((b) => b.getAttribute("aria-expanded") !== null && b.textContent?.includes(title))!;
const click = async (el: HTMLElement) => act(async () => el.click());
const settle = async () => act(async () => void vi.advanceTimersByTime(400));
const control = (label: string) =>
  Array.from(document.body.querySelectorAll("label")).find((l) => l.textContent?.trim().startsWith(label))!.control as HTMLInputElement;

async function setValue(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function render(search = "") {
  query = search;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<CampaignComposer />));
  await settle();
}

const lastDraft = () => previewDraft.mock.calls.at(-1)![0];

/** Debtors, the named template, now: a draft the server has priced. */
async function ready() {
  await render();
  await click(radio("Debtors"));
  await settle();
  await click(button("Continue"));
  await click(buttons().find((b) => b.textContent?.includes("Debt reminder"))!);
  await settle();
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ now: new Date("2026-11-03T08:00:00+05:00"), toFake: ["setTimeout", "clearTimeout", "Date"] });
  confirmSpy.mockReset().mockReturnValue(true);
  vi.stubGlobal("confirm", confirmSpy);
  previewDraft.mockReset().mockImplementation((_d: unknown, o: { onSuccess: (p: CampaignPreview) => void }) => o.onSuccess(draftAnswer()));
  previewAudience.mockReset().mockImplementation((_d: unknown, o: { onSuccess: (p: AudiencePreview) => void }) => o.onSuccess(audienceAnswer()));
  create.mockReset();
  toast.mockReset();
  push.mockReset();
  balance = 1_000_000;
  source = { isPending: false, isError: false, data: undefined, refetch: vi.fn() };
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("CampaignComposer", () => {
  it("folds each done card into a one-line summary", async () => {
    await render();
    await click(radio("Debtors"));
    await settle();
    await click(button("Continue"));
    expect(cardHead("Who").textContent).toContain("142 students · Debtors");

    await click(buttons().find((b) => b.textContent?.includes("Debt reminder"))!);
    await settle();
    await click(button("Continue"));
    expect(cardHead("Message").textContent).toContain("Debt reminder · MASTER SAT'dan yozyabmiz.");

    await click(cardHead("Who"));
    expect(cardHead("When").textContent).toContain("Now");
  });

  it("counts the audience before a template is chosen, then prices the whole draft", async () => {
    await render();
    await click(radio("Debtors"));
    expect(previewAudience).not.toHaveBeenCalled();
    await settle();
    expect(previewAudience.mock.calls[0][0]).toEqual({ audience: "debtors", audience_ids: [], excluded_user_ids: [] });
    expect(previewDraft).not.toHaveBeenCalled();
    expect(text()).toContain("142 students · 1 no phone");
    await click(button("Continue"));
    await click(buttons().find((b) => b.textContent?.includes("Debt reminder"))!);
    await settle();
    expect(lastDraft()).toEqual({
      template_id: 64942, slot_roles: ["student"], slot_texts: [""], audience: "debtors", audience_ids: [],
      excluded_user_ids: [], scheduled_at: null,
    });
    expect(text()).toContain(`142 students · 1 no phone · 284 parts · ~${money(48280)}`);
  });

  it("?from= prefills the template, roles, texts and audience from the campaign", async () => {
    source = {
      isPending: false,
      isError: false,
      refetch: vi.fn(),
      data: {
        messages: [],
        campaign: campaign({
          template_eskiz_id: 70001,
          slot_roles: ["text", "text"],
          slot_texts: ["Mock imtihon", "10"],
          audience: "filter",
          audience_ids: [],
          audience_filter: { subjects: ["MATH"], levels: [], branches: [], days: [] },
          excluded_user_ids: [9],
        }),
      },
    };
    await render("from=7");
    // Read once: a poll of a campaign still sending would be a request for nothing, every 5 s.
    expect(sourceArgs).toHaveBeenLastCalledWith(7, false);
    expect(lastDraft()).toEqual({
      template_id: 70001, slot_roles: ["text", "text"], slot_texts: ["Mock imtihon", "10"], audience: "filter",
      audience_ids: [], audience_filter: { subjects: ["MATH"], levels: [], branches: [], days: [] },
      excluded_user_ids: [9], scheduled_at: null,
    });
  });

  it("?from= waits for the campaign, and says so when it cannot be read", async () => {
    source = { isPending: true, isError: false, data: undefined, refetch: vi.fn() };
    await render("from=7");
    expect(buttons().some((b) => b.getAttribute("aria-expanded") !== null)).toBe(false);
    await act(async () => root.unmount());
    container.remove();
    source = { isPending: false, isError: true, data: undefined, refetch: vi.fn() };
    await render("from=7");
    expect(text()).toContain("didn't load");
  });

  it("?student= preselects that student and opens the message", async () => {
    await render("student=5");
    expect(previewAudience.mock.calls[0][0]).toEqual({ audience: "student", audience_ids: [5], excluded_user_ids: [] });
    expect(cardHead("Who").textContent).toContain("Malika Karimova");
    expect(cardHead("Message").getAttribute("aria-expanded")).toBe("true");
  });

  it("?classroom= preselects that class (the class page's Message class) and opens the message", async () => {
    await render("classroom=61");
    expect(previewAudience.mock.calls[0][0]).toEqual({ audience: "group", audience_ids: [61], excluded_user_ids: [] });
    expect(cardHead("Who").textContent).toContain("Junior G21 | Math");
    expect(cardHead("Message").getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps Send off while the preview is on its way", async () => {
    await render();
    await click(radio("Debtors"));
    await settle();
    await click(button("Continue"));
    previewDraft.mockImplementation(() => undefined); // no answer yet
    await click(buttons().find((b) => b.textContent?.includes("Debt reminder"))!);
    await settle();
    expect(previewDraft).toHaveBeenCalledTimes(1);
    expect(sendButtons().length).toBeGreaterThan(0);
    expect(sendButtons().every((b) => b.disabled)).toBe(true);
    await act(async () => previewDraft.mock.calls[0][1].onSuccess(draftAnswer()));
    expect(sendButtons().every((b) => !b.disabled)).toBe(true);
  });

  it("drops an answer for a draft that has since changed", async () => {
    await ready();
    const stale = vi.fn();
    previewDraft.mockImplementation((d: unknown, o: { onSuccess: (p: CampaignPreview) => void }) => stale(d, o));
    await click(button("Continue"));
    await click(radio("At a set time"));
    await setValue(control("Goes out at"), "2026-11-03T15:00");
    await settle();
    const first = stale.mock.calls.at(-1)!;
    await setValue(control("Goes out at"), "2026-11-03T16:00");
    await act(async () => first[1].onSuccess(draftAnswer({ count: 1 })));
    expect(sendButtons().every((b) => b.disabled)).toBe(true);
  });

  it("asks with the exact count, price and time, posts the draft and opens the campaign", async () => {
    create.mockImplementation((_d: unknown, o: { onSuccess: (c: unknown) => void }) => o.onSuccess(campaign({ id: 9, status: "SENDING" })));
    await ready();
    await click(sendButtons()[0]);
    expect(confirmSpy).toHaveBeenCalledWith(`Send 142 SMS, ~${money(48280)}, now?`);
    expect(create.mock.calls[0][0]).toEqual(lastDraft());
    expect(push).toHaveBeenCalledWith("/ops/sms/campaigns/9");
    expect(toast).toHaveBeenCalled();
  });

  it("names the time when it goes out later, and sends nothing on Cancel", async () => {
    confirmSpy.mockReturnValue(false);
    await ready();
    await click(button("Continue"));
    await click(button("Tomorrow 10:00"));
    await settle();
    await click(sendButtons()[0]);
    expect(confirmSpy).toHaveBeenCalledWith(`Send 142 SMS, ~${money(48280)}, at 4 Nov, 10:00?`);
    expect(lastDraft().scheduled_at).toBe(new Date("2026-11-04T10:00:00+05:00").toISOString());
    expect(create).not.toHaveBeenCalled();
  });

  it("will not send again after a send that may have gone out", async () => {
    create.mockImplementation((_d: unknown, o: { onError: (e: unknown) => void }) => o.onError(new Error("Network Error")));
    await ready();
    await click(sendButtons()[0]);
    expect(text()).toContain("may already have sent");
    expect(sendButtons().every((b) => b.disabled)).toBe(true);
  });

  it("treats a 5xx the same: the server may have created it before it failed", async () => {
    create.mockImplementation((_d: unknown, o: { onError: (e: unknown) => void }) =>
      o.onError({ response: { status: 502, data: "<html>Bad Gateway</html>" } }),
    );
    await ready();
    await click(sendButtons()[0]);
    expect(text()).toContain("may already have sent");
    expect(sendButtons().every((b) => b.disabled)).toBe(true);
  });

  it("lets a refused send be tried again", async () => {
    create.mockImplementation((_d: unknown, o: { onError: (e: unknown) => void }) =>
      o.onError({ response: { status: 400, data: { detail: "Nobody in that audience can get it." } } }),
    );
    await ready();
    await click(sendButtons()[0]);
    expect(text()).toContain("Nobody in that audience can get it.");
    expect(sendButtons().every((b) => !b.disabled)).toBe(true);
  });

  it("shows the server's refusal and keeps Send off", async () => {
    previewDraft.mockImplementation((_d: unknown, o: { onError: (e: unknown) => void }) =>
      o.onError({ response: { data: { detail: "Pick active classes only." } } }),
    );
    await ready();
    expect(text()).toContain("Pick active classes only.");
    expect(sendButtons().every((b) => b.disabled)).toBe(true);
  });

  it("keeps Send off over the limit and for nobody", async () => {
    previewDraft.mockImplementation((_d: unknown, o: { onSuccess: (p: CampaignPreview) => void }) => o.onSuccess(draftAnswer({ count: 301, over_limit: true })));
    await ready();
    expect(text()).toContain("More than 300 recipients");
    expect(sendButtons().every((b) => b.disabled)).toBe(true);
    await act(async () => root.unmount());
    container.remove();
    previewDraft.mockImplementation((_d: unknown, o: { onSuccess: (p: CampaignPreview) => void }) => o.onSuccess(draftAnswer({ count: 0, cost: 0, parts_total: 0 })));
    await ready();
    expect(text()).toContain("Nobody would receive it");
    expect(sendButtons().every((b) => b.disabled)).toBe(true);
  });

  it("says whether the balance covers it", async () => {
    await ready();
    expect(text()).toContain("balance OK");
    await act(async () => root.unmount());
    container.remove();
    balance = 40_000;
    await ready();
    expect(text()).toContain(`balance short by ${money(8280)}`);
  });

  it("shows the SMS as the server filled it", async () => {
    await ready();
    expect(text()).toContain("MASTER SAT'dan yozyabmiz. Karimova Malika");
  });

  it("a removed person goes into the next preview", async () => {
    await ready();
    await click(cardHead("Who"));
    await click(button("See the list"));
    await click(buttons().find((b) => b.getAttribute("aria-label") === "Remove Malika Karimova")!);
    await settle();
    expect(lastDraft().excluded_user_ids).toEqual([5]);
  });
});
