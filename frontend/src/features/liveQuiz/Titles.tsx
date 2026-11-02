"use client";

/**
 * Titles: what a student has earned by playing, how far off the rest are, and the hats sold only
 * for a season. The server works all of it out; this page says so and sends the choice back. As in
 * the shop, every answer replaces the cache, so what shows as worn is what the server just said.
 */

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Clock, Lock } from "lucide-react";

import { ErrorState, LoadingState } from "@/features/classroom/ui";
import { useMe } from "@/hooks/useMe";
import { normalizeApiError } from "@/lib/apiError";
import { cn } from "@/lib/cn";

import { SHOP_KEY, liveQuizApi, type AvatarWire, type ShopItem, type ShopState, type TitleProgress } from "./api";
import { AvatarDisc, GemIcon, LiveAvatar, TITLES, TitleChip, type TitleTone } from "./avatars";
import { daysLeft } from "./theme";

const ROW = "flex items-center gap-3 rounded-2xl border border-border bg-card px-3.5 shadow-sm";

const TONE_TILE: Record<TitleTone, string> = {
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300",
  teal: "bg-teal-50 text-teal-700 dark:bg-teal-400/15 dark:text-teal-300",
  blue: "bg-blue-50 text-blue-700 dark:bg-blue-400/15 dark:text-blue-300",
  violet: "bg-violet-50 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300",
};

const TONE_BAR: Record<TitleTone, string> = {
  amber: "bg-amber-700 dark:bg-amber-400",
  teal: "bg-teal-700 dark:bg-teal-400",
  blue: "bg-blue-700 dark:bg-blue-400",
  violet: "bg-violet-700 dark:bg-violet-400",
};

export function Titles() {
  const shop = useQuery({ queryKey: SHOP_KEY, queryFn: () => liveQuizApi.shop() });

  if (shop.isLoading) return <LoadingState label="Opening your titles…" />;
  if (shop.isError || !shop.data) {
    return <ErrorState message="Your titles could not be opened just now." onRetry={() => shop.refetch()} />;
  }
  if (!shop.data.look) {
    return (
      <div className="mx-auto w-full max-w-xl space-y-3 px-4 py-6 text-center">
        <p className="text-lg font-bold">A title goes with a character</p>
        <p className="text-sm text-muted-foreground">Pick your free character first, then come back here.</p>
        <Link href="/live/shop" className="inline-flex h-12 items-center rounded-xl bg-primary px-6 text-[15px] font-bold text-primary-foreground">
          Pick your character
        </Link>
      </div>
    );
  }
  return <TitlesBody shop={shop.data} look={shop.data.look} />;
}

