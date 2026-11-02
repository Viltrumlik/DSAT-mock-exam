"use client";

/**
 * The avatar shop: spend the gems Live Quiz games pay on characters and their skins.
 *
 * The first page is every character. A character opens its try-on page, where each of its looks
 * can be seen in the three places it will appear, and bought or worn from there.
 *
 * Every move — claim, buy, wear — answers with the whole shop again, and that answer replaces
 * the cache. The page never subtracts a price or flips an "owned" flag itself, so what it
 * shows is always what the server just said.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Lock, Sparkles } from "lucide-react";

import { Button, Card, ErrorState, LoadingState } from "@/features/classroom/ui";
import { normalizeApiError } from "@/lib/apiError";
import { cn } from "@/lib/cn";

import { SHOP_KEY, liveQuizApi, type AvatarSkin, type ShopItem, type ShopState } from "./api";
import { GemIcon, LiveAvatar, avatarName, type AvatarFace } from "./avatars";
import styles from "./game.module.css";
import { gamesToGo } from "./theme";

type Look = { character: string; skin: AvatarSkin | null };

const TIER_STYLE: Record<ShopItem["tier"], string> = {
  common: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
  rare: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  epic: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  legendary: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
};

/** The same chip on the dark stage. */
const TIER_ON_DARK: Record<ShopItem["tier"], string> = {
  common: "bg-white/[0.12] text-slate-200",
  rare: "bg-blue-400/[0.18] text-blue-200",
  epic: "bg-violet-400/20 text-violet-200",
  legendary: "bg-amber-400/[0.16] text-amber-200",
};

const STAGE_BACKGROUND =
  "radial-gradient(1200px 600px at 15% -10%, rgba(124, 58, 237, 0.35), transparent 60%), radial-gradient(900px 500px at 110% 110%, rgba(37, 99, 235, 0.3), transparent 60%), #120d26";

const LOOK_NOTES: Record<AvatarSkin, string> = {
  rare: "A new colour with a warm glow behind it.",
  epic: "Deep-space colours, twinkling stars, and a ring in orbit.",
  legendary: "Gold all over, a shine that sweeps across, and three sparkles in orbit.",
};

const SCENES: Array<{ id: string; label: string; face: AvatarFace }> = [
  { id: "lobby", label: "Lobby", face: "waiting" },
  { id: "right", label: "Right answer", face: "right" },
  { id: "podium", label: "Podium", face: "right" },
];

const skinOf = (item: ShopItem): AvatarSkin | null => (item.kind === "skin" ? (item.tier as AvatarSkin) : null);

function TierChip({ tier, dark }: { tier: ShopItem["tier"]; dark?: boolean }) {
  return (
    <span className={cn("rounded-full px-[9px] py-0.5 text-[11px] font-bold capitalize", (dark ? TIER_ON_DARK : TIER_STYLE)[tier])}>
      {tier}
    </span>
  );
}

