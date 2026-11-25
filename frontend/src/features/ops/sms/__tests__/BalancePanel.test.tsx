import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The console reads permissions (plan 2026-11-12-crm-roles): an administrator's.
vi.mock("@/hooks/useMe", async (importOriginal) => {
  const { ADMIN_ME: me } = await import("@/features/ops/testing/me");
  return { ...(await importOriginal<typeof import("@/hooks/useMe")>()), useMe: () => ({ me }) };
});
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { money } from "../format";
import type { BalancePreview, SmsSettings } from "../smsApi";
import { template } from "./fixtures";

/**
 * The balance SMS's knobs. Worth pinning: it starts off with no template, Save sends only what changed (a template
 * id with its slots), turning it on and off asks first, the server's master switch is named when it holds the SMS
 * off, and "Send now" asks with the count and the price and is dead while the list is blocked.
 */

const update = vi.fn();
const sendNow = vi.fn();
const confirmSpy = vi.fn();
const previewCalls = vi.fn();
let settings: SmsSettings;
let preview: BalancePreview;

const LOW = template({
  eskiz_id: 91001,
  pattern: "MASTER SAT: %w{1,4} hisobingizda %w{1,3} so'm qoldi.",
  original: "MASTER SAT: (STUDENT), hisobingizda (SUM) so'm qoldi.",
  slots: [{ kind: "w", min: 1, max: 4 }, { kind: "w", min: 1, max: 3 }],
  guessed_roles: ["student", "text"],
});
const FROZEN = template({
  eskiz_id: 91002,
  pattern: "MASTER SAT: %w{1,4} hisobingiz minusga tushdi.",
  original: "MASTER SAT: (STUDENT), hisobingiz minusga tushdi.",
  slots: [{ kind: "w", min: 1, max: 4 }],
  guessed_roles: ["student"],
});

vi.mock("@/features/ops/sms/smsHooks", () => ({
  useSmsSettings: () => ({ data: settings, isPending: false, isError: false, refetch: vi.fn() }),
  useSmsTemplates: () => ({ data: { templates: [LOW, FROZEN], synced_at: null }, isPending: false, isError: false, refetch: vi.fn() }),
  useUpdateSmsSettings: () => ({ mutate: update, isPending: false }),
  useBalancePreview: (...args: unknown[]) => {
    previewCalls(...args);
    return { data: preview, isPending: false, isError: false, refetch: vi.fn() };
  },
  useBalanceSendNow: () => ({ mutate: sendNow, isPending: false }),
  DEBT_POLL_FOR_MS: 120_000,
}));

const { BalancePanel } = await import("@/features/ops/sms/BalancePanel");

function settingsOf(over: Partial<SmsSettings> = {}): SmsSettings {
  return {
    debt_enabled: true,
    debt_hour: 10,
    warning_template_id: 64942,
    warning_pattern: template().pattern,
    warning_slots: ["student"],
    last_day_template_id: 52393,
    last_day_pattern: template().pattern,
    last_day_slots: ["student"],
    updated_at: null,
    updated_by_name: "",
    env_enabled: true,
    freeze_enabled: true,
    freeze_day: 6,
    balance_enabled: false,
    balance_hour: 10,
    low_template_id: null,
    low_pattern: "",
    low_slots: [],
    frozen_template_id: null,
    frozen_pattern: "",
    frozen_slots: [],
    balance_env_enabled: true,
    balance_billing_ready: true,
    ...over,
  };
}

function previewOf(over: Partial<BalancePreview> = {}): BalancePreview {
  return {
    day: "2026-11-25",
    blocked: "",
    skipped: { no_phone: 1 },
    count: 2,
    cost: 340,
    low: [
      { name: "Testov Ali", phone: "998901112233", balance: 50000, text: "MASTER SAT: Testov Ali, hisobingizda 50 000 so'm qoldi.", parts: 1 },
    ],
    frozen: [
      { name: "Testov Vali", phone: "998901112244", balance: -5000, text: "MASTER SAT: Testov Vali, hisobingiz minusga tushdi.", parts: 1 },
    ],
    ...over,
  };
}