function TitlesBody({ shop, look }: { shop: ShopState; look: AvatarWire }) {
  const queryClient = useQueryClient();
  const { me } = useMe();

  const settle = (state: ShopState) => queryClient.setQueryData(SHOP_KEY, state);
  const wear = useMutation({
    // Naming only the title leaves the hat, frame and emote as they are.
    mutationFn: (title: string | null) => liveQuizApi.equip(look.character, look.skin, { title }),
    onSuccess: settle,
  });
  const buy = useMutation({ mutationFn: (key: string) => liveQuizApi.buy(key), onSuccess: settle });
  const busy = wear.isPending || buy.isPending;
  const failure = wear.error ?? buy.error;

  const name = [me?.first_name, me?.last_name].filter(Boolean).join(" ");
  const limited = shop.items.filter((item) => item.limited);

  return (
    <div className="mx-auto w-full max-w-xl space-y-3 px-4 py-4">
      <Link href="/live" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Live quiz
      </Link>
      <div className="flex items-center gap-3">
        <h1 className="flex-1 text-lg font-extrabold">Titles</h1>
        <Link href="/live/locker" className="text-sm font-bold text-primary hover:underline">
          Locker
        </Link>
        <span
          className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-border bg-card px-3 font-mono text-[15px] font-extrabold tabular-nums"
          aria-label={`${shop.balance} gems`}
        >
          <GemIcon size={18} /> {shop.balance.toLocaleString()}
        </span>
      </div>

      <div className="flex items-center gap-3 rounded-[18px] border border-border bg-card px-3.5 py-3 shadow-sm">
        <AvatarDisc avatar={look} name={name} size={54} still />
        <div className="flex min-w-0 flex-col items-start gap-1">
          <span className="text-xs text-muted-foreground">Wearing</span>
          {look.title ? <TitleChip title={look.title} tone="light" /> : <span className="text-sm font-semibold">No title yet</span>}
        </div>
      </div>

      <p className="text-[13px] text-muted-foreground">Titles come from how you play. They can’t be bought.</p>

      {failure && (
        <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
          {normalizeApiError(failure).message}
        </p>
      )}

      <ul className="space-y-3">
        {shop.titles
          .filter((row) => TITLES[row.key])
          .map((row) => (
            <TitleRow key={row.key} row={row} worn={look.title === row.key} busy={busy} onWear={(title) => wear.mutate(title)} />
          ))}
      </ul>

      {limited.length > 0 && (
        <>
          <h2 className="pt-1 text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">Limited time</h2>
          <ul className="space-y-3">
            {limited.map((item) => (
              <LimitedRow key={item.key} item={item} look={look} balance={shop.balance} busy={busy} onBuy={() => buy.mutate(item.key)} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function TitleRow({
  row,
  worn,
  busy,
  onWear,
}: {
  row: TitleProgress;
  worn: boolean;
  busy: boolean;
  onWear: (title: string | null) => void;
}) {
  const { icon: Icon, tone } = TITLES[row.key];
  return (
    <li className={cn(ROW, "py-[11px]")}>
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", TONE_TILE[tone])}>
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">{row.name}</p>
        <p className="text-xs text-muted-foreground">{row.rule}</p>
        <div className="mt-1.5 flex items-center gap-2">
          <div
            className="h-1.5 flex-1 rounded-full bg-slate-100 dark:bg-white/10"
            role="progressbar"
            aria-label={`${row.name} progress`}
            aria-valuenow={row.progress}
            aria-valuemax={row.goal}
          >
            <div
              className={cn("h-1.5 rounded-full", row.earned ? "bg-emerald-700 dark:bg-emerald-400" : TONE_BAR[tone])}
              style={{ width: `${Math.round((row.progress / row.goal) * 100)}%` }}
            />
          </div>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {row.progress}/{row.goal}
          </span>
        </div>
      </div>
      {worn ? (
        <button
          type="button"
          disabled={busy}
          aria-label={`Take off ${row.name}`}
          onClick={() => onWear(null)}
          className="inline-flex h-9 shrink-0 items-center gap-1 px-1 text-xs font-bold text-emerald-700 dark:text-emerald-400"
        >
          <Check className="h-3.5 w-3.5" aria-hidden /> On
        </button>
      ) : row.earned ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onWear(row.key)}
          className="h-9 shrink-0 rounded-[10px] border border-primary/30 bg-card px-3 text-[13px] font-bold text-primary transition hover:bg-primary/5 disabled:opacity-50"
        >
          Wear
        </button>
      ) : (
        <span role="img" aria-label="Locked" className="flex shrink-0 text-muted-foreground">
          <Lock className="h-4 w-4" aria-hidden />
        </span>
      )}
    </li>
  );
}

function LimitedRow({
  item,
  look,
  balance,
  busy,
  onBuy,
}: {
  item: ShopItem;
  look: AvatarWire;
  balance: number;
  busy: boolean;
  onBuy: () => void;
}) {
  const short = Math.max(0, item.price - balance);
  return (
    <li className={cn(ROW, "py-2.5")}>
      <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[14px] bg-[#1b1636]">
        <LiveAvatar character={look.character} skin={look.skin} hat={item.slot_key} size={46} still />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-bold">{item.name}</span>
          <span className="rounded-full bg-teal-50 px-[9px] py-0.5 text-[11px] font-bold text-teal-700 dark:bg-teal-400/15 dark:text-teal-300">
            Limited
          </span>
        </div>
        <p className="mt-0.5 text-xs font-semibold">
          {item.owned ? (
            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
              <Check className="h-3.5 w-3.5" aria-hidden /> Owned
            </span>
          ) : item.on_sale ? (
            <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
              <Clock className="h-3.5 w-3.5" aria-hidden /> {daysLeft(item.days_left ?? 0)}
              {short > 0 && ` · ${short} more gems`}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Lock className="h-3.5 w-3.5" aria-hidden /> Back in {item.back_in}
            </span>
          )}
        </p>
      </div>
      {!item.owned && item.on_sale && (
        <button
          type="button"
          disabled={busy || short > 0}
          aria-label={`Buy ${item.name} for ${item.price} gems`}
          onClick={onBuy}
          className="inline-flex h-10 shrink-0 items-center gap-[5px] rounded-xl bg-primary px-3 font-mono text-sm font-extrabold tabular-nums text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          <GemIcon size={15} /> {item.price}
        </button>
      )}
    </li>
  );
}
