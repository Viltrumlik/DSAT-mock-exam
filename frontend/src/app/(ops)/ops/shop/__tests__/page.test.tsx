/**
 * /ops/shop in the console's look: the collection queue (Handed over / Refund with the same calls) and the stock
 * (price, stock badge, Hidden), Add an item and Edit item in the console's dialog with the same bodies — JSON, or
 * FormData once a picture is attached — the server's words on a refusal, Delete with the same call, the empty
 * states, and failed loads that are never drawn as empty.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  storefront: vi.fn(),
  purchase: vi.fn(),
  myOrders: vi.fn(),
  adminItems: vi.fn(),
  createItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  adminOrders: vi.fn(),
  settleOrder: vi.fn(),
}));

vi.mock("@/features/shop/shopApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/shop/shopApi")>()),
  shopApi: api,
}));

const { default: Page } = await import("../page");

function item(id: number, over: Record<string, unknown> = {}) {
  return {
    id,
    name: `Item ${id}`,
    description: "",
    image_url: null,
    currency: "COIN",
    currency_label: "Coins",
    price: 50,
    stock: 20,
    in_stock: true,
    is_active: true,
    sort_order: 0,
    ...over,
  };
}
const ORDERS = [
  {
    id: 7,
    student: 3,
    student_name: "Aziza Karimova",
    item: 1,
    item_name: "Notebook",
    image_url: null,
    currency: "STRIKE",
    price: 4,
    status: "PENDING",
    status_label: "Pending",
    note: "",
    created_at: "2026-11-10T10:00:00Z",
    settled_at: null,
  },
];

let host: HTMLElement;
let root: Root;

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}
async function render() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <Page />
      </QueryClientProvider>,
    );
  });
  await settle();
}
async function click(el: Element) {
  await act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
}
async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function choose(el: HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
const buttonIn = (el: ParentNode, words: string) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === words)!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const inDialog = <T extends Element>(sel: string) => dialog()!.querySelector<T>(sel)!;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const f of Object.values(api)) f.mockReset();
  api.adminOrders.mockResolvedValue(ORDERS);
  api.adminItems.mockResolvedValue([
    item(1, { name: "Notebook", description: "A5, lined", stock: 0 }),
    item(2, { name: "Hoodie", currency: "STRIKE", price: 12, stock: 3, is_active: false }),
    item(3, { name: "Pen", stock: 20 }),
  ]);
  api.settleOrder.mockResolvedValue({});
  api.createItem.mockResolvedValue(item(9));
  api.updateItem.mockResolvedValue(item(1));
  api.deleteItem.mockResolvedValue({ detail: "Deleted.", deleted: true });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the queue and the stock", () => {
  it("shows what is waiting and what is stocked", async () => {
    await render();
    expect(host.querySelector("h1")!.textContent).toBe("Reward shop");
    const order = host.querySelector('[data-order="7"]')!;
    expect(order.textContent).toContain("Aziza Karimova");
    expect(order.textContent).toContain("Notebook");
    expect(order.textContent).toContain("4 strikes");

    expect(host.querySelector('[data-item="1"]')!.textContent).toContain("A5, lined");
    expect(host.querySelector('[data-item="1"]')!.textContent).toContain("Out of stock");
    expect(host.querySelector('[data-item="2"]')!.textContent).toContain("Hidden");
    expect(host.querySelector('[data-item="2"]')!.textContent).toContain("3 left");
    expect(host.querySelector('[data-item="2"]')!.textContent).toContain("12 strikes");
    expect(host.querySelector('[data-item="3"]')!.textContent).toContain("20 left");
    expect(host.querySelector('[data-item="3"]')!.textContent).toContain("50 coins");
  });

  it("hands an order over and refunds one with the same calls", async () => {
    await render();
    await click(buttonIn(host.querySelector('[data-order="7"]')!, "Handed over"));
    expect(api.settleOrder).toHaveBeenCalledWith(7, "fulfil", "");
    await click(buttonIn(host.querySelector('[data-order="7"]')!, "Refund"));
    expect(api.settleOrder).toHaveBeenLastCalledWith(7, "cancel", "");
  });

  it("deletes an item with the same call", async () => {
    await render();
    await click(host.querySelector('[aria-label="Delete Pen"]')!);
    expect(api.deleteItem).toHaveBeenCalledWith(3);
  });

  it("shows the empty states", async () => {
    api.adminOrders.mockResolvedValue([]);
    api.adminItems.mockResolvedValue([]);
    await render();
    expect(host.textContent).toContain("Nothing waiting");
    expect(host.textContent).toContain("Every order has been collected.");
    expect(host.textContent).toContain("Nothing stocked yet");
    expect(host.textContent).toContain("Add an item and it appears in the students' shop.");
  });

  it("never draws a failed queue or list as empty, and tries again", async () => {
    api.adminOrders.mockRejectedValueOnce(new Error("boom"));
    api.adminItems.mockRejectedValueOnce(new Error("boom"));
    await render();
    expect(host.textContent).toContain("The queue didn't load.");
    expect(host.textContent).toContain("The item list didn't load.");
    expect(host.textContent).not.toContain("Nothing waiting");
    const retries = Array.from(host.querySelectorAll("button")).filter((b) => b.textContent === "Try again");
    expect(retries).toHaveLength(2);
    await click(retries[0]);
    await click(retries[1]);
    expect(api.adminOrders).toHaveBeenCalledTimes(2);
    expect(api.adminItems).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[data-order="7"]')).not.toBeNull();
  });
});

describe("add and edit", () => {
  it("adds an item with a JSON body, numbers as numbers", async () => {
    await render();
    await click(buttonIn(host, "Add an item"));
    expect(dialog()!.querySelector("h2")!.textContent).toBe("Add an item");
    await type(inDialog<HTMLInputElement>("#shop-item-name"), "Mug");
    await type(inDialog<HTMLTextAreaElement>("#shop-item-description"), "Ceramic");
    await choose(inDialog<HTMLSelectElement>("#shop-item-currency"), "STRIKE");
    await type(inDialog<HTMLInputElement>("#shop-item-price"), "6");
    await type(inDialog<HTMLInputElement>("#shop-item-stock"), "10");
    await type(inDialog<HTMLInputElement>("#shop-item-sort"), "2");
    await click(inDialog<HTMLInputElement>("#shop-item-active"));
    await click(buttonIn(dialog()!, "Save"));
    expect(api.createItem).toHaveBeenCalledWith({
      name: "Mug",
      description: "Ceramic",
      currency: "STRIKE",
      price: 6,
      stock: 10,
      sort_order: 2,
      is_active: false,
    });
    expect(dialog()).toBeNull();
  });

  it("edits an item from its own values", async () => {
    await render();
    await click(host.querySelector('[aria-label="Edit Pen"]')!);
    expect(dialog()!.querySelector("h2")!.textContent).toBe("Edit item");
    expect(inDialog<HTMLInputElement>("#shop-item-name").value).toBe("Pen");
    await type(inDialog<HTMLInputElement>("#shop-item-price"), "55");
    await click(buttonIn(dialog()!, "Save"));
    expect(api.updateItem).toHaveBeenCalledWith(3, {
      name: "Pen",
      description: "",
      currency: "COIN",
      price: 55,
      stock: 20,
      sort_order: 0,
      is_active: true,
    });
  });

  it("sends FormData with the picture once one is picked", async () => {
    await render();
    await click(buttonIn(host, "Add an item"));
    await type(inDialog<HTMLInputElement>("#shop-item-name"), "Cap");
    const picker = inDialog<HTMLInputElement>("#shop-item-image");
    const file = new File(["x"], "cap.png", { type: "image/png" });
    await act(async () => {
      Object.defineProperty(picker, "files", { value: [file], configurable: true });
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click(buttonIn(dialog()!, "Save"));
    const body = api.createItem.mock.calls[0][0] as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("name")).toBe("Cap");
    expect(body.get("price")).toBe("1");
    expect(body.get("is_active")).toBe("true");
    expect((body.get("image") as File).name).toBe("cap.png");
  });

  it("shows the server's words in the dialog when a save is refused", async () => {
    api.createItem.mockRejectedValue({ response: { status: 400, data: { price: ["Ensure this value is greater than or equal to 1."] } } });
    await render();
    await click(buttonIn(host, "Add an item"));
    await click(buttonIn(dialog()!, "Save"));
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toContain("Ensure this value is greater than or equal to 1.");
  });

  it("closes without saving on Cancel", async () => {
    await render();
    await click(buttonIn(host, "Add an item"));
    await click(buttonIn(dialog()!, "Cancel"));
    expect(dialog()).toBeNull();
    expect(api.createItem).not.toHaveBeenCalled();
  });
});
