/**
 * The phone step for a student with several same-name accounts (backend/lcup/phone_confirm.py). The
 * server lists "lcup_phone" while the account is asked; the gate asks it after a first password and
 * before names, sends it to lc-up's claim endpoint, and shows the server's hint when the number is
 * not the one the administrator holds. A namesake can say it is not them.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const confirmPhone = vi.fn();
const notMe = vi.fn();
const setInitialPassword = vi.fn();

vi.mock("@/features/lcup/lcupApi", () => ({
  lcupApi: {
    confirmPhone: (...args: unknown[]) => confirmPhone(...args),
    notMe: (...args: unknown[]) => notMe(...args),
    setInitialPassword: (...args: unknown[]) => setInitialPassword(...args),
  },
}));
vi.mock("@/hooks/useMe", () => ({ invalidateMe: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/api", () => ({
  authApi: { requestEmailCode: vi.fn(), confirmEmailCode: vi.fn(), logout: vi.fn() },
  usersApi: { patchMe: vi.fn() },
}));

const { ProfileCompletionGate } = await import("../ProfileCompletionGate");

const CURRENT = { first_name: "Aziz", last_name: "Tursunov", username: "aziz_used", email: "" };

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  confirmPhone.mockReset().mockResolvedValue({ moved: true });
  notMe.mockReset().mockResolvedValue(undefined);
  setInitialPassword.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function mount(missingFields: string[]) {
  const client = new QueryClient();
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <ProfileCompletionGate missingFields={missingFields} current={CURRENT} />
      </QueryClientProvider>,
    );
  });
}

async function type(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);
  expect(found, `button "${label}"`).toBeDefined();
  return found as HTMLButtonElement;
}

function phoneInput(): HTMLInputElement {
  const input = document.body.querySelector<HTMLInputElement>('input[type="tel"]');
  expect(input, "phone input").not.toBeNull();
  return input as HTMLInputElement;
}

describe("ProfileCompletionGate — the phone for same-name accounts", () => {
  it("asks for the number given to the administrator, sends it, then moves on", async () => {
    await mount(["lcup_phone", "email"]);
    expect(document.body.textContent).toContain("administratorga bergan raqamingizni");

    await type(phoneInput(), "+998 90 123 45 67");
    await act(async () => button("Tasdiqlash").click());

    expect(confirmPhone).toHaveBeenCalledWith("+998 90 123 45 67");
    expect(document.body.textContent).toContain("Confirm your email");
  });

  it("shows the server's hint when the number is not the administrator's", async () => {
    confirmPhone.mockRejectedValue({
      response: {
        status: 400,
        data: { phone: ["Bu raqam administratordagi raqamga mos kelmadi. Administratordagi raqam ••67 bilan tugaydi."], hint: "67" },
      },
    });
    await mount(["lcup_phone"]);
    await type(phoneInput(), "+998 99 000 00 00");
    await act(async () => button("Tasdiqlash").click());

    expect(document.body.textContent).toContain("••67 bilan tugaydi");
    expect(phoneInput()).toBeTruthy(); // still on the phone step
  });

  it("does not send an empty number", async () => {
    await mount(["lcup_phone"]);
    await act(async () => button("Tasdiqlash").click());
    expect(confirmPhone).not.toHaveBeenCalled();
  });

  it("lets a namesake say it is not them", async () => {
    await mount(["lcup_phone"]);
    await act(async () => button("Bu men emasman").click());
    expect(notMe).toHaveBeenCalled();
    expect(confirmPhone).not.toHaveBeenCalled();
  });

  it("asks for a first password before the phone", async () => {
    await mount(["password", "lcup_phone"]);
    expect(document.body.textContent).toContain("Choose your password");

    const [first, second] = Array.from(document.body.querySelectorAll<HTMLInputElement>('input[type="password"]'));
    await type(first, "Kitob-va-Qalam-2026");
    await type(second, "Kitob-va-Qalam-2026");
    await act(async () => button("Save password").click());

    expect(document.body.textContent).toContain("administratorga bergan raqamingizni");
  });

  it("is not asked when the server does not list it", async () => {
    await mount(["email"]);
    expect(document.body.querySelector('input[type="tel"]')).toBeNull();
  });
});
