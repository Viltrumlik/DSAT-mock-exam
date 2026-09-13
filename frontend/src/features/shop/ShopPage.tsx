"use client";

/**
 * /shop — what a student has to spend, the two shelves they spend it on, and the orders
 * waiting for them at the desk.
 *
 * The shelves used to stand one above the other. That reads fine while each holds three
 * things and stops working the day either holds thirty: the strike shop sinks under every
 * coin item (the owner, 2026-09-13: "agar mahsulot ko'p bo'lsa nima bo'ladi?"). So each
 * currency has its own tab, with its count on the tab.
 *
 * Dressed in the house's white quartz and continuous corners — the vocabulary set page's
 * material — where it had the blue banner and bordered cards ("eski dizaynda qolib ketgan").
 */

import { useState } from "react";
import { Coins, Flame, PackageX, ShoppingBag } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { HeroPage, Skeleton } from "@/components/ui";
import { RewardCoin } from "@/components/RewardCoin";
import { useToast } from "@/components/ToastProvider";
import { EmptyState, ErrorState, Tabs, type TabItem } from "@/features/classroom/ui";
import { cn } from "@/lib/cn";

import { useMyOrders, usePurchase, useStorefront } from "./shopHooks";
import type { ShopCurrency, ShopItem, ShopOrder, ShopOrderStatus } from "./shopApi";

type ShelfKey = "coin" | "strike";

const SHELF: Record<
  ShelfKey,
  {
    label: string;
    icon: LucideIcon;
    blurb: string;
    empty: string;
    /** The currency's own tint: the tile behind a glyph, and an item with no picture. */
    tint: string;
  }
> = {
  coin: {
    label: "Coin shop",
    icon: Coins,
    blurb: "Bought with coins, converted from your points.",
    empty: "Your learning center hasn't stocked the coin shop yet.",
    tint: "bg-primary/10 text-primary dark:text-primary-hover",
  },
  strike: {
    label: "Strike shop",
    icon: Flame,
    blurb: "Bought with strikes — one for every lesson in your current run.",
    empty: "Your learning center hasn't stocked the strike shop yet.",
    tint: "bg-warning/15 text-warning-foreground",
  },
};

const SHELF_ORDER: ShelfKey[] = ["coin", "strike"];

const shelfOf = (currency: ShopCurrency): ShelfKey => (currency === "COIN" ? "coin" : "strike");

const ORDER_STATUS: Record<ShopOrderStatus, string> = {
  PENDING: "bg-primary/10 text-primary dark:text-primary-hover",
  FULFILLED: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  CANCELLED: "bg-surface-2 text-muted-foreground",
};

/** Cards enter in sequence, but a shelf of forty shouldn't keep the last one waiting. */
const STAGGER_MS = 50;
const STAGGER_CAP = 9;

function fmtDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "1 coin", "4 strikes" — the orders list used to say "1 coins". */
function amount(n: number, currency: ShopCurrency) {
  return `${n} ${currency === "COIN" ? "coin" : "strike"}${n === 1 ? "" : "s"}`;
}

