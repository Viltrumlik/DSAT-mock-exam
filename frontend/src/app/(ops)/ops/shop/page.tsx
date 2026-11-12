"use client";

import { useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { Badge, Button, EmptyState } from "@/features/console/ui";
import { OpsPageHeader } from "@/features/ops/OpsPageHeader";
import {
  AREA,
  CaptionCount,
  CheckRow,
  FILE_INPUT,
  FormDialog,
  FormField,
  LoadFailed,
  Notice,
  Panel,
  SkeletonRows,
} from "@/features/ops/settings/settingsParts";
import { CONTROL } from "@/features/questionsAdmin/questionLook";
import {
  useAdminItems,
  useAdminOrders,
  useDeleteItem,
  useSaveItem,
  useSettleOrder,
} from "@/features/shop/shopHooks";
import type { ShopItem } from "@/features/shop/shopApi";
import { cn } from "@/lib/cn";

/**
 * /ops/shop — the reward shop's stock, prices and collection queue.
 *
 * In the console's look (design handoff v0.3): cards with a caption row, the console's buttons,
 * badges and form dialog. The words and the calls are the page's own.
 */

/** Refunding is the exception, so it is quiet words that turn red under the pointer, not a button. */
const REFUND_BUTTON =
  "ms-transition rounded-[6px] px-1 py-1 text-[14px] font-semibold text-ms-fg-2 hover:text-ms-critical-fg hover:underline disabled:cursor-not-allowed disabled:text-ms-fg-disabled disabled:hover:no-underline";

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
    <FormDialog
      open
      onClose={onClose}
      title={item ? "Edit item" : "Add an item"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            state={save.isPending ? "busy" : "idle"}
            disabled={save.isPending}
            onClick={submit}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <FormField label="Name" htmlFor="shop-item-name">
          <input
            id="shop-item-name"
            className={CONTROL}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </FormField>
        <FormField label="Description" htmlFor="shop-item-description">
          <textarea
            id="shop-item-description"
            className={AREA}
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </FormField>
        <FormField
          label="Picture"
          htmlFor="shop-item-image"
          hint={item?.image_url ? "Leave empty to keep the current one." : undefined}
        >
          <input
            id="shop-item-image"
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className={FILE_INPUT}
          />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Currency" htmlFor="shop-item-currency" hint="An item is priced in one currency, never both.">
            <select
              id="shop-item-currency"
              className={CONTROL}
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
            >
              <option value="COIN">Coins</option>
              <option value="STRIKE">Strikes</option>
            </select>
          </FormField>
          <FormField label="Price" htmlFor="shop-item-price">
            <input
              id="shop-item-price"
              type="number"
              min={1}
              className={cn(CONTROL, "tabular-nums")}
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
            />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="In stock" htmlFor="shop-item-stock" hint="Drops by one on each purchase.">
            <input
              id="shop-item-stock"
              type="number"
              className={cn(CONTROL, "tabular-nums")}
              value={form.stock}
              onChange={(e) => setForm({ ...form, stock: e.target.value })}
            />
          </FormField>
          <FormField label="Sort order" htmlFor="shop-item-sort" hint="Lower shows first.">
            <input
              id="shop-item-sort"
              type="number"
              className={cn(CONTROL, "tabular-nums")}
              value={form.sort_order}
              onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
            />
          </FormField>
        </div>
        <CheckRow
          id="shop-item-active"
          checked={form.is_active}
          onChange={(checked) => setForm({ ...form, is_active: checked })}
        >
          Show in the shop
        </CheckRow>
      </div>
    </FormDialog>
  );
}

