"use client";

import { useState } from "react";
import { PackagePlus, Pencil, Trash2, Check, X } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Modal,
  Select,
  Skeleton,
  Textarea,
} from "@/components/ui";
import {
  useAdminItems,
  useAdminOrders,
  useDeleteItem,
  useSaveItem,
  useSettleOrder,
} from "@/features/shop/shopHooks";
import type { ShopItem } from "@/features/shop/shopApi";

const EMPTY = {
  name: "",
  description: "",
  currency: "COIN",
  price: "1",
  stock: "0",
  sort_order: "0",
  is_active: true,
};

function ItemForm({
  item, onClose,
}: { item: ShopItem | null; onClose: () => void }) {
  const save = useSaveItem();
  const [form, setForm] = useState(
    item
      ? {
          name: item.name,
          description: item.description,
          currency: item.currency,
          price: String(item.price),
          stock: String(item.stock),
          sort_order: String(item.sort_order),
          is_active: item.is_active,
        }
      : EMPTY,
  );
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    // FormData only when there is a file. A bare JSON body is easier to read in the network
    // tab, and axios must set the multipart boundary itself when there is one — passing a
    // Content-Type by hand breaks the upload.
    let body: FormData | Record<string, unknown>;
    if (file) {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, String(v)));
      fd.append("image", file);
      body = fd;
    } else {
      body = { ...form, price: Number(form.price), stock: Number(form.stock), sort_order: Number(form.sort_order) };
    }
    save.mutate(
      { id: item?.id, body },
      {
        onSuccess: onClose,
        onError: (e) => {
          const data = (e as { response?: { data?: Record<string, string[]> } })?.response?.data;
          setError(
            data ? Object.values(data).flat().join(" ") : "Couldn't save that. Try again.",
          );
        },
      },
    );
  };

  return (
    <Modal open onClose={onClose} title={item ? "Edit item" : "Add an item"}>
      <div className="space-y-3">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="Name">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Description">
          <Textarea
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        <Field label="Picture" hint={item?.image_url ? "Leave empty to keep the current one." : undefined}>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Currency" hint="An item is priced in one currency, never both.">
            <Select
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
            >
              <option value="COIN">Coins</option>
              <option value="STRIKE">Strikes</option>
            </Select>
          </Field>
          <Field label="Price">
            <Input
              type="number"
              min={1}
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="In stock" hint="Drops by one on each purchase.">
            <Input
              type="number"
              value={form.stock}
              onChange={(e) => setForm({ ...form, stock: e.target.value })}
            />
          </Field>
          <Field label="Sort order" hint="Lower shows first.">
            <Input
              type="number"
              value={form.sort_order}
              onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
          />
          Show in the shop
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={save.isPending}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default function OpsShopPage() {
  const items = useAdminItems();
  const orders = useAdminOrders("PENDING");
  const remove = useDeleteItem();
  const settle = useSettleOrder();
  const [editing, setEditing] = useState<ShopItem | null | undefined>(undefined);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Shop</h1>
          <p className="text-sm font-medium text-muted-foreground">
            Stock, prices and the collection queue.
          </p>
        </div>
        <Button onClick={() => setEditing(null)}>
          <PackagePlus className="mr-1.5 h-4 w-4" aria-hidden />
          Add an item
        </Button>
      </div>

      <Card className="space-y-3">
        <h2 className="text-lg font-extrabold">Waiting to be handed over</h2>
        {/* Four branches: loading, error, empty, data. An error rendered as an empty queue
            tells an administrator there is nothing to do, which is the worst possible lie
            for this particular screen. */}
        {orders.isPending ? (
          <Skeleton className="h-20 rounded-xl" />
        ) : orders.isError ? (
          <Alert tone="danger">
            The queue didn&apos;t load.{" "}
            <button className="underline" onClick={() => void orders.refetch()}>
              Try again
            </button>
          </Alert>
        ) : orders.data.length === 0 ? (
          <p className="text-sm font-semibold text-muted-foreground">
            Nothing waiting — every order has been collected.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {orders.data.map((order) => (
              <li key={order.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">
                    {order.student_name} · {order.item_name}
                  </p>
                  <p className="text-xs font-semibold text-muted-foreground">
                    {order.price} {order.currency === "COIN" ? "coins" : "strikes"} ·{" "}
                    {new Date(order.created_at).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  size="sm"
                  loading={settle.isPending}
                  onClick={() => settle.mutate({ id: order.id, action: "fulfil" })}
                >
                  <Check className="mr-1.5 h-4 w-4" aria-hidden />
                  Handed over
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={settle.isPending}
                  onClick={() => settle.mutate({ id: order.id, action: "cancel" })}
                >
                  <X className="mr-1.5 h-4 w-4" aria-hidden />
                  Cancel &amp; refund
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-extrabold">Stock</h2>
        {items.isPending ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : items.isError ? (
          <Alert tone="danger">
            The item list didn&apos;t load.{" "}
            <button className="underline" onClick={() => void items.refetch()}>
              Try again
            </button>
          </Alert>
        ) : items.data.length === 0 ? (
          <p className="text-sm font-semibold text-muted-foreground">
            Nothing stocked yet. Add an item and it appears in the students&apos; shop.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {items.data.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-surface-2">
                  {item.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signed R2 URL
                    <img src={item.image_url} alt="" className="h-full w-full object-cover" />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">
                    {item.name}{" "}
                    {!item.is_active ? <Badge variant="neutral">Hidden</Badge> : null}
                  </p>
                  <p className="text-xs font-semibold text-muted-foreground">
                    {item.price} {item.currency === "COIN" ? "coins" : "strikes"} ·{" "}
                    {item.stock} in stock
                  </p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setEditing(item)}>
                  <Pencil className="mr-1.5 h-4 w-4" aria-hidden />
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={remove.isPending}
                  onClick={() => remove.mutate(item.id)}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" aria-hidden />
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editing !== undefined ? (
        <ItemForm item={editing} onClose={() => setEditing(undefined)} />
      ) : null}
    </div>
  );
}