let container: HTMLDivElement;
let root: Root;
const text = () => document.body.textContent ?? "";
const buttons = () => Array.from(document.body.querySelectorAll("button"));
const button = (label: string) => buttons().find((b) => b.textContent?.trim() === label);
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
  await act(async () => root.render(<BalancePanel />));
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  confirmSpy.mockReset().mockReturnValue(true);
  vi.stubGlobal("confirm", confirmSpy);
  update.mockReset();
  sendNow.mockReset();
  previewCalls.mockReset();
  settings = settingsOf();
  preview = previewOf();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("BalancePanel — settings", () => {
  it("starts off, at 10:00, asking for both templates", async () => {
    await render();
    expect(theSwitch().getAttribute("aria-checked")).toBe("false");
    expect(controlOf("Send at").value).toBe("10");
    expect(controlOf("Low balance").value).toBe("");
    expect(controlOf("Frozen for debt").value).toBe("");
    expect(text()).toContain("Pick and save both templates below");
    expect(text()).toContain("Tashkent time, once a day.");
  });

  it("offers the hours 08 to 20 and only usable templates", async () => {
    await render();
    const hours = Array.from(controlOf("Send at").querySelectorAll("option")).map((o) => o.textContent);
    expect([hours[0], hours[hours.length - 1], hours.length]).toEqual(["08:00", "20:00", 13]);
    const ids = Array.from(controlOf("Low balance").querySelectorAll("option")).map((o) => o.value);
    expect(ids).toEqual(["", "91001", "91002"]);
  });

  it("saves a picked template with its slots: the student the server guessed, the rest the balance", async () => {
    await render();
    await setValue(controlOf("Low balance") as HTMLSelectElement, "91001");
    expect(text()).toContain("MASTER SAT: Test Testov, hisobingizda 77 000 so'm qoldi.");
    await act(async () => button("Save")!.click());
    expect(update.mock.calls[0][0]).toEqual({ low_template_id: 91001, low_slots: ["student", "balance"] });
  });

  it("saves only what changed", async () => {
    settings = settingsOf({
      low_template_id: 91001, low_pattern: LOW.pattern, low_slots: ["student", "balance"],
      frozen_template_id: 91002, frozen_pattern: FROZEN.pattern, frozen_slots: ["student"],
    });
    await render();
    await act(async () => button("Save")!.click());
    expect(update).not.toHaveBeenCalled();
    expect(text()).toContain("Nothing has changed.");
    await setValue(controlOf("Send at") as HTMLSelectElement, "14");
    await act(async () => button("Save")!.click());
    expect(update.mock.calls[0][0]).toEqual({ balance_hour: 14 });
  });

  it("asks before turning it on, and sends nothing when declined", async () => {
    await render();
    await act(async () => theSwitch().click());
    confirmSpy.mockReturnValueOnce(false);
    await act(async () => button("Save")!.click());
    expect(update).not.toHaveBeenCalled();
    await act(async () => button("Save")!.click());
    expect(String(confirmSpy.mock.calls[0][0])).toContain("Turn the balance SMS on?");
    expect(update.mock.calls[0][0]).toEqual({ balance_enabled: true });
  });

  it("asks before turning it off", async () => {
    settings = settingsOf({ balance_enabled: true });
    await render();
    await act(async () => theSwitch().click());
    await act(async () => button("Save")!.click());
    expect(String(confirmSpy.mock.calls[0][0])).toContain("Turn the balance SMS off?");
    expect(update.mock.calls[0][0]).toEqual({ balance_enabled: false });
  });

  it("names the server's master switch when it holds the SMS off, and locks the switch", async () => {
    settings = settingsOf({ balance_env_enabled: false });
    await render();
    expect(text()).toContain("The server's master switch (SMS_BALANCE_WARNINGS_ENABLED) is off");
    expect(theSwitch().disabled).toBe(true);
  });

  it("says when billing is not ready", async () => {
    settings = settingsOf({ balance_billing_ready: false });
    await render();
    expect(text()).toContain("ledger to be ours");
  });

  it("shows the server's reason when a save is refused", async () => {
    update.mockImplementation((_p: unknown, opts: { onError: (e: unknown) => void }) =>
      opts.onError({ response: { data: { code: "slots", detail: "Slot 2 cannot hold the balance." } } }),
    );
    await render();
    await setValue(controlOf("Send at") as HTMLSelectElement, "11");
    await act(async () => button("Save")!.click());
    expect(text()).toContain("Slot 2 cannot hold the balance.");
  });
});

describe("BalancePanel — today's list", () => {
  it("lists who would get what, and who is left out", async () => {
    await render();
    expect(text()).toContain("2 texts");
    expect(text()).toContain(money(340));
    expect(text()).toContain("Low balance · 1");
    expect(text()).toContain("Frozen for debt · 1");
    expect(text()).toContain("Testov Ali");
    expect(text()).toContain(money(50000));
    expect(text()).toContain("hisobingiz minusga tushdi");
    expect(text()).toContain("No phone in lc-up: 1");
  });

  it("asks before Send now, with the count and the price", async () => {
    sendNow.mockImplementation((_v: unknown, opts: { onSuccess: () => void }) => opts.onSuccess());
    await render();
    await act(async () => button("Send now to 2 families")!.click());
    expect(String(confirmSpy.mock.calls[0][0])).toContain(`now to 2 families (~${money(340)})?`);
    expect(sendNow).toHaveBeenCalled();
    expect(text()).toContain("Queued");
  });

  it("sends nothing when the confirmation is declined", async () => {
    confirmSpy.mockReturnValue(false);
    await render();
    await act(async () => button("Send now to 2 families")!.click());
    expect(sendNow).not.toHaveBeenCalled();
  });

  it("follows the run after Send now: the list is asked again for a while", async () => {
    sendNow.mockImplementation((_v: unknown, opts: { onSuccess: () => void }) => opts.onSuccess());
    await render();
    expect(previewCalls.mock.lastCall?.[0] ?? 0).toBe(0);
    const before = Date.now();
    await act(async () => button("Send now to 2 families")!.click());
    expect(Number(previewCalls.mock.lastCall?.[0])).toBeGreaterThanOrEqual(before + 120_000);
  });

  it("will not send now while blocked, and says why", async () => {
    preview = previewOf({ blocked: "the balance SMS is switched off in /ops/sms" });
    await render();
    expect(button("Send now to 2 families")!.disabled).toBe(true);
    expect(text()).toContain("the balance SMS is switched off in /ops/sms");
  });

  it("has nothing to send when nobody is low", async () => {
    preview = previewOf({ count: 0, cost: 0, low: [], frozen: [], skipped: {} });
    await render();
    expect(button("Send now to 0 families")!.disabled).toBe(true);
    expect(text()).toContain("Nobody would get a balance SMS right now.");
  });

  it("warns that it may have gone out when Send now got no answer", async () => {
    sendNow.mockImplementation((_v: unknown, opts: { onError: (e: unknown) => void }) => opts.onError(new Error("Network Error")));
    await render();
    await act(async () => button("Send now to 2 families")!.click());
    expect(text()).toContain("The server may already have sent this — check the list before trying again.");
  });
});