export function GemShop() {
  const queryClient = useQueryClient();
  const shop = useQuery({ queryKey: SHOP_KEY, queryFn: () => liveQuizApi.shop() });
  const [opened, setOpened] = useState<string | null>(null);

  const settle = (state: ShopState) => queryClient.setQueryData(SHOP_KEY, state);
  const buy = useMutation({ mutationFn: (item: string) => liveQuizApi.buy(item), onSuccess: settle });
  const claim = useMutation({ mutationFn: (character: string) => liveQuizApi.claimStarter(character), onSuccess: settle });
  const wear = useMutation({
    mutationFn: (look: Look) => liveQuizApi.equip(look.character, look.skin),
    onSuccess: settle,
  });
  const failure = buy.error ?? claim.error ?? wear.error;
  const busy = buy.isPending || claim.isPending || wear.isPending;

  const data = shop.data;
  const characters = useMemo(() => (data?.items ?? []).filter((i) => i.kind === "character"), [data]);

  if (shop.isLoading) return <LoadingState label="Opening the shop…" />;
  if (shop.isError || !data) {
    return <ErrorState message="The shop could not be opened just now." onRetry={() => shop.refetch()} />;
  }

  const header = (
    <div className="flex items-center gap-3">
      <h1 className="flex-1 text-lg font-extrabold">Avatar shop</h1>
      <span
        className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-border bg-card px-3 font-mono text-[15px] font-extrabold tabular-nums"
        aria-label={`${data.balance} gems`}
      >
        <GemIcon size={18} /> {data.balance.toLocaleString()}
      </span>
    </div>
  );
  const problem = failure && (
    <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
      {normalizeApiError(failure).message}
    </p>
  );

  const openCharacter = opened ? characters.find((c) => c.character === opened) : undefined;
  if (openCharacter) {
    return (
      <div className="mx-auto w-full max-w-xl space-y-3 px-4 py-4">
        {header}
        <button
          type="button"
          onClick={() => setOpened(null)}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> All characters
        </button>
        {/* Keyed, so opening another character starts from its own look. */}
        <TryOn
          key={openCharacter.character}
          shop={data}
          character={openCharacter}
          busy={busy}
          onBuy={(key) => buy.mutate(key)}
          onWear={(look) => wear.mutate(look)}
        />
        {problem}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-4">
      <Link href="/live" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Live quiz
      </Link>
      {header}
      <p className="text-[13px] text-muted-foreground">
        {data.today_earned} of {data.daily_cap} earned today · games pay 10 a right answer
      </p>

      {data.can_claim_starter && (
        <Card className="space-y-3 border-primary/30 bg-primary/5">
          <div>
            <p className="font-semibold">Pick your free character</p>
            <p className="text-sm text-muted-foreground">One of these three is yours for nothing. The rest you earn with gems.</p>
          </div>
          <ul className="grid grid-cols-3 gap-3 sm:max-w-md">
            {data.starters.map((key) => (
              <li key={key} className="flex flex-col items-center gap-2 rounded-2xl bg-card p-3">
                <LiveAvatar character={key} size={64} still />
                <p className="text-sm font-semibold">{avatarName(key, null)}</p>
                <Button size="sm" disabled={busy} onClick={() => claim.mutate(key)}>
                  Choose
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {problem}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {characters.map((item) => {
          const worn = data.look?.character === item.character;
          return (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => setOpened(item.character)}
                aria-label={`Open ${item.name}`}
                className="flex w-full flex-col items-center gap-1.5 rounded-2xl border border-border bg-card p-2.5 text-center transition hover:border-primary/40"
              >
                <span className="flex h-24 w-full items-center justify-center rounded-xl bg-[#1b1636]">
                  <LiveAvatar
                    character={item.character}
                    skin={worn ? (data.look?.skin ?? null) : null}
                    size={76}
                    still
                  />
                </span>
                <span className="mt-1 text-sm font-bold leading-tight">{item.name}</span>
                <TierChip tier={item.tier} />
                <LookStatus shop={data} item={item} anySkin />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Wearing, owned, or the price: the one line every look shows under its picture. */
function LookStatus({
  shop,
  item,
  previewing,
  anySkin,
}: {
  shop: ShopState;
  item: ShopItem;
  previewing?: boolean;
  /** On the character grid: wearing this character counts, whichever of its skins is on. */
  anySkin?: boolean;
}) {
  const worn = shop.look?.character === item.character && (anySkin || (shop.look?.skin ?? null) === skinOf(item));
  if (previewing && !item.owned) {
    return <span className="text-[11px] font-bold text-primary">Previewing</span>;
  }
  if (worn) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
        <Check className="h-3 w-3" aria-hidden /> Wearing
      </span>
    );
  }
  if (item.owned) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
        <Check className="h-3 w-3" aria-hidden /> Owned
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px] font-extrabold tabular-nums">
      <GemIcon size={12} /> {item.price}
    </span>
  );
}

function TryOn({
  shop,
  character,
  busy,
  onBuy,
  onWear,
}: {
  shop: ShopState;
  character: ShopItem;
  busy: boolean;
  onBuy: (key: string) => void;
  onWear: (look: Look) => void;
}) {
  const looks = useMemo(
    () => [character, ...shop.items.filter((i) => i.kind === "skin" && i.character === character.character)],
    [character, shop.items],
  );
  const wornHere = shop.look?.character === character.character ? (shop.look?.skin ?? null) : null;
  const [skin, setSkin] = useState<AvatarSkin | null>(wornHere);
  const [sceneId, setSceneId] = useState("lobby");

  const selected = looks.find((look) => skinOf(look) === skin) ?? character;
  const scene = SCENES.find((s) => s.id === sceneId) ?? SCENES[0];
  const wearing = shop.look?.character === character.character && (shop.look?.skin ?? null) === skinOf(selected);
  const short = Math.max(0, selected.price - shop.balance);
  const percent = Math.min(100, Math.round((100 * shop.balance) / Math.max(1, selected.price)));
  const lockedByCharacter = selected.kind === "skin" && !character.owned;

  return (
    <>
      {/* Not a Card: its own padding would hold the stage off the edges, and `cn` does not
          let a `p-0` beside it win. */}
      <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
        <div className="relative flex h-[230px] items-center justify-center overflow-hidden" style={{ background: STAGE_BACKGROUND }}>
          <span className="absolute left-3.5 top-3.5">
            <TierChip tier={selected.tier} dark />
          </span>
          <span className="absolute right-3.5 top-3.5 inline-flex items-center gap-1 rounded-full bg-white/[0.12] px-2.5 py-[3px] text-xs font-bold text-white">
            {wearing ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}
            {wearing ? "Wearing" : "Previewing"}
          </span>
          {scene.id === "podium" && (
            <span
              className="absolute bottom-0 flex h-11 w-40 justify-center pt-0.5 font-mono text-2xl font-black"
              style={{ borderRadius: "14px 14px 0 0", background: "linear-gradient(180deg, #fbbf24, #fbbf24cc)", color: "rgba(18, 13, 38, 0.72)" }}
              aria-hidden
            >
              1
            </span>
          )}
          <div className={cn(styles.bob, scene.id === "podium" && "-mt-10")}>
            <LiveAvatar character={character.character} skin={skinOf(selected)} size={scene.id === "podium" ? 150 : 172} face={scene.face} />
          </div>
        </div>

        <div className="space-y-3 px-[18px] py-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-[22px] font-extrabold">{selected.name}</h2>
            <TierChip tier={selected.tier} />
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {skinOf(selected) ? LOOK_NOTES[skinOf(selected) as AvatarSkin] : "Their everyday look. Every skin starts from here."}
          </p>

          <div role="tablist" aria-label="Preview in" className="flex gap-1 rounded-xl bg-surface-2 p-1">
            {SCENES.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={s.id === scene.id}
                onClick={() => setSceneId(s.id)}
                className={cn(
                  "h-9 flex-1 rounded-[9px] text-[13px] font-bold transition",
                  s.id === scene.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>

          {selected.owned ? (
            wearing ? (
              <p className="inline-flex h-12 w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-500/10 text-[15px] font-bold text-emerald-700 dark:text-emerald-400">
                <Check className="h-4 w-4" aria-hidden /> You are wearing this
              </p>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => onWear({ character: character.character, skin: skinOf(selected) })}
                className="h-12 w-full rounded-xl bg-primary text-[15px] font-bold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                Wear this look
              </button>
            )
          ) : lockedByCharacter ? (
            <>
              <p className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <Lock className="h-3.5 w-3.5" aria-hidden /> A skin needs its character first.
              </p>
              <button
                type="button"
                onClick={() => setSkin(null)}
                className="h-12 w-full rounded-xl border border-border text-[15px] font-bold transition hover:bg-surface-2"
              >
                See {character.name}
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <GemIcon size={22} />
                <span className="font-mono text-[22px] font-extrabold tabular-nums">{selected.price}</span>
                <span className="ml-auto text-[13px] text-muted-foreground">You have {shop.balance}</span>
              </div>
              <div>
                <div
                  className="h-2 rounded-full bg-surface-2"
                  role="progressbar"
                  aria-label={`Gems towards ${selected.name}`}
                  aria-valuemin={0}
                  aria-valuemax={selected.price}
                  aria-valuenow={Math.min(shop.balance, selected.price)}
                >
                  <div className="h-2 rounded-full bg-primary" style={{ width: `${percent}%` }} />
                </div>
                <p className="mt-1.5 text-[13px] text-muted-foreground">
                  {short > 0 ? `${short} more gems · ${gamesToGo(short)}` : "You have enough for this one."}
                </p>
              </div>
              <button
                type="button"
                disabled={busy || short > 0}
                onClick={() => onBuy(selected.key)}
                className="h-12 w-full rounded-xl bg-primary text-[15px] font-bold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                Buy for {selected.price}
              </button>
            </>
          )}
        </div>
      </div>

      <p className="text-[13px] font-bold text-muted-foreground">Other looks</p>
      <ul className="grid grid-cols-4 gap-2">
        {looks.map((look) => {
          const isSelected = look.key === selected.key;
          return (
            <li key={look.key}>
              <button
                type="button"
                onClick={() => setSkin(skinOf(look))}
                aria-label={`Preview ${look.name}`}
                aria-pressed={isSelected}
                className={cn(
                  "flex w-full min-w-0 flex-col items-center gap-1 rounded-[14px] border bg-card px-1 py-2 transition",
                  isSelected ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/40",
                )}
              >
                <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-[#1b1636]">
                  <LiveAvatar character={look.character} skin={skinOf(look)} size={48} still />
                </span>
                <span className="max-w-full truncate text-xs font-bold">{look.kind === "skin" ? look.name.split(" ")[0] : look.name}</span>
                <LookStatus shop={shop} item={look} previewing={isSelected} />
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
