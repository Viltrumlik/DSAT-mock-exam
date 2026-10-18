import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { money, todayInTashkent } from "../format";
import type { DebtPreview, SmsSettings } from "../smsApi";
import { EVENT_TEMPLATE, LAST_DAY_TEMPLATE, REJECTED_TEMPLATE, template } from "./fixtures";

/**
 * The debt warning's knobs. Worth pinning: Save sends only what changed (a template id with its
 * slots), turning it off asks first, the server's master switch is named when it holds the
 * warning off, and "Send now" exists only on a warning day and asks with the count and the price.
 */

const update = vi.fn();
const sendNow = vi.fn();
const confirmSpy = vi.fn();
let settings: SmsSettings;
let preview: DebtPreview;

vi.mock("@/features/ops/sms/smsHooks", () => ({
  useSmsSettings: () => ({ data: settings, isPending: false, isError: false, refetch: vi.fn() }),
  useSmsTemplates: () => ({
    data: { templates: [template(), LAST_DAY_TEMPLATE, EVENT_TEMPLATE, REJECTED_TEMPLATE], synced_at: null },
    isPending: false,
    isError: false,
  }),
  useUpdateSmsSettings: () => ({ mutate: update, isPending: false }),
  useDebtPreview: () => ({ data: preview, isPending: false, isError: false, refetch: vi.fn() }),
  useDebtSendNow: () => ({ mutate: sendNow, isPending: false }),
  useDebtRuns: () => ({
    data: [{ run_on: "2026-10-01", total: 12, by_status: { DELIVERED: 11, UNDELIVERED: 1 }, parts: 12, cost: 2040 }],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

const { DebtPanel } = await import("@/features/ops/sms/DebtPanel");

function settingsOf(over: Partial<SmsSettings> = {}): SmsSettings {
  return {
    debt_enabled: true,
    debt_hour: 10,
    warning_template_id: 64942,
    warning_pattern: template().pattern,
    warning_slots: ["student"],
    last_day_template_id: 52393,
    last_day_pattern: LAST_DAY_TEMPLATE.pattern,
    last_day_slots: ["student"],
    updated_at: null,
    updated_by_name: "",
    env_enabled: true,
    freeze_enabled: true,
    freeze_day: 6,
    ...over,
  };
}

function previewOf(over: Partial<DebtPreview> = {}): DebtPreview {
  return {
    day: "2099-11-01",
    is_last_day: false,
    blocked: "",
    skipped: { not_freezable: 22 },
    count: 2,
    cost: 340,
    warnings: [
      {
        lcup_student_id: 101, name: "Karimova Malika", phone: "998901234567", debt: 150000,
        text: "MASTER SAT'dan yozyabmiz. Karimova Malika, sizda qarzdorlik mavjud.", parts: 1,
      },
    ],
    ...over,
  };
}

let container: HTMLDivElement;
let root: Root;
const text = () => document.body.textContent ?? "";
const button = (label: string) =>
  Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);
const controlOf = (label: string) =>
  Array.from(document.body.querySelectorAll("label")).find((l) => l.textContent?.trim().startsWith(label))!.control as
    | HTMLInputElement
    | HTMLSelectElement;
const theSwitch = () => document.body.querySelector<HTMLButtonElement>('[role="switch"]')!;

async function setValue(el: HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<DebtPanel />));
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  confirmSpy.mockReset().mockReturnValue(true);
  vi.stubGlobal("confirm", confirmSpy);
  update.mockReset();
  sendNow.mockReset();
  settings = settingsOf();
  preview = previewOf();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("DebtPanel — settings", () => {
  it("shows the live settings: on, 10:00, #64942 for days 1–4 and #52393 for day 5", async () => {
    await render();
    expect(theSwitch().getAttribute("aria-checked")).toBe("true");
    expect(controlOf("Send at").value).toBe("10");
    expect(controlOf("Days 1–4").value).toBe("64942");
    expect(controlOf("Day 5").value).toBe("52393");
    expect(text()).toContain("MASTER SAT'dan yozyabmiz. Test Testov, sizda");
  });

  it("offers the hours 08 to 20 and only usable templates", async () => {
    await render();
    const hours = Array.from(controlOf("Send at").querySelectorAll("option")).map((o) => o.textContent);
    expect(hours[0]).toBe("08:00");
    expect(hours[hours.length - 1]).toBe("20:00");
    expect(hours).toHaveLength(13);
    const ids = Array.from(controlOf("Days 1–4").querySelectorAll("option")).map((o) => o.value);
    expect(ids).not.toContain("50000");
  });

  it("saves only what changed", async () => {
    await render();
    await setValue(controlOf("Send at") as HTMLSelectElement, "9");
    await act(async () => button("Save")!.click());
    expect(update.mock.calls[0][0]).toEqual({ debt_hour: 9 });
  });

  it("sends a new template with its slots", async () => {
    await render();
    await setValue(controlOf("Day 5") as HTMLSelectElement, "70001");
    // A number slot can only be the debt; the word slot defaults to the student.
    await act(async () => button("Save")!.click());
    expect(update.mock.calls[0][0]).toEqual({ last_day_template_id: 70001, last_day_slots: ["student", "debt"] });
  });

  it("asks before turning the warning off, and sends nothing when declined", async () => {
    await render();
    await act(async () => theSwitch().click());
    confirmSpy.mockReturnValueOnce(false);
    await act(async () => button("Save")!.click());
    expect(update).not.toHaveBeenCalled();
    await act(async () => button("Save")!.click());
    expect(String(confirmSpy.mock.calls[0][0])).toContain("Turn the debt warning off?");
    expect(update.mock.calls[0][0]).toEqual({ debt_enabled: false });
  });

  it("names the server's master switch when it holds the warning off, and locks the switch", async () => {
    settings = settingsOf({ env_enabled: false });
    await render();
    expect(text()).toContain("The server's master switch (SMS_DEBT_WARNINGS_ENABLED) is off");
    expect(theSwitch().disabled).toBe(true);
  });

  it("shows the server's reason when a save is refused", async () => {
    update.mockImplementation((_p: unknown, opts: { onError: (e: unknown) => void }) =>
      opts.onError({ response: { data: { code: "template", detail: "That template is not usable." } } }),
    );
    await render();
    await setValue(controlOf("Send at") as HTMLSelectElement, "11");
    await act(async () => button("Save")!.click());
    expect(text()).toContain("That template is not usable.");
  });
});

describe("DebtPanel — the next warning day and the history", () => {
  it("lists who would get the next warning, who is left out, and the past runs", async () => {
    await render();
    expect(text()).toContain("1 Nov 2099");
    expect(text()).toContain("2 students");
    expect(text()).toContain(money(340));
    expect(text()).toContain("Karimova Malika");
    expect(text()).toContain(money(150000));
    expect(text()).toContain("not freezable: 22");
    expect(text()).toContain("1 Oct 2026");
    expect(text()).toContain(money(2040));
  });

  it("has no Send now on a day that is not a warning day", async () => {
    await render();
    expect(button("Send now")).toBeUndefined();
  });

  it("offers Send now on a warning day, asking with the count and the price", async () => {
    preview = previewOf({ day: todayInTashkent() });
    sendNow.mockImplementation((_v: unknown, opts: { onSuccess: () => void }) => opts.onSuccess());
    await render();
    await act(async () => button("Send now")!.click());
    expect(String(confirmSpy.mock.calls[0][0])).toContain(`now to 2 students (~${money(340)})?`);
    expect(sendNow).toHaveBeenCalled();
    expect(text()).toContain("Queued");
  });

  it("will not send now while the warning is off", async () => {
    preview = previewOf({ day: todayInTashkent() });
    settings = settingsOf({ debt_enabled: false });
    await render();
    expect(button("Send now")!.disabled).toBe(true);
  });

  it("says why nothing would go out when the day is blocked", async () => {
    preview = previewOf({ blocked: "The lc-up debt freeze is off.", count: 0, cost: 0, warnings: [] });
    await render();
    expect(text()).toContain("The lc-up debt freeze is off.");
  });
});
