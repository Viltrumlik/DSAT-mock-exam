"use client";

/**
 * The avatar shop: spend the gems Live Quiz games pay on characters and their skins.
 *
 * Every move — claim, buy, wear — answers with the whole shop again, and that answer replaces
 * the cache. The page never subtracts a price or flips an "owned" flag itself, so what it
 * shows is always what the server just said.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Lock } from "lucide-react";

import { Button, Card, ErrorState, LoadingState, Tabs } from "@/features/classroom/ui";
import { normalizeApiError } from "@/lib/apiError";
import { cn } from "@/lib/cn";

import { liveQuizApi, type AvatarSkin, type ShopItem, type ShopState } from "./api";
import { GemIcon, LiveAvatar, avatarName } from "./avatars";

const SHOP_KEY = ["livequiz", "shop"] as const;

const TIER_STYLE: Record<ShopItem["tier"], string> = {
  common: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
  rare: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  epic: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  legendary: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

export function GemShop() {
  const queryClient = useQueryClient();
  const shop = useQuery({ queryKey: SHOP_KEY, queryFn: () => liveQuizApi.shop() });
  const [tab, setTab] = useState("characters");
  const [preview, setPreview] = useState<{ character: string; skin: AvatarSkin | null } | null>(null);

  const settle = (state: ShopState) => queryClient.setQueryData(SHOP_KEY, state);
  const buy = useMutation({ mutationFn: (item: string) => liveQuizApi.buy(item), onSuccess: settle });
  const claim = useMutation({ mutationFn: (character: string) => liveQuizApi.claimStarter(character), onSuccess: settle });
  const wear = useMutation({
    mutationFn: (look: { character: string; skin: AvatarSkin | null }) => liveQuizApi.equip(look.character, look.skin),
    onSuccess: (state) => {
      settle(state);
      setPreview(null);
    },
  });
  const failure = buy.error ?? claim.error ?? wear.error;
  const busy = buy.isPending || claim.isPending || wear.isPending;

  const data = shop.data;
  const characters = useMemo(() => (data?.items ?? []).filter((i) => i.kind === "character"), [data]);
  const ownedCharacters = useMemo(() => new Set(characters.filter((c) => c.owned).map((c) => c.character)), [characters]);

  if (shop.isLoading) return <LoadingState label="Opening the shop…" />;
  if (shop.isError || !data) {
    return <ErrorState message="The shop could not be opened just now." onRetry={() => shop.refetch()} />;
  }

  const shown = preview ?? data.look;
  const wearing = (character: string, skin: AvatarSkin | null) =>
    data.look?.character === character && (data.look?.skin ?? null) === skin;

  const action = (item: ShopItem) => {
    const skin = item.kind === "skin" ? (item.tier as AvatarSkin) : null;
    if (item.owned) {
      return wearing(item.character, skin) ? (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
          <Check className="h-3.5 w-3.5" aria-hidden /> Wearing
        </span>
      ) : (
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => wear.mutate({ character: item.character, skin })}>
          Wear
        </Button>
      );
    }
    if (item.kind === "skin" && !ownedCharacters.has(item.character)) {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5" aria-hidden /> Get {avatarName(item.character, null)} first
        </span>
      );
    }
    const short = item.price - data.balance;
    return (
      <Button size="sm" disabled={busy || short > 0} onClick={() => buy.mutate(item.key)}>
        <span className="inline-flex items-center gap-1">
          <GemIcon size={14} /> {item.price}
        </span>
      </Button>
    );
  };

  const card = (item: ShopItem) => {
    const skin = item.kind === "skin" ? (item.tier as AvatarSkin) : null;
    const short = item.price - data.balance;
    return (
      <li
        key={item.key}
        className={cn(
          "flex flex-col items-center gap-2 rounded-2xl border border-border bg-card p-3 text-center transition",
          preview?.character === item.character && (preview?.skin ?? null) === skin && "ring-2 ring-primary/40",
        )}
      >
        <button
          type="button"
          onClick={() => setPreview({ character: item.character, skin })}
          className="rounded-xl p-1 transition hover:bg-surface-2"
          aria-label={`Preview ${item.name}`}
        >
          <LiveAvatar character={item.character} skin={skin} size={76} />
        </button>
        <p className="text-sm font-semibold leading-tight">{item.name}</p>
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize", TIER_STYLE[item.tier])}>
          {item.tier}
        </span>
        <div className="mt-auto flex min-h-[32px] items-center">{action(item)}</div>
        {!item.owned && short > 0 && (item.kind === "character" || ownedCharacters.has(item.character)) && (
          <p className="text-[11px] text-muted-foreground">{short} more to go</p>
        )}
      </li>
    );
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6">
      <Link href="/live" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Live quiz
      </Link>

      <Card className="flex flex-wrap items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          <div className="flex h-28 w-28 items-center justify-center rounded-3xl bg-gradient-to-b from-violet-500/15 to-sky-500/10">
            {shown ? (
              <LiveAvatar character={shown.character} skin={shown.skin} size={96} />
            ) : (
              <span className="text-xs text-muted-foreground">No avatar yet</span>
            )}
          </div>
          <div>
            <h1 className="text-xl font-bold">Avatar shop</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {shown ? (
                <>
                  {preview ? "Previewing" : "Wearing"} <span className="font-semibold text-foreground">{avatarName(shown.character, shown.skin)}</span>
                </>
              ) : (
                "Pick a character to show the class in every game."
              )}
            </p>
            {preview && (
              <button type="button" onClick={() => setPreview(null)} className="mt-1 text-xs text-primary hover:underline">
                Back to what I'm wearing
              </button>
            )}
          </div>
        </div>
        <div className="text-right">
          <p className="inline-flex items-center gap-1.5 font-mono text-3xl font-black tabular-nums">
            <GemIcon size={26} /> {data.balance.toLocaleString()}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {data.today_earned} of {data.daily_cap} earned today · games pay 10 a right answer
          </p>
        </div>
      </Card>

      {data.can_claim_starter && (
        <Card className="space-y-3 border-primary/30 bg-primary/5">
          <div>
            <p className="font-semibold">Pick your free character</p>
            <p className="text-sm text-muted-foreground">One of these three is yours for nothing. The rest you earn with gems.</p>
          </div>
          <ul className="grid grid-cols-3 gap-3 sm:max-w-md">
            {data.starters.map((key) => (
              <li key={key} className="flex flex-col items-center gap-2 rounded-2xl bg-card p-3">
                <LiveAvatar character={key} size={64} />
                <p className="text-sm font-semibold">{avatarName(key, null)}</p>
                <Button size="sm" disabled={busy} onClick={() => claim.mutate(key)}>
                  Choose
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {failure && (
        <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
          {normalizeApiError(failure).message}
        </p>
      )}

      <Tabs
        items={[
          { id: "characters", label: "Characters", count: characters.length },
          { id: "skins", label: "Skins", count: data.items.length - characters.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "characters" && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{characters.map(card)}</ul>
      )}

      {tab === "skins" && (
        <div className="space-y-5">
          {characters.map((character) => (
            <section key={character.character}>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <LiveAvatar character={character.character} size={24} />
                {character.name}
                {!character.owned && <span className="text-xs font-normal text-muted-foreground">· not yours yet</span>}
              </h2>
              <ul className="grid grid-cols-3 gap-3 sm:max-w-xl">
                {data.items.filter((i) => i.kind === "skin" && i.character === character.character).map(card)}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
