import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { fromLocalInput, toLocalInput } from "@/lib/datetimeLocal";
import { dateTime, money } from "../format";
import type { CampaignPreview } from "../smsApi";
import { EVENT_TEMPLATE, REJECTED_TEMPLATE, template } from "./fixtures";

/**
 * The new-campaign wizard: template → slots → audience → when → preview → send. Worth pinning:
 * the roles start from the server's guess, an empty text slot cannot go on, the preview's
 * figures are shown before anything is sent, and the send asks with the count and the price,
 * then posts exactly the draft that was previewed.
 */

const preview = vi.fn();
const create = vi.fn();
const toast = vi.fn();
const confirmSpy = vi.fn();
const studentsQuery = vi.fn();
const refetchTemplates = vi.fn();
const refetchClassrooms = vi.fn();
let templatesFailed = false;
let classroomsFailed = false;
let previewPending = false;

vi.mock("@/components/ToastProvider", () => ({ useToast: () => ({ push: toast }) }));
vi.mock("@/features/ops/sms/smsHooks", () => ({
  useSmsTemplates: () =>
    templatesFailed
      ? { data: undefined, isPending: false, isError: true, refetch: refetchTemplates }
      : {
          data: { templates: [template(), EVENT_TEMPLATE, REJECTED_TEMPLATE], synced_at: null },
          isPending: false,
          isError: false,
          refetch: refetchTemplates,
        },
  useAudienceStudents: (q: string) => studentsQuery(q),
  useAudienceClassrooms: () =>
    classroomsFailed
      ? { data: undefined, isPending: false, isError: true, refetch: refetchClassrooms }
      : {
          data: [{ id: 61, name: "Junior G21 | Math", students: 14, with_phone: 12 }],
          isPending: false,
          isError: false,
          refetch: refetchClassrooms,
        },
  usePreviewCampaign: () => ({ mutate: preview, isPending: previewPending }),
  useCreateCampaign: () => ({ mutate: create, isPending: false }),
  STUDENT_SEARCH_MIN: 2,
}));

const { CampaignWizard } = await import("@/features/ops/sms/CampaignWizard");

const STUDENTS = [
  { id: 5, name: "Malika Karimova", lcup_name: "Karimova Malika", phone: "998901234567", balance: -150000 },
  { id: 9, name: "Bekzod Aliyev", lcup_name: "Aliyev Bekzod", phone: "998935550000", balance: 0 },
];

function previewOf(over: Partial<CampaignPreview> = {}): CampaignPreview {
  return {
    count: 2,
    over_limit: false,
    limit: 300,
    samples: [{ name: "Malika Karimova", phone: "998901234567", text: "Ertaga Mock imtihon soat 10 da.", parts: 1 }],
    parts_total: 2,
    cost: 340,
    skipped: { no_link: [], no_phone: [{ user_id: 11, name: "Sardor Rasulov" }], not_debtor: [], bad_text: [] },
    ...over,
  };
}

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();
const text = () => document.body.textContent ?? "";
const buttons = () => Array.from(document.body.querySelectorAll("button"));
const button = (label: string) => buttons().find((b) => b.textContent?.trim() === label)!;
const controlOf = (label: string) =>
  Array.from(document.body.querySelectorAll("label")).find((l) => l.textContent?.trim().startsWith(label))!.control as
    | HTMLInputElement
    | HTMLSelectElement;
const radio = (label: string) =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find((b) => b.textContent?.trim() === label)!;

async function setValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
const click = async (el: HTMLElement) => act(async () => el.click());

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<CampaignWizard onClose={onClose} />));
}

