"use client";

import { useState } from "react";
import { ShoppingBag, Flame, PackageX, Check } from "lucide-react";
import { Button, HeroPage, PageHero, Skeleton } from "@/components/ui";
import { Card, CardHeader, EmptyState, ErrorState } from "@/features/classroom/ui";
import { RewardCoin } from "@/components/RewardCoin";
import { useMyOrders, usePurchase, useStorefront } from "./shopHooks";
import type { ShopItem } from "./shopApi";

function fmtDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Balance({
  media, label, value, sub,
}: { media: React.ReactNode; label: string; value: number; sub?: string }) {
  // Dark scrim, full-white text — measured: a 72% white label on a light panel over the hero
  // gradient falls under 3:1, and these labels are the only thing naming which figure is which.
  return (
    <div className="flex min-w-[150px] flex-1 items-center gap-3 rounded-2xl bg-black/[0.22] px-4 py-3.5">
      <span className="shrink-0">{media}</span>
      <div className="min-w-0">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.06em]">{label}</p>
        <p className="ds-num text-[28px] font-extrabold leading-none">{value}</p>
        {sub ? <p className="mt-1 truncate text-[11px] font-bold">{sub}</p> : null}
      </div>
    </div>
  );
}

function ItemCard({
  item, onBuy, busy,
}: { item: ShopItem; onBuy: (id: number) => void; busy: boolean }) {
  const short = item.short_by ?? 0;
  const unit = item.currency === "COIN" ? "coin" : "strike";

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card">
      <div className="aspect-[4/3] w-full bg-surface-2">
        {item.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed R2 URLs, not a known host
          <img src={item.image_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full place-items-center text-muted-foreground">
            <ShoppingBag className="h-8 w-8" aria-hidden />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="text-sm font-extrabold text-foreground">{item.name}</p>
        {item.description ? (
          <p className="line-clamp-2 text-xs font-semibold text-muted-foreground">
            {item.description}
          </p>
        ) : null}
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <span className="flex items-center gap-1.5 text-sm font-extrabold text-foreground">
            {item.currency === "COIN" ? (
              <RewardCoin kind="coin" size="sm" />
            ) : (
              <Flame className="h-4 w-4 text-orange-500" aria-hidden />
            )}
            {item.price}
          </span>
          <Button
            size="sm"
            disabled={!item.affordable || busy}
            onClick={() => onBuy(item.id)}
          >
            {item.in_stock ? "Buy" : "Sold out"}
          </Button>
        </div>
        {/* Never "you can't afford this" — say what is still needed, which is a thing the
            student can go and do. */}
        {!item.in_stock ? (
          <p className="text-[11px] font-bold text-muted-foreground">
            Out of stock — check back soon.
          </p>
        ) : short > 0 ? (
          <p className="text-[11px] font-bold text-muted-foreground">
            {short} more {unit}
            {short === 1 ? "" : "s"} and it&apos;s yours.
          </p>
        ) : (
          <p className="text-[11px] font-bold text-muted-foreground">
            {item.stock} left
          </p>
        )}
      </div>
    </div>
  );
}

function Shelf({
  title, description, items, onBuy, busy, emptyText,
}: {
  title: string;
  description: string;
  items: ShopItem[];
  onBuy: (id: number) => void;
  busy: boolean;
  emptyText: string;
}) {
  return (
    <Card className="cr-card space-y-3">
      <CardHeader title={title} description={description} />
      {items.length === 0 ? (
        <EmptyState icon={PackageX} title="Nothing here yet" description={emptyText} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} onBuy={onBuy} busy={busy} />
          ))}
        </div>
      )}
    </Card>
  );
}

export function ShopPage() {
  const shop = useStorefront();
  const orders = useMyOrders();
  const purchase = usePurchase();
  const [message, setMessage] = useState<string | null>(null);

  const buy = (id: number) => {
    setMessage(null);
    purchase.mutate(id, {
      onSuccess: (data) => setMessage(data.detail),
      onError: (error) => {
        const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail;
        setMessage(detail ?? "That didn't go through. Nothing was taken.");
      },
    });
  };

  if (shop.isError) {
    return (
      <HeroPage>
        <Card className="cr-card">
          <ErrorState
            title="The shop isn't loading right now."
            message="Your coins and strikes are safe — only this page failed to load."
            onRetry={() => void shop.refetch()}
          />
        </Card>
      </HeroPage>
    );
  }

  return (
    <HeroPage className="space-y-5">
      <Card pad="none" className="cr-card overflow-hidden">
        <PageHero
          badge="Shop"
          title="Shop"
          description="Spend what you've earned. Coins keep; strikes don't — miss a lesson and they're gone."
        >
          {shop.isPending ? (
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {[0, 1].map((i) => (
                <div key={i} className="h-[86px] animate-pulse rounded-2xl bg-white/[0.14]" />
              ))}
            </div>
          ) : (
            <div className="mt-6 flex flex-wrap gap-3">
              <Balance
                media={<RewardCoin kind="coin" size="lg" />}
                label="Coins"
                value={shop.data?.coins ?? 0}
                sub={
                  (shop.data?.convertible_coins ?? 0) > 0
                    ? `${shop.data?.convertible_coins} more to convert`
                    : undefined
                }
              />
              <Balance
                media={
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-white/20">
                    <Flame className="h-5 w-5" aria-hidden />
                  </span>
                }
                label="Strikes"
                value={shop.data?.strikes ?? 0}
                sub={`${shop.data?.current_streak ?? 0}-lesson streak`}
              />
            </div>
          )}
        </PageHero>
      </Card>

      {message ? (
        <Card className="cr-card">
          <p className="flex items-center gap-2 text-sm font-bold text-foreground">
            <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
            {message}
          </p>
        </Card>
      ) : null}

      {shop.isPending ? (
        <Card className="cr-card space-y-3">
          <Skeleton className="h-6 w-40 rounded-lg" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-64 rounded-2xl" />
            <Skeleton className="h-64 rounded-2xl" />
            <Skeleton className="h-64 rounded-2xl" />
          </div>
        </Card>
      ) : (
        <>
          <Shelf
            title="Coin shop"
            description="Bought with coins, converted from your points."
            items={shop.data?.coin_items ?? []}
            onBuy={buy}
            busy={purchase.isPending}
            emptyText="Your learning center hasn't stocked the coin shop yet."
          />
          <Shelf
            title="Strike shop"
            description="Bought with strikes — one for every lesson in your current run."
            items={shop.data?.strike_items ?? []}
            onBuy={buy}
            busy={purchase.isPending}
            emptyText="Your learning center hasn't stocked the strike shop yet."
          />
        </>
      )}

      {(orders.data?.length ?? 0) > 0 ? (
        <Card className="cr-card space-y-3">
          <CardHeader title="Your orders" description="Collect them from the desk" />
          <ul className="divide-y divide-border">
            {orders.data?.map((order) => (
              <li key={order.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-foreground">{order.item_name}</p>
                  <p className="truncate text-xs font-semibold text-muted-foreground">
                    {fmtDate(order.created_at)} · {order.price}{" "}
                    {order.currency === "COIN" ? "coins" : "strikes"}
                    {order.note ? ` · ${order.note}` : ""}
                  </p>
                </div>
                <span
                  className={
                    order.status === "FULFILLED"
                      ? "shrink-0 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-extrabold text-emerald-600"
                      : order.status === "CANCELLED"
                        ? "shrink-0 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-extrabold text-muted-foreground"
                        : "shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-extrabold text-primary"
                  }
                >
                  {order.status_label}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </HeroPage>
  );
}