export function ShopPage() {
  const shop = useStorefront();
  const orders = useMyOrders();
  const purchase = usePurchase();
  const toast = useToast();
  // Null until the student picks a tab; until then the page chooses — see `shelf` below.
  const [picked, setPicked] = useState<ShelfKey | null>(null);

  // Answered in a toast, which is on screen wherever the student has scrolled to. A message
  // printed above the shelves is out of sight of a Buy pressed twenty items down, and a
  // purchase nobody saw land is one a student presses again.
  const buy = (id: number) => {
    purchase.mutate(id, {
      onSuccess: (data) => toast.push({ tone: "success", message: data.detail }),
      onError: (error) => {
        const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail;
        toast.push({ tone: "error", message: detail ?? "That didn't go through. Nothing was taken." });
      },
    });
  };

  if (shop.isError) {
    return (
      <HeroPage>
        <section className="quartz squircle cr-cardrise [--sq:15px]">
          <ErrorState
            title="The shop isn't loading right now."
            message="Your coins and strikes are safe — only this page failed to load."
            onRetry={() => void shop.refetch()}
          />
        </section>
      </HeroPage>
    );
  }

  const data = shop.data;
  const shelves: Record<ShelfKey, ShopItem[]> = {
    coin: data?.coin_items ?? [],
    strike: data?.strike_items ?? [],
  };
  // Until the student picks, open on a shelf that has something on it: an unstocked coin shop
  // beside a stocked strike shop shouldn't greet anyone with "Nothing here yet".
  const shelf: ShelfKey =
    picked ?? (shelves.coin.length === 0 && shelves.strike.length > 0 ? "strike" : "coin");
  const items = shelves[shelf];

  const tabs: TabItem[] = SHELF_ORDER.map((key) => ({
    id: key,
    label: SHELF[key].label,
    icon: SHELF[key].icon,
    count: data ? shelves[key].length : undefined,
  }));

  const run = data?.current_streak ?? 0;

  return (
    <HeroPage className="flex flex-col gap-7">
      {/* ── HERO ─────────────────────────────────────────────────────── */}
      {/* cr-cardrise, not a float: nothing on the hero is clickable, so it must not lift. */}
      <section className="quartz squircle cr-cardrise relative overflow-hidden [--sq:15px]">
        {/* The two currencies as one thin edge — the coin's blue running into the strike's
            amber — rather than a whole banner of either. */}
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-primary/50 to-warning"
        />

        <div className="relative flex flex-col gap-6 px-6 py-7 sm:px-8">
          <div className="flex items-start gap-4">
            <span
              className={cn(
                "squircle flex h-14 w-14 shrink-0 items-center justify-center [--sq:8.5px]",
                SHELF.coin.tint,
              )}
            >
              <ShoppingBag className="h-7 w-7" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="text-[28px] font-extrabold leading-[1.1] tracking-[-0.025em] text-foreground sm:text-[32px]">
                Shop
              </h1>
              <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-muted-foreground">
                {"Spend what you've earned. Coins keep; strikes don't — miss a lesson and they're gone."}
              </p>
            </div>
          </div>

          {data ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Balance
                index={0}
                watermark={Coins}
                media={<RewardCoin kind="coin" size="md" />}
                label="Coins"
                value={data.coins}
                sub={
                  data.convertible_coins > 0 ? `${data.convertible_coins} more to convert` : undefined
                }
              />
              {/* The spendable balance leads; the run it comes from is the line underneath,
                  worded as on the dashboard and the profile. */}
              <Balance
                index={1}
                watermark={Flame}
                media={
                  <span
                    className={cn(
                      "squircle flex h-10 w-10 items-center justify-center [--sq:7px]",
                      SHELF.strike.tint,
                    )}
                  >
                    <Flame className="h-5 w-5" aria-hidden />
                  </span>
                }
                label="Strikes"
                value={data.strikes}
                sub={
                  run > 0
                    ? `${run} ${run === 1 ? "lesson" : "lessons"} in a row`
                    : "Attend a lesson to start a run"
                }
              />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2" aria-hidden>
              {[0, 1].map((i) => (
                <Skeleton key={i} className="squircle h-[88px] [--sq:10px]" />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── SHELVES — one tab per currency ───────────────────────────── */}
      <section className="flex flex-col gap-4">
        <Tabs items={tabs} active={shelf} onChange={(id) => setPicked(id as ShelfKey)} />

        {/* Keyed by shelf, so switching tabs replays the entrance instead of swapping the
            cards in place. */}
        <div key={shelf} className="cr-section flex flex-col gap-4">
          <p className="ds-small">{SHELF[shelf].blurb}</p>

          {!data ? (
            <ShelfSkeleton />
          ) : items.length === 0 ? (
            <div className="quartz squircle [--sq:13px]">
              <EmptyState icon={PackageX} title="Nothing here yet" description={SHELF[shelf].empty} />
            </div>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item, i) => (
                <li
                  key={item.id}
                  className="cr-pop"
                  style={{ animationDelay: `${Math.min(i, STAGGER_CAP) * STAGGER_MS}ms` }}
                >
                  <ItemCard item={item} onBuy={buy} busy={purchase.isPending} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {(orders.data?.length ?? 0) > 0 ? <Orders orders={orders.data ?? []} /> : null}
    </HeroPage>
  );
}

/** A balance on the hero: a block of quartz on the hero's own white, as the set page's facts. */
function Balance({
  index,
  media,
  watermark: Watermark,
  label,
  value,
  sub,
}: {
  index: number;
  media: React.ReactNode;
  watermark: LucideIcon;
  label: string;
  value: number;
  sub?: string;
}) {
  return (
    <div
      className="quartz squircle cr-cardrise relative flex items-center gap-3.5 overflow-hidden px-4 py-3.5 [--sq:10px]"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <Watermark
        aria-hidden
        strokeWidth={1.25}
        className="pointer-events-none absolute -bottom-3 -right-2 h-16 w-16 text-foreground/[0.05]"
      />
      <span className="relative shrink-0">{media}</span>
      <div className="relative min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">{label}</p>
        <p className="ds-num mt-1.5 text-[26px] font-extrabold leading-none tracking-tight text-foreground">
          {value}
        </p>
        {sub ? <p className="mt-1.5 truncate text-[12px] font-semibold text-muted-foreground">{sub}</p> : null}
      </div>
    </div>
  );
}

function ItemCard({
  item,
  onBuy,
  busy,
}: {
  item: ShopItem;
  onBuy: (id: number) => void;
  busy: boolean;
}) {
  const short = item.short_by ?? 0;
  const unit = item.currency === "COIN" ? "coin" : "strike";

  return (
    // No float: the card itself isn't clickable — its Buy button is — and a block that lifts
    // under the pointer promises a click it wouldn't take.
    <article className="quartz squircle flex h-full flex-col p-2 [--sq:13px]">
      <div
        className={cn(
          "squircle aspect-[4/3] w-full overflow-hidden [--sq:8.5px]",
          item.image_url ? "bg-surface-2" : SHELF[shelfOf(item.currency)].tint,
        )}
      >
        {item.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed R2 URLs, not a known host
          <img src={item.image_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full place-items-center">
            <ShoppingBag className="h-9 w-9 opacity-80" strokeWidth={1.75} aria-hidden />
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col px-2.5 pb-2 pt-3.5">
        <h3 className="text-[15.5px] font-extrabold leading-snug tracking-[-0.01em] text-foreground">
          {item.name}
        </h3>
        {item.description ? (
          <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
            {item.description}
          </p>
        ) : null}

        <div className="mt-auto flex items-center justify-between gap-3 pt-4">
          <span className="flex items-center gap-1.5">
            {item.currency === "COIN" ? (
              <RewardCoin kind="coin" size="sm" />
            ) : (
              <Flame className="h-5 w-5 text-orange-500" aria-hidden />
            )}
            <span className="ds-num text-[18px] font-extrabold leading-none text-foreground">
              {item.price}
            </span>
          </span>
          {/* A pill, as the tab bar's: `Button`'s own radius can't be overridden from here
              (`cn` doesn't merge), so this is the house pill written out. */}
          <button
            type="button"
            disabled={!item.affordable || busy}
            onClick={() => onBuy(item.id)}
            className={cn(
              "ds-ring cr-press inline-flex h-9 shrink-0 items-center rounded-full px-5 font-[inherit] text-[13px] font-extrabold",
              "bg-primary text-primary-foreground shadow-[0_6px_14px_-6px_var(--primary)] hover:bg-primary-hover",
              "disabled:pointer-events-none disabled:bg-surface-2 disabled:text-muted-foreground disabled:shadow-none",
            )}
          >
            {item.in_stock ? "Buy" : "Sold out"}
          </button>
        </div>

        {/* Never "you can't afford this" — say what is still needed, which is a thing the
            student can go and do. */}
        <p className="mt-2.5 text-[12px] font-semibold text-muted-foreground">
          {!item.in_stock ? (
            "Out of stock — check back soon."
          ) : short > 0 ? (
            <>
              <span className="font-extrabold text-foreground">
                {short} more {unit}
                {short === 1 ? "" : "s"}
              </span>{" "}
              and it&apos;s yours.
            </>
          ) : (
            `${item.stock} left`
          )}
        </p>
      </div>
    </article>
  );
}

function Orders({ orders }: { orders: ShopOrder[] }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-[20px] font-extrabold tracking-[-0.015em] text-foreground">Your orders</h2>
        <p className="ds-small mt-1">Collect them from the desk</p>
      </div>

      <ul className="quartz squircle cr-cardrise divide-y divide-border overflow-hidden [--sq:13px]">
        {orders.map((order) => (
          <li key={order.id} className="flex items-center gap-3.5 px-4 py-3 sm:px-5">
            <span
              className={cn(
                "squircle flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden [--sq:7px]",
                order.image_url ? "bg-surface-2" : SHELF[shelfOf(order.currency)].tint,
              )}
            >
              {order.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed R2 URLs, not a known host
                <img src={order.image_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <ShoppingBag className="h-5 w-5" aria-hidden />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14.5px] font-extrabold text-foreground">{order.item_name}</p>
              <p className="mt-0.5 truncate text-[12.5px] font-semibold text-muted-foreground">
                {fmtDate(order.created_at)} · {amount(order.price, order.currency)}
                {order.note ? ` · ${order.note}` : ""}
              </p>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-extrabold",
                ORDER_STATUS[order.status] ?? ORDER_STATUS.CANCELLED,
              )}
            >
              {order.status_label}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The shelf loading: the card's own silhouette, so the swap to live items doesn't reflow. */
function ShelfSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="quartz squircle flex flex-col p-2 [--sq:13px]">
          <Skeleton className="squircle aspect-[4/3] w-full [--sq:8.5px]" />
          <div className="flex flex-col gap-2 px-2.5 pb-2 pt-3.5">
            <Skeleton variant="text" className="w-2/3" />
            <Skeleton variant="text" className="w-full" />
            <div className="mt-4 flex items-center justify-between">
              <Skeleton variant="circle" className="h-6 w-14" />
              <Skeleton variant="circle" className="h-9 w-16" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