/** Template 70001 with both slots typed, then on to the audience step. */
async function throughSlots() {
  await setValue(controlOf("Template"), "70001");
  await click(button("Next"));
  await setValue(controlOf("Text for slot 1"), "Mock imtihon");
  await setValue(controlOf("Text for slot 2"), "10");
  await click(button("Next"));
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  confirmSpy.mockReset().mockReturnValue(true);
  vi.stubGlobal("confirm", confirmSpy);
  preview.mockReset().mockImplementation((_draft: unknown, opts: { onSuccess: (p: CampaignPreview) => void }) =>
    opts.onSuccess(previewOf()),
  );
  create.mockReset();
  toast.mockReset();
  onClose.mockReset();
  refetchTemplates.mockReset();
  refetchClassrooms.mockReset();
  templatesFailed = false;
  classroomsFailed = false;
  previewPending = false;
  studentsQuery.mockReset().mockImplementation((q: string) => ({
    data: q.trim().length >= 2 ? STUDENTS : undefined,
    isPending: false,
    isError: false,
    isFetching: false,
  }));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("CampaignWizard", () => {
  it("offers only usable templates and shows the chosen one's pattern and original", async () => {
    await render();
    const values = Array.from(controlOf("Template").querySelectorAll("option")).map((o) => o.value);
    expect(values).toEqual(["", "64942", "70001"]);
    await setValue(controlOf("Template"), "70001");
    expect(text()).toContain("Ertaga %w{1,3} soat %d da.");
    expect(text()).toContain("Ertaga (EVENT) soat (TIME) da.");
  });

  it("will not go on without a template", async () => {
    await render();
    await click(button("Next"));
    expect(text()).toContain("Pick a template.");
  });

  it("starts each slot's role from the server's guess", async () => {
    await render();
    await setValue(controlOf("Template"), "64942");
    await click(button("Next"));
    expect((controlOf("Slot 1") as HTMLSelectElement).value).toBe("student");
    expect(document.body.querySelectorAll('input[type="text"], input:not([type])').length).toBe(0);

    await click(button("Back"));
    await setValue(controlOf("Template"), "70001");
    await click(button("Next"));
    const roles = Array.from(document.body.querySelectorAll("select")).map((s) => s.value);
    expect(roles).toEqual(["text", "text"]);
  });

  it("blocks Next while a text slot is empty", async () => {
    await render();
    await setValue(controlOf("Template"), "70001");
    await click(button("Next"));
    await setValue(controlOf("Text for slot 1"), "Mock imtihon");
    await click(button("Next"));
    expect(text()).toContain("Fill in every text slot.");
    expect(text()).not.toContain("Who gets it");
  });

  it("needs someone picked before it goes on", async () => {
    await render();
    await throughSlots();
    await click(button("Next"));
    expect(text()).toContain("Pick at least one student.");
    await click(radio("A class"));
    await click(button("Next"));
    expect(text()).toContain("Pick a class.");
  });

  it("shows the preview's count, parts, price, samples and who is skipped — before anything is sent", async () => {
    await render();
    await throughSlots();
    await click(radio("Debtors"));
    await click(button("Next"));
    await click(button("Preview"));
    expect(preview.mock.calls[0][0]).toMatchObject({ audience: "debtors", audience_ids: [], scheduled_at: null });
    expect(text()).toContain("2 recipients");
    expect(text()).toContain("2 SMS parts");
    expect(text()).toContain(money(340));
    expect(text()).toContain("Ertaga Mock imtihon soat 10 da.");
    expect(text()).toContain("No phone in lc-up · 1");
    expect(text()).toContain("Sardor Rasulov");
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses to send over the limit", async () => {
    preview.mockImplementation((_d: unknown, opts: { onSuccess: (p: CampaignPreview) => void }) =>
      opts.onSuccess(previewOf({ count: 301, over_limit: true, cost: 51170, parts_total: 301 })),
    );
    await render();
    await throughSlots();
    await click(radio("Debtors"));
    await click(button("Next"));
    await click(button("Preview"));
    expect(text()).toContain("More than 300 recipients (301)");
    expect(button("Send to 301").disabled).toBe(true);
  });

  it("asks with the count and the price, then posts exactly the previewed draft", async () => {
    await render();
    await throughSlots();
    await setValue(controlOf("Find a student"), "ka");
    await click(buttons().find((b) => b.getAttribute("aria-label") === "Add Malika Karimova")!);
    await click(buttons().find((b) => b.getAttribute("aria-label") === "Add Bekzod Aliyev")!);
    expect(text()).toContain("2 picked");
    await click(button("Next"));

    await click(radio("At a set time"));
    const at = toLocalInput(new Date(Date.now() + 3 * 86_400_000).toISOString());
    await setValue(controlOf("Goes out at"), at);
    await click(button("Preview"));

    const draft = {
      template_id: 70001,
      slot_roles: ["text", "text"],
      slot_texts: ["Mock imtihon", "10"],
      audience: "student",
      audience_ids: [5, 9],
      scheduled_at: fromLocalInput(at),
    };
    expect(preview.mock.calls[0][0]).toEqual(draft);

    await click(button("Schedule for 2"));
    expect(String(confirmSpy.mock.calls[0][0])).toBe(
      `Schedule template #70001 to 2 students for ${dateTime(fromLocalInput(at))}: 2 SMS (~${money(340)})?`,
    );
    expect(create.mock.calls[0][0]).toEqual(draft);
  });

  it("sends nothing when the question is declined", async () => {
    confirmSpy.mockReturnValue(false);
    await render();
    await throughSlots();
    await click(radio("Debtors"));
    await click(button("Next"));
    await click(button("Preview"));
    await click(button("Send to 2"));
    expect(String(confirmSpy.mock.calls[0][0])).toBe(`Send template #70001 to Debtors now: 2 SMS (~${money(340)})?`);
    expect(create).not.toHaveBeenCalled();
  });

  it("names the class in the question", async () => {
    await render();
    await throughSlots();
    await click(radio("A class"));
    await setValue(controlOf("Class"), "61");
    await click(button("Next"));
    await click(button("Preview"));
    await click(button("Send to 2"));
    expect(String(confirmSpy.mock.calls[0][0])).toBe(
      `Send template #70001 to Group: Junior G21 | Math now: 2 SMS (~${money(340)})?`,
    );
  });

  it("will not go back while the preview is on its way", async () => {
    previewPending = true;
    preview.mockReset();
    await render();
    await throughSlots();
    await click(radio("Debtors"));
    await click(button("Next"));
    expect(button("Back").disabled).toBe(true);
  });

  it("ignores a preview of a draft that changed while it was on its way", async () => {
    const pending: ((p: CampaignPreview) => void)[] = [];
    preview.mockReset().mockImplementation((_d: unknown, opts: { onSuccess: (p: CampaignPreview) => void }) =>
      pending.push(opts.onSuccess),
    );
    await render();
    await throughSlots();
    await click(radio("Debtors"));
    await click(button("Next"));
    await click(radio("At a set time"));
    await setValue(controlOf("Goes out at"), toLocalInput(new Date(Date.now() + 86_400_000).toISOString()));
    await click(button("Preview"));
    await setValue(controlOf("Goes out at"), toLocalInput(new Date(Date.now() + 2 * 86_400_000).toISOString()));
    await act(async () => pending[0](previewOf({ count: 99 })));
    expect(text()).not.toContain("99 recipients");
    expect(text()).toContain("Goes out at");

    await click(button("Preview"));
    await act(async () => pending[1](previewOf()));
    expect(text()).toContain("2 recipients");
  });

  it("says the template list did not load, with a retry, instead of offering none", async () => {
    templatesFailed = true;
    await render();
    expect(text()).toContain("The template list didn't load.");
    expect(text()).not.toContain("No usable template yet");
    await click(button("Try again"));
    expect(refetchTemplates).toHaveBeenCalled();
  });

  it("says the class list did not load, with a retry", async () => {
    classroomsFailed = true;
    await render();
    await throughSlots();
    await click(radio("A class"));
    expect(text()).toContain("The class list didn't load.");
    await click(button("Try again"));
    expect(refetchClassrooms).toHaveBeenCalled();
  });

  it("warns that it may have gone out when the create got no answer", async () => {
    create.mockImplementationOnce((_d: unknown, opts: { onError: (e: unknown) => void }) =>
      opts.onError(new Error("timeout of 30000ms exceeded")),
    );
    await render();
    await throughSlots();
    await click(radio("Debtors"));
    await click(button("Next"));
    await click(button("Preview"));
    await click(button("Send to 2"));
    expect(text()).toContain("The server may already have sent this — check the list before trying again.");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes with a notice once created, and shows the server's reason when refused", async () => {
    create.mockImplementationOnce((_d: unknown, opts: { onSuccess: (c: unknown) => void }) =>
      opts.onSuccess({ id: 9, status: "SCHEDULED" }),
    );
    await render();
    await throughSlots();
    await click(radio("Debtors"));
    await click(button("Next"));
    await click(button("Preview"));
    await click(button("Send to 2"));
    expect(toast).toHaveBeenCalledWith({ tone: "success", message: "Campaign #9 is sending now." });
    expect(onClose).toHaveBeenCalled();

    create.mockImplementationOnce((_d: unknown, opts: { onError: (e: unknown) => void }) =>
      opts.onError({ response: { data: { code: "empty", detail: "Nobody would receive it." } } }),
    );
    await click(button("Send to 2"));
    expect(text()).toContain("Nobody would receive it.");
  });
});
