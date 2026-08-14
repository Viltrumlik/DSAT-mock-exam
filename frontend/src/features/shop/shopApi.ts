import api from "@/lib/api";

export type ShopCurrency = "COIN" | "STRIKE";
export type ShopOrderStatus = "PENDING" | "FULFILLED" | "CANCELLED";

export interface ShopItem {
  id: number;
  name: string;
  description: string;
  image_url: string | null;
  currency: ShopCurrency;
  currency_label: string;
  price: number;
  stock: number;
  in_stock: boolean;
  is_active: boolean;
  sort_order: number;
  /** Server-computed, so the storefront never does currency arithmetic. */
  affordable?: boolean;
  /** How many MORE are needed. The copy rule: say what is missing, never "you can't". */
  short_by?: number;
}

export interface ShopOrder {
  id: number;
  student: number;
  student_name: string;
  item: number;
  item_name: string;
  image_url: string | null;
  currency: ShopCurrency;
  price: number;
  status: ShopOrderStatus;
  status_label: string;
  note: string;
  created_at: string;
  settled_at: string | null;
}

export interface Storefront {
  coins: number;
  convertible_coins: number;
  strikes: number;
  current_streak: number;
  best_streak: number;
  coin_items: ShopItem[];
  strike_items: ShopItem[];
}

export const shopApi = {
  async storefront(): Promise<Storefront> {
    const { data } = await api.get<Storefront>("/shop/");
    return data;
  },
  async purchase(itemId: number): Promise<{ detail: string; order: ShopOrder }> {
    const { data } = await api.post(`/shop/items/${itemId}/purchase/`);
    return data;
  },
  async myOrders(): Promise<ShopOrder[]> {
    const { data } = await api.get<{ orders: ShopOrder[] }>("/shop/orders/");
    return data.orders;
  },

  // ── Admin ───────────────────────────────────────────────────────────────
  async adminItems(): Promise<ShopItem[]> {
    const { data } = await api.get<{ items: ShopItem[] }>("/shop/admin/items/");
    return data.items;
  },
  /** `body` is FormData when a picture is attached — axios must set the boundary itself,
   *  so no Content-Type is passed here. */
  async createItem(body: FormData | Record<string, unknown>): Promise<ShopItem> {
    const { data } = await api.post<ShopItem>("/shop/admin/items/", body);
    return data;
  },
  async updateItem(id: number, body: FormData | Record<string, unknown>): Promise<ShopItem> {
    const { data } = await api.patch<ShopItem>(`/shop/admin/items/${id}/`, body);
    return data;
  },
  async deleteItem(id: number): Promise<{ detail: string; deleted: boolean }> {
    const { data } = await api.delete(`/shop/admin/items/${id}/`);
    return data;
  },
  async adminOrders(status = "PENDING"): Promise<ShopOrder[]> {
    const { data } = await api.get<{ orders: ShopOrder[] }>("/shop/admin/orders/", {
      params: { status },
    });
    return data.orders;
  },
  async settleOrder(id: number, action: "fulfil" | "cancel", note = ""): Promise<ShopOrder> {
    const { data } = await api.post<ShopOrder>(`/shop/admin/orders/${id}/settle/`, {
      action,
      note,
    });
    return data;
  },
};
