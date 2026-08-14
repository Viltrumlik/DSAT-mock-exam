"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { shopApi } from "./shopApi";

const keys = {
  storefront: ["shop", "storefront"] as const,
  myOrders: ["shop", "orders"] as const,
  adminItems: ["shop", "admin", "items"] as const,
  adminOrders: (status: string) => ["shop", "admin", "orders", status] as const,
};

export function useStorefront() {
  return useQuery({ queryKey: keys.storefront, queryFn: () => shopApi.storefront() });
}

export function useMyOrders() {
  return useQuery({ queryKey: keys.myOrders, queryFn: () => shopApi.myOrders() });
}

/**
 * A purchase moves three things the UI shows elsewhere: the wallet, the strike balance and
 * the item's stock. Invalidating `["rewards"]` as well as the shop keys is what stops the
 * top-bar coin pill disagreeing with the shop the student just spent in.
 */
export function usePurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: number) => shopApi.purchase(itemId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.storefront });
      qc.invalidateQueries({ queryKey: keys.myOrders });
      qc.invalidateQueries({ queryKey: ["rewards"] });
    },
  });
}

export function useAdminItems() {
  return useQuery({ queryKey: keys.adminItems, queryFn: () => shopApi.adminItems() });
}

export function useAdminOrders(status: string) {
  return useQuery({
    queryKey: keys.adminOrders(status),
    queryFn: () => shopApi.adminOrders(status),
  });
}

export function useSaveItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: number; body: FormData | Record<string, unknown> }) =>
      id ? shopApi.updateItem(id, body) : shopApi.createItem(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.adminItems });
      qc.invalidateQueries({ queryKey: keys.storefront });
    },
  });
}

export function useDeleteItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => shopApi.deleteItem(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.adminItems });
      qc.invalidateQueries({ queryKey: keys.storefront });
    },
  });
}

export function useSettleOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, note }: { id: number; action: "fulfil" | "cancel"; note?: string }) =>
      shopApi.settleOrder(id, action, note ?? ""),
    onSuccess: () => {
      // A cancellation refunds and restocks, so the catalogue moves too.
      qc.invalidateQueries({ queryKey: ["shop"] });
    },
  });
}
