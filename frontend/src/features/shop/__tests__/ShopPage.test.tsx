/**
 * The shop's four branches, one tab per currency, and the copy rule.
 *
 * The learning center's rule is that student-facing copy never punishes: the shop says what
 * is still needed — "2 more strikes and it's yours" — and never that they cannot afford
 * something. That is the assertion most likely to be undone by a well-meaning edit, so it is
 * pinned both ways: the helpful sentence present, and the refusal absent.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ShopItem, Storefront } from "../shopApi";

const useStorefront = vi.fn();
const useMyOrders = vi.fn();
const usePurchase = vi.fn();
const pushToast = vi.fn();

vi.mock("../shopHooks", () => ({
  useStorefront: (...a: unknown[]) => useStorefront(...a),
  useMyOrders: (...a: unknown[]) => useMyOrders(...a),
  usePurchase: (...a: unknown[]) => usePurchase(...a),
}));

vi.mock("@/components/ToastProvider", () => ({
  useToast: () => ({ push: pushToast }),
}));

const { ShopPage } = await import("../ShopPage");

function item(over: Partial<ShopItem> = {}): ShopItem {
  return {
    id: 1, name: "MasterSAT notebook", description: "A5, squared.",
    image_url: null, currency: "COIN", currency_label: "Coins",
    price: 3, stock: 12, in_stock: true, is_active: true, sort_order: 0,
    affordable: true, short_by: 0, ...over,
  };
}

const STORE: Storefront = {
  coins: 14, convertible_coins: 0, strikes: 6, current_streak: 6, best_streak: 6,
  coin_items: [item()],
  strike_items: [item({ id: 2, name: "Front-row seat", currency: "STRIKE", price: 10 })],
};

function query(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined, isPending: false, isError: false,
    refetch: vi.fn(), ...overrides,
  };
}

let host: HTMLElement;
let root: Root;

async function render() {
  await act(async () => root.render(<ShopPage />));
}

function tab(label: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((b) =>
    b.textContent?.includes(label),
  );
  if (!found) throw new Error(`no tab "${label}"`);
  return found;
}

async function openTab(label: string) {
  await act(async () => tab(label).click());
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  useMyOrders.mockReturnValue(query({ data: [] }));
  usePurchase.mockReturnValue({ mutate: vi.fn(), isPending: false });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

describe("ShopPage", () => {
  it("shows both balances, with the run under the strikes", async () => {
    // Deliberately different: the spendable balance and the run part company the moment a
    // student buys something, and only the run belongs on the detail line.
    useStorefront.mockReturnValue(query({ data: { ...STORE, strikes: 2, current_streak: 6 } }));
    await render();

    expect(host.textContent).toContain("Coins");
    expect(host.textContent).toContain("Strikes");
    expect(host.textContent).toContain("14");
    expect(host.textContent).toContain("6 lessons in a row");
    // A strike, not a streak — the dashboard and the profile were corrected to this already.
    expect(host.textContent?.toLowerCase()).not.toContain("streak");
  });

  it("puts each currency on its own tab, the coin shop first", async () => {
    useStorefront.mockReturnValue(query({ data: STORE }));
    await render();

    expect(tab("Coin shop").getAttribute("aria-selected")).toBe("true");
    expect(host.textContent).toContain("MasterSAT notebook");
    expect(host.textContent).not.toContain("Front-row seat");

    await openTab("Strike shop");

    expect(tab("Strike shop").getAttribute("aria-selected")).toBe("true");
    expect(host.textContent).toContain("Front-row seat");
    expect(host.textContent).not.toContain("MasterSAT notebook");
  });

  it("counts each shelf on its tab", async () => {
    useStorefront.mockReturnValue(query({
      data: { ...STORE, coin_items: [item(), item({ id: 3, name: "Pen" })] },
    }));
    await render();

    expect(tab("Coin shop").textContent).toContain("2");
    expect(tab("Strike shop").textContent).toContain("1");
  });

  it("opens on the strike shop when only the strike shop is stocked", async () => {
    useStorefront.mockReturnValue(query({ data: { ...STORE, coin_items: [] } }));
    await render();

    expect(tab("Strike shop").getAttribute("aria-selected")).toBe("true");
    expect(host.textContent).toContain("Front-row seat");
    expect(host.textContent).not.toContain("Nothing here yet");
  });

  it("says what is still needed rather than refusing", async () => {
    useStorefront.mockReturnValue(query({
      data: {
        ...STORE,
        strike_items: [item({
          id: 2, name: "Front-row seat", currency: "STRIKE", price: 10,
          affordable: false, short_by: 4,
        })],
      },
    }));
    await render();
    await openTab("Strike shop");

    expect(host.textContent).toContain("4 more strikes and it's yours");
    expect(host.textContent?.toLowerCase()).not.toContain("afford");
  });

  it("uses the singular when one short", async () => {
    useStorefront.mockReturnValue(query({
      data: { ...STORE, coin_items: [item({ affordable: false, short_by: 1 })], strike_items: [] },
    }));
    await render();

    expect(host.textContent).toContain("1 more coin and it's yours");
  });

  it("marks a sold-out item as out of stock, not as unaffordable", async () => {
    useStorefront.mockReturnValue(query({
      data: {
        ...STORE,
        coin_items: [item({ in_stock: false, stock: 0, affordable: false, short_by: 0 })],
        strike_items: [],
      },
    }));
    await render();

    expect(host.textContent).toContain("Out of stock");
    expect(host.textContent).not.toContain("more coin");
  });

  it("shows a failure as an error, never as an empty shop", async () => {
    useStorefront.mockReturnValue(query({ isError: true }));
    await render();

    expect(host.textContent).toContain("isn't loading");
    expect(host.textContent).not.toContain("Nothing here yet");
  });

  it("shows an unstocked shelf as empty", async () => {
    useStorefront.mockReturnValue(query({
      data: { ...STORE, coin_items: [], strike_items: [] },
    }));
    await render();

    expect(host.textContent).toContain("Nothing here yet");
    expect(host.textContent).not.toContain("isn't loading");
  });

  it("tells the student when they have points left to convert", async () => {
    useStorefront.mockReturnValue(query({ data: { ...STORE, convertible_coins: 3 } }));
    await render();

    expect(host.textContent).toContain("3 more to convert");
  });

  it("answers a purchase in a toast, telling success and failure apart", async () => {
    const mutate = vi.fn();
    usePurchase.mockReturnValue({ mutate, isPending: false });
    useStorefront.mockReturnValue(query({ data: STORE }));
    await render();

    const buy = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Buy");
    await act(async () => buy?.click());
    expect(mutate).toHaveBeenCalledWith(1, expect.any(Object));

    const { onSuccess, onError } = mutate.mock.calls[0][1];
    onSuccess({ detail: "Ordered. Collect your MasterSAT notebook from the desk." });
    expect(pushToast).toHaveBeenLastCalledWith({
      tone: "success",
      message: "Ordered. Collect your MasterSAT notebook from the desk.",
    });

    // It used to be printed under the same green tick as a success.
    onError({ response: { data: { detail: "That one is out of stock." } } });
    expect(pushToast).toHaveBeenLastCalledWith({ tone: "error", message: "That one is out of stock." });
  });

  it("lists the student's own orders when they have some", async () => {
    useStorefront.mockReturnValue(query({ data: STORE }));
    useMyOrders.mockReturnValue(query({
      data: [{
        id: 5, student: 1, student_name: "Aziza", item: 1, item_name: "MasterSAT notebook",
        image_url: null, currency: "COIN" as const, price: 1,
        status: "PENDING" as const, status_label: "Waiting to be handed over",
        note: "", created_at: new Date().toISOString(), settled_at: null,
      }],
    }));
    await render();

    expect(host.textContent).toContain("Your orders");
    expect(host.textContent).toContain("Waiting to be handed over");
    expect(host.textContent).toContain("1 coin");
    expect(host.textContent).not.toContain("1 coins");
  });
});
