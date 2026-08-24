"use client";

import { useState } from "react";
import { Package, PackagePlus, Pencil, Trash2, Check } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Field,
  IconButton,
  Input,
  Modal,
  Select,
  Textarea,
} from "@/components/ui";
import { OpsPageHeader } from "@/features/ops/OpsPageHeader";
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
    <div className="space-y-5">
      <OpsPageHeader
        section="Shop"
        title="Shop"
        description="Stock, prices and the collection queue."
        actions={
          <Button onClick={() => setEditing(null)}>
            <PackagePlus className="mr-1.5 h-4 w-4" aria-hidden />
            Add an item
          </Button>
        }
      />

      {/* Flat bordered panel with an uppercase header strip — the idiom Users, Classrooms and
          Exam dates use. These were shadowed `Card`s with bold headings inside, which is what
          made this page read as belonging to a different console. */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-5 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Waiting to be handed over
          </p>
          {orders.data && orders.data.length > 0 ? (
            <span className="ml-auto text-[10px] font-bold text-primary">
              {orders.data.length}
            </span>
          ) : null}
        </div>
        {/* Four branches: loading, error, empty, data. An error rendered as an empty queue
            tells an administrator there is nothing to do, which is the worst possible lie
            for this particular screen. */}
        {orders.isPending ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex animate-pulse items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="h-4 w-48 rounded bg-muted" />
                  <div className="h-3 w-28 rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : orders.isError ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm font-semibold text-foreground">The queue didn&apos;t load.</p>
            <button
              type="button"
              onClick={() => void orders.refetch()}
              className="mt-1 text-sm font-bold text-primary underline"
            >
              Try again
            </button>
          </div>
        ) : orders.data.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <Check className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-semibold text-foreground">Nothing waiting</p>
            <p className="mt-1 text-sm text-muted-foreground">Every order has been collected.</p>
          </div>
        ) : (
          // Two equally-weighted buttons on every row made a wall of blue down the card and
          // gave the destructive option the same pull as the routine one. Handing the prize
          // over is what happens; refunding is the exception, so it is a quiet text control.
          <ul className="divide-y divide-border">
            {orders.data.map((order) => (
              <li
                key={order.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-5 py-3.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">
                    {order.student_name} <span className="text-muted-foreground">·</span>{" "}
                    {order.item_name}
                  </p>
                  <p className="text-xs font-semibold text-muted-foreground">
                    {order.price} {order.currency === "COIN" ? "coins" : "strikes"} ·{" "}
                    {new Date(order.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    loading={settle.isPending}
                    onClick={() => settle.mutate({ id: order.id, action: "fulfil" })}
                  >
                    <Check className="mr-1.5 h-4 w-4" aria-hidden />
                    Handed over
                  </Button>
                  <button
                    type="button"
                    disabled={settle.isPending}
                    onClick={() => settle.mutate({ id: order.id, action: "cancel" })}
                    className="ds-ring rounded-lg px-2 py-1 text-xs font-bold text-muted-foreground hover:text-danger disabled:opacity-60"
                  >
                    Refund
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-5 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Stock
          </p>
          {items.data && items.data.length > 0 ? (
            <span className="ml-auto text-[10px] font-bold text-muted-foreground">
              {items.data.length}
            </span>
          ) : null}
        </div>
        {items.isPending ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex animate-pulse items-center gap-3 px-5 py-3.5">
                <div className="h-12 w-12 shrink-0 rounded-lg bg-muted" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="h-4 w-40 rounded bg-muted" />
                  <div className="h-3 w-24 rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : items.isError ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm font-semibold text-foreground">
              The item list didn&apos;t load.
            </p>
            <button
              type="button"
              onClick={() => void items.refetch()}
              className="mt-1 text-sm font-bold text-primary underline"
            >
              Try again
            </button>
          </div>
        ) : items.data.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <Package className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-semibold text-foreground">Nothing stocked yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add an item and it appears in the students&apos; shop.
            </p>
          </div>
        ) : (
          // A grid, not a row of flex children: fixed columns keep price, stock and the
          // controls in the same place on every line. As flex with a `flex-1` name, the
          // actions were pinned to the far right of a very wide card with a thousand pixels
          // of nothing in between, and no two rows lined up.
          <ul className="divide-y divide-border">
            {items.data.map((item) => (
              <li
                key={item.id}
                className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-5 py-3.5 sm:grid-cols-[3rem_minmax(0,1fr)_7rem_6rem_auto]"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-2 text-muted-foreground">
                  {item.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signed R2 URL
                    <img src={item.image_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    // An empty grey square reads as a broken image. An icon reads as "no
                    // picture yet", which is what it is.
                    <Package className="h-5 w-5" aria-hidden />
                  )}
                </div>

                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-bold">
                    <span className="truncate">{item.name}</span>
                    {!item.is_active ? <Badge variant="neutral">Hidden</Badge> : null}
                  </p>
                  {item.description ? (
                    <p className="truncate text-xs font-medium text-muted-foreground">
                      {item.description}
                    </p>
                  ) : null}
                </div>

                <p className="hidden text-sm font-bold tabular-nums text-foreground sm:block">
                  {item.price}{" "}
                  <span className="text-xs font-semibold text-muted-foreground">
                    {item.currency === "COIN" ? "coins" : "strikes"}
                  </span>
                </p>

                {/* Spotting what has run out is the main reason to open this page, so stock
                    is a toned badge rather than another grey line of text. */}
                <p className="hidden sm:block">
                  <span
                    className={`inline-flex rounded-md px-2 py-0.5 text-xs font-extrabold tabular-nums ${
                      item.stock === 0
                        ? "bg-danger-soft text-danger-foreground"
                        : item.stock <= 5
                          ? "bg-warning-soft text-warning-foreground"
                          : "bg-surface-2 text-muted-foreground"
                    }`}
                  >
                    {item.stock === 0 ? "Out of stock" : `${item.stock} left`}
                  </span>
                </p>

                <div className="flex items-center gap-1">
                  <IconButton
                    aria-label={`Edit ${item.name}`}
                    title="Edit"
                    variant="ghost"
                    onClick={() => setEditing(item)}
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                  </IconButton>
                  <IconButton
                    aria-label={`Delete ${item.name}`}
                    title="Delete"
                    variant="ghost"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(item.id)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing !== undefined ? (
        <ItemForm item={editing} onClose={() => setEditing(undefined)} />
      ) : null}
    </div>
  );
}
