/**
 * The frozen screen says why. Frozen for an unpaid month (lc-up's debt freeze): what is owed and that
 * paying at the centre unlocks it by itself. Frozen by an administrator: the old words, unchanged.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mine = vi.fn();

vi.mock("@/features/finance/financeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/finance/financeApi")>()),
  financeApi: { mine: (...args: unknown[]) => mine(...args) },
}));
vi.mock("@/lib/api", () => ({ default: { get: vi.fn() }, authApi: { logout: vi.fn() } }));

const { FrozenOverlay } = await import("../FrozenOverlay");

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  mine.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <FrozenOverlay />
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const DEBT = {
  linked: true, balance: -250000, debt: 250000, updated_at: null, frozen_for_debt: true, freeze_day: 6,
  monthly_cost: 500000, groups: [], payments: [],
};

describe("FrozenOverlay — why the account is frozen", () => {
  it("frozen for an unpaid month: the amount owed and how it ends", async () => {
    mine.mockResolvedValue(DEBT);
    await mount();
    const text = host.textContent ?? "";
    expect(text).toContain("This month’s payment hasn’t been made");
    expect(text).toContain("You owe 250,000 UZS");
    expect(text).toContain("unlocks by itself within 15 minutes");
    expect(text).not.toContain("by an administrator");
  });

  it("frozen by an administrator: the administrator's words, no amount", async () => {
    mine.mockResolvedValue({ ...DEBT, frozen_for_debt: false });
    await mount();
    const text = host.textContent ?? "";
    expect(text).toContain("frozen by an administrator");
    expect(text).not.toContain("UZS");
  });

  it("an account lc-up does not know, or a failed read, falls back to the administrator's words", async () => {
    mine.mockResolvedValue({ linked: false });
    await mount();
    expect(host.textContent).toContain("frozen by an administrator");
    mine.mockRejectedValue(new Error("down"));
    await mount();
    expect(host.textContent).toContain("frozen by an administrator");
  });
});
