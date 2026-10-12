/**
 * The first-password step for an account the lc-up sync created. The server lists "password"
 * first in `missing_fields` until one is chosen; the gate must ask for it before anything else,
 * send it to lc-up's claim endpoint, and then carry on with the ordinary steps.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setInitialPassword = vi.fn();

vi.mock("@/features/lcup/lcupApi", () => ({
  lcupApi: { setInitialPassword: (...args: unknown[]) => setInitialPassword(...args) },
}));
vi.mock("@/hooks/useMe", () => ({ invalidateMe: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/api", () => ({
  authApi: { requestEmailCode: vi.fn(), confirmEmailCode: vi.fn(), logout: vi.fn() },
  usersApi: { patchMe: vi.fn() },
}));

const { ProfileCompletionGate } = await import("../ProfileCompletionGate");

const CURRENT = { first_name: "Malika", last_name: "Karimova", username: "998901234567", email: "" };

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
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

describe("ProfileCompletionGate — first password", () => {
  it("asks for the password first, sends it, then moves on", async () => {
    await mount(["password", "email"]);
    expect(document.body.textContent).toContain("Choose your password");

    const [first, second] = Array.from(document.body.querySelectorAll<HTMLInputElement>('input[type="password"]'));
    await type(first, "Kitob-va-Qalam-2026");
    await type(second, "Kitob-va-Qalam-2026");
    await act(async () => button("Save password").click());

    expect(setInitialPassword).toHaveBeenCalledWith("Kitob-va-Qalam-2026");
    expect(document.body.textContent).toContain("Confirm your email");
  });

  it("refuses two different passwords without calling the server", async () => {
    await mount(["password"]);
    const [first, second] = Array.from(document.body.querySelectorAll<HTMLInputElement>('input[type="password"]'));
    await type(first, "Kitob-va-Qalam-2026");
    await type(second, "Kitob-va-Qalam-2025");
    await act(async () => button("Save password").click());
    expect(setInitialPassword).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("The two passwords are different.");
  });

  it("does not ask for a password when the server does not", async () => {
    await mount(["email"]);
    expect(document.body.textContent).not.toContain("Choose your password");
  });

  it("explains that a phone-number username is how they sign in", async () => {
    await mount(["first_name"]);
    expect(document.body.textContent).toContain("You sign in with this phone number");
  });
});
