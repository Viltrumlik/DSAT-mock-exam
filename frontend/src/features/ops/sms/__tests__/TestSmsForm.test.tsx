import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { money } from "../format";
import type { EskizTemplate } from "../smsApi";

/**
 * A test SMS is a real, paid SMS to a typed number. Worth pinning: it refuses a number eskiz
 * would refuse, it names the number and the price before sending, and it posts exactly the
 * contract's body.
 */

const mutate = vi.fn();
const confirmSpy = vi.fn();

function template(over: Partial<EskizTemplate> = {}): EskizTemplate {
  return {
    eskiz_id: 64942,
    status: "service",
    pattern:
      "MASTER SAT'dan yozyabmiz. %w{1,4} sizda qarzdorlik mavjud. To'lovni amalga oshirish uchun zudlik bilan administratsiyaga uchrang!",
    original: "MASTER SAT'dan yozyabmiz. (STUDENT), sizda qarzdorlik mavjud.",
    slots: [{ kind: "w", min: 1, max: 4 }],
    guessed_roles: ["student"],
    parts: 1,
    ascii: true,
    usable: true,
    synced_at: "2026-10-18T09:00:00+05:00",
    submitted_by_name: "",
    submitted_at: null,
    ...over,
  };
}

const TEMPLATES = [
  template(),
  template({
    eskiz_id: 70001,
    pattern: "Ertaga %w{1,3} soat %d da.",
    original: "Ertaga (EVENT) soat (TIME) da.",
    slots: [{ kind: "w", min: 1, max: 3 }, { kind: "d", min: 1, max: 1 }],
    guessed_roles: ["text", "text"],
  }),
  template({ eskiz_id: 50000, status: "rejected", usable: false, original: "Rad etilgan" }),
];

vi.mock("@/features/ops/sms/smsHooks", () => ({
  useSmsTemplates: () => ({ data: { templates: TEMPLATES, synced_at: null }, isPending: false, isError: false }),
  useSendTestSms: () => ({ mutate, isPending: false }),
}));

const { TestSmsForm } = await import("@/features/ops/sms/TestSmsForm");

let container: HTMLDivElement;
let root: Root;
const text = () => document.body.textContent ?? "";
const button = (label: string) =>
  Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim() === label)!;
const controlOf = (label: string) =>
  Array.from(document.body.querySelectorAll("label")).find((l) => l.textContent?.trim().startsWith(label))!.control as
    | HTMLInputElement
    | HTMLSelectElement;

async function setValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<TestSmsForm pricePerPart={170} />));
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  confirmSpy.mockReset().mockReturnValue(true);
  vi.stubGlobal("confirm", confirmSpy);
  mutate.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("TestSmsForm", () => {
  it("offers only the usable templates", async () => {
    await render();
    const options = Array.from(controlOf("Template").querySelectorAll("option")).map((o) => o.value);
    expect(options).toEqual(["64942", "70001"]);
  });

  it("refuses a number that is not an Uzbek mobile, before asking anything", async () => {
    await render();
    await setValue(controlOf("Phone") as HTMLInputElement, "12345");
    await act(async () => button("Send test SMS").click());
    expect(text()).toContain("Enter an Uzbek mobile number: 998 and 9 digits.");
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("asks with the number and the price, then posts the contract's body", async () => {
    await render();
    await setValue(controlOf("Phone") as HTMLInputElement, "+998 88 003-25-08");
    expect(text()).toContain("MASTER SAT'dan yozyabmiz. Test Testov, sizda");
    await act(async () => button("Send test SMS").click());
    expect(confirmSpy).toHaveBeenCalledWith(`Send 1 SMS (~${money(170)}) to 998880032508 with template #64942?`);
    expect(mutate.mock.calls[0][0]).toEqual({ phone: "998880032508", template_id: 64942, slot_texts: [""] });
  });

  it("sends nothing when the question is declined", async () => {
    confirmSpy.mockReturnValue(false);
    await render();
    await setValue(controlOf("Phone") as HTMLInputElement, "998880032508");
    await act(async () => button("Send test SMS").click());
    expect(mutate).not.toHaveBeenCalled();
  });

  it("asks for each text slot, refuses an empty one, and sends the typed words", async () => {
    await render();
    await setValue(controlOf("Template") as HTMLSelectElement, "70001");
    await setValue(controlOf("Phone") as HTMLInputElement, "901234567");
    await act(async () => button("Send test SMS").click());
    expect(text()).toContain("Fill in every text slot.");
    expect(mutate).not.toHaveBeenCalled();

    await setValue(controlOf("Slot 1") as HTMLInputElement, "Mock imtihon");
    await setValue(controlOf("Slot 2") as HTMLInputElement, "10");
    expect(text()).toContain("Ertaga Mock imtihon soat 10 da.");
    await act(async () => button("Send test SMS").click());
    expect(mutate.mock.calls[0][0]).toEqual({
      phone: "998901234567",
      template_id: 70001,
      slot_texts: ["Mock imtihon", "10"],
    });
  });

  it("says what eskiz did with it", async () => {
    mutate.mockImplementation((_body: unknown, opts: { onSuccess: (m: unknown) => void }) =>
      opts.onSuccess({ id: 3, phone: "998880032508", status: "SENT", error: "" }),
    );
    await render();
    await setValue(controlOf("Phone") as HTMLInputElement, "998880032508");
    await act(async () => button("Send test SMS").click());
    expect(text()).toContain("Test SMS to 998880032508: Sent.");
  });

  it("shows the server's reason when it refuses", async () => {
    mutate.mockImplementation((_body: unknown, opts: { onError: (e: unknown) => void }) =>
      opts.onError({ response: { data: { code: "not_configured", detail: "eskiz is not configured." } } }),
    );
    await render();
    await setValue(controlOf("Phone") as HTMLInputElement, "998880032508");
    await act(async () => button("Send test SMS").click());
    expect(text()).toContain("eskiz is not configured.");
  });
});