export default function OpsShopPage() {
  const items = useAdminItems();
  const orders = useAdminOrders("PENDING");
  const remove = useDeleteItem();
  const settle = useSettleOrder();
  const [editing, setEditing] = useState<ShopItem | null | undefined>(undefined);

  return (
    <div className="flex flex-col gap-5">
      <OpsPageHeader
        section="Shop"
        title="Reward shop"
        description="Stock, prices and the collection queue."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setEditing(null)}>
            Add an item
          </Button>
        }
      />

      <Panel
        title="Waiting to be handed over"
        icon="gift"
        aside={orders.data && orders.data.length > 0 ? <CaptionCount tone="primary">{orders.data.length}</CaptionCount> : null}
      >
        {/* Four branches: loading, error, empty, data. An error rendered as an empty queue
            tells an administrator there is nothing to do, which is the worst possible lie
            for this particular screen. */}
        {orders.isPending ? (
          <SkeletonRows count={2} />
        ) : orders.isError ? (
          <LoadFailed onRetry={() => void orders.refetch()}>The queue didn&apos;t load.</LoadFailed>
        ) : orders.data.length === 0 ? (
          <EmptyState icon="check" title="Nothing waiting" detail="Every order has been collected." />
        ) : (
          // Two equally-weighted buttons on every row made a wall of blue down the card and
          // gave the destructive option the same pull as the routine one. Handing the prize
          // over is what happens; refunding is the exception, so it is a quiet text control.
          <ul className="divide-y divide-ms-line">
            {orders.data.map((order) => {
              // Every row waits while one settles; only the row being handed over shows it.
              const handing = settle.isPending && settle.variables?.id === order.id && settle.variables?.action === "fulfil";
              return (
                <li
                  key={order.id}
                  data-order={order.id}
                  className="ms-transition flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3.5 hover:bg-ms-surface"
                >
                  <div className="min-w-0 flex-1 basis-[16rem]">
                    <p className="truncate text-[15px] font-semibold leading-[22px] text-ms-fg">
                      {order.student_name} <span className="text-ms-fg-3">·</span>{" "}
                      {order.item_name}
                    </p>
                    <p className="text-[13px] tabular-nums text-ms-fg-2">
                      {order.price} {order.currency === "COIN" ? "coins" : "strikes"} ·{" "}
                      {new Date(order.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Button
                      size="sm"
                      variant="primary"
                      icon="check"
                      state={handing ? "busy" : "idle"}
                      disabled={settle.isPending && !handing}
                      onClick={() => settle.mutate({ id: order.id, action: "fulfil" })}
                    >
                      Handed over
                    </Button>
                    <button
                      type="button"
                      disabled={settle.isPending}
                      onClick={() => settle.mutate({ id: order.id, action: "cancel" })}
                      className={REFUND_BUTTON}
                    >
                      Refund
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel
        title="Stock"
        icon="layers"
        aside={items.data && items.data.length > 0 ? <CaptionCount>{items.data.length}</CaptionCount> : null}
      >
        {items.isPending ? (
          <SkeletonRows count={4} thumb="square" />
        ) : items.isError ? (
          <LoadFailed onRetry={() => void items.refetch()}>The item list didn&apos;t load.</LoadFailed>
        ) : items.data.length === 0 ? (
          <EmptyState icon="gift" title="Nothing stocked yet" detail="Add an item and it appears in the students' shop." />
        ) : (
          // A grid, not a row of flex children: fixed columns keep price, stock and the
          // controls in the same place on every line. As flex with a `flex-1` name, the
          // actions were pinned to the far right of a very wide card with a thousand pixels
          // of nothing in between, and no two rows lined up.
          <ul className="divide-y divide-ms-line">
            {items.data.map((item) => (
              <li
                key={item.id}
                data-item={item.id}
                className="ms-transition grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-5 py-3 hover:bg-ms-surface sm:grid-cols-[3rem_minmax(0,1fr)_7rem_7.5rem_auto]"
              >
                <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-ms-surface-2 text-ms-fg-3">
                  {item.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signed R2 URL
                    <img src={item.image_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    // An empty grey square reads as a broken image. An icon reads as "no
                    // picture yet", which is what it is.
                    <Icon name="gift" />
                  )}
                </div>

                <div className="min-w-0">
                  <p className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[15px] font-semibold leading-[22px] text-ms-fg">{item.name}</span>
                    {!item.is_active ? <Badge tone="neutral">Hidden</Badge> : null}
                  </p>
                  {item.description ? (
                    <p className="truncate text-[13px] text-ms-fg-2">{item.description}</p>
                  ) : null}
                </div>

                <p className="hidden text-[15px] font-semibold tabular-nums text-ms-fg sm:block">
                  {item.price}{" "}
                  <span className="text-[13px] font-medium text-ms-fg-3">
                    {item.currency === "COIN" ? "coins" : "strikes"}
                  </span>
                </p>

                {/* Spotting what has run out is the main reason to open this page, so stock
                    is a toned badge rather than another grey line of text. */}
                <p className="hidden sm:block">
                  <Badge
                    tone={item.stock === 0 ? "critical" : item.stock <= 5 ? "attention" : "neutral"}
                    dot={item.stock <= 5}
                    className="tabular-nums"
                  >
                    {item.stock === 0 ? "Out of stock" : `${item.stock} left`}
                  </Badge>
                </p>

                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="pencil"
                    aria-label={`Edit ${item.name}`}
                    title="Edit"
                    tooltip={false}
                    onClick={() => setEditing(item)}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="trash"
                    aria-label={`Delete ${item.name}`}
                    title="Delete"
                    tooltip={false}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(item.id)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {editing !== undefined ? (
        <ItemForm item={editing} onClose={() => setEditing(undefined)} />
      ) : null}
    </div>
  );
}
