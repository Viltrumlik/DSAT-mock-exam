"use client";

/**
 * The locker: put a whole look together, slot by slot, and see it before saving it.
 *
 * Tapping anything only changes the preview. An item the student does not own turns the button
 * into its price, and nothing is worn until "Save look". As in the shop, every answer from the
 * server replaces the cache, so what the page shows as owned is what the server just said.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Calendar, Check, CircleDot, GraduationCap, Lock, MessageCircle, Palette, Smile } from "lucide-react";

import { ErrorState, LoadingState } from "@/features/classroom/ui";
import { useMe } from "@/hooks/useMe";
import { normalizeApiError } from "@/lib/apiError";
import { cn } from "@/lib/cn";

import {
  SHOP_KEY,
  liveQuizApi,
  type AvatarSkin,
  type AvatarSlot,
  type AvatarWire,
  type ShopItem,
  type ShopState,
} from "./api";
import { AvatarDisc, EmoteBubble, GemIcon, LiveAvatar, TitleChip } from "./avatars";
import styles from "./game.module.css";
import { daysLeft, gamesToGo, shortName } from "./theme";

type Tab = "character" | "skin" | AvatarSlot;

type Draft = { character: string; skin: AvatarSkin | null; hat: string | null; frame: string | null; emote: string | null };

const TABS: Array<{ id: Tab; label: string; icon: React.ElementType }> = [
  { id: "character", label: "Character", icon: Smile },
  { id: "skin", label: "Skin", icon: Palette },
  { id: "hat", label: "Hat", icon: GraduationCap },
  { id: "frame", label: "Frame", icon: CircleDot },
  { id: "emote", label: "Emote", icon: MessageCircle },
];

const NONE_LABEL: Record<AvatarSlot, string> = { hat: "No hat", frame: "No frame", emote: "No emote" };

const STAGE_BACKGROUND =
  "radial-gradient(1200px 600px at 15% -10%, rgba(124, 58, 237, 0.35), transparent 60%), radial-gradient(900px 500px at 110% 110%, rgba(37, 99, 235, 0.3), transparent 60%), #120d26";

function draftOf(look: AvatarWire): Draft {
  return {
    character: look.character,
    skin: look.skin,
    hat: look.hat ?? null,
    frame: look.frame ?? null,
    emote: look.emote ?? null,
  };
}

function wireOf(draft: Draft): AvatarWire {
  return {
    character: draft.character,
    skin: draft.skin,
    hat: draft.hat ?? undefined,
    frame: draft.frame ?? undefined,
    emote: draft.emote ?? undefined,
  };
}

function sameLook(a: Draft, b: Draft): boolean {
  return a.character === b.character && a.skin === b.skin && a.hat === b.hat && a.frame === b.frame && a.emote === b.emote;
}

/** The items a draft is made of, in the order they have to be bought. */
function piecesOf(draft: Draft, items: ShopItem[]): ShopItem[] {
  const keys = [
    `char:${draft.character}`,
    draft.skin ? `skin:${draft.character}:${draft.skin}` : null,
    draft.hat ? `hat:${draft.hat}` : null,
    draft.frame ? `frame:${draft.frame}` : null,
    draft.emote ? `emote:${draft.emote}` : null,
  ];
  return keys.flatMap((key) => items.filter((item) => item.key === key));
}

export function Locker() {
  const shop = useQuery({ queryKey: SHOP_KEY, queryFn: () => liveQuizApi.shop() });

  if (shop.isLoading) return <LoadingState label="Opening your locker…" />;
  if (shop.isError || !shop.data) {
    return <ErrorState message="Your locker could not be opened just now." onRetry={() => shop.refetch()} />;
  }
  if (!shop.data.look) {
    return (
      <div className="mx-auto w-full max-w-xl space-y-3 px-4 py-6 text-center">
        <p className="text-lg font-bold">Your locker is empty</p>
        <p className="text-sm text-muted-foreground">Pick your free character first, then dress them here.</p>
        <Link href="/live/shop" className="inline-flex h-12 items-center rounded-xl bg-primary px-6 text-[15px] font-bold text-primary-foreground">
          Pick your character
        </Link>
      </div>
    );
  }
  return <LockerBody shop={shop.data} look={shop.data.look} />;
}

function LockerBody({ shop, look }: { shop: ShopState; look: AvatarWire }) {
  const queryClient = useQueryClient();
  const { me } = useMe();
  const [draft, setDraft] = useState<Draft>(() => draftOf(look));
  const [tab, setTab] = useState<Tab>("hat");

  const settle = (state: ShopState) => queryClient.setQueryData(SHOP_KEY, state);
  const buy = useMutation({ mutationFn: (key: string) => liveQuizApi.buy(key), onSuccess: settle });
  const save = useMutation({
    mutationFn: (next: Draft) => liveQuizApi.equip(next.character, next.skin, { hat: next.hat, frame: next.frame, emote: next.emote }),
    onSuccess: settle,
  });
  const busy = buy.isPending || save.isPending;
  const failure = buy.error ?? save.error;

  const saved = draftOf(look);
  const missing = useMemo(() => piecesOf(draft, shop.items).filter((item) => !item.owned), [draft, shop.items]);
  const nextToBuy = missing[0];
  const offSeason = Boolean(nextToBuy?.limited && !nextToBuy.on_sale);
  const short = nextToBuy && !offSeason ? Math.max(0, nextToBuy.price - shop.balance) : 0;
  const name = [me?.first_name, me?.last_name].filter(Boolean).join(" ");

  return (
    <div className="mx-auto w-full max-w-xl space-y-3 px-4 py-4">
      <Link href="/live" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Live quiz
      </Link>
      <div className="flex items-center gap-3">
        <h1 className="flex-1 text-lg font-extrabold">Locker</h1>
        <Link href="/live/titles" className="text-sm font-bold text-primary hover:underline">
          Titles
        </Link>
        <Link href="/live/shop" className="text-sm font-bold text-primary hover:underline">
          Shop
        </Link>
        <span
          className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-border bg-card px-3 font-mono text-[15px] font-extrabold tabular-nums"
          aria-label={`${shop.balance} gems`}
        >
          <GemIcon size={18} /> {shop.balance.toLocaleString()}
        </span>
      </div>

      <div
        className="relative flex h-[262px] flex-col items-center justify-center gap-2 overflow-hidden rounded-3xl text-white"
        style={{ background: STAGE_BACKGROUND }}
      >
        {draft.emote && (
          <span className="absolute right-4 top-4">
            <EmoteBubble emote={draft.emote} />
          </span>
        )}
        <div className={styles.bob}>
          <AvatarDisc avatar={wireOf(draft)} name={name} size={140} background="rgba(255, 255, 255, 0.06)" />
        </div>
        {name && <p className="text-[17px] font-extrabold">{shortName(name)}</p>}
        <TitleChip title={look.title} />
      </div>

      <div role="tablist" aria-label="Slots" className="flex gap-2 overflow-x-auto pb-0.5">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-bold transition",
              tab === id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </button>
        ))}
      </div>

      <SlotGrid tab={tab} shop={shop} draft={draft} saved={saved} onChange={setDraft} />

      {failure && (
        <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
          {normalizeApiError(failure).message}
        </p>
      )}

      {nextToBuy ? (
        <div className="space-y-1.5">
          {short > 0 && (
            <p className="text-center text-[13px] text-muted-foreground">
              {short} more gems · {gamesToGo(short)}
            </p>
          )}
          <button
            type="button"
            disabled={busy || short > 0 || offSeason}
            onClick={() => buy.mutate(nextToBuy.key)}
            className="inline-flex h-[52px] w-full items-center justify-center gap-1.5 rounded-[14px] bg-primary text-base font-bold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {offSeason ? (
              `Back in ${nextToBuy.back_in}`
            ) : (
              <>
                Buy {nextToBuy.name} for <GemIcon size={16} /> {nextToBuy.price}
              </>
            )}
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy || sameLook(draft, saved)}
          onClick={() => save.mutate(draft)}
          className="h-[52px] w-full rounded-[14px] bg-primary text-base font-bold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {sameLook(draft, saved) ? "You are wearing this" : "Save look"}
        </button>
      )}
    </div>
  );
}

function SlotGrid({
  tab,
  shop,
  draft,
  saved,
  onChange,
}: {
  tab: Tab;
  shop: ShopState;
  draft: Draft;
  saved: Draft;
  onChange: (next: Draft) => void;
}) {
  const card = (key: string, title: string, tile: React.ReactNode, selected: boolean, onPick: () => void, status: React.ReactNode) => (
    <li key={key}>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={title}
        onClick={onPick}
        className={cn(
          "flex w-full min-w-0 flex-col items-center gap-1.5 rounded-2xl border bg-card px-1.5 py-2.5 transition",
          selected ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/40",
        )}
      >
        <span className="flex h-16 w-16 items-center justify-center rounded-[14px] bg-[#1b1636]">{tile}</span>
        <span className="text-center text-xs font-bold leading-tight">{title}</span>
        <span className="flex min-h-4 items-center">{status}</span>
      </button>
    </li>
  );
  const grid = (cards: React.ReactNode[]) => <ul className="grid grid-cols-3 gap-2.5">{cards}</ul>;

  const status = (item: ShopItem, wearing: boolean) =>
    wearing ? (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
        <Check className="h-3 w-3" aria-hidden /> Wearing
      </span>
    ) : item.owned ? (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
        <Check className="h-3 w-3" aria-hidden /> Owned
      </span>
    ) : item.limited && !item.on_sale ? (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-muted-foreground">
        <Lock className="h-3 w-3" aria-hidden /> Back in {item.back_in}
      </span>
    ) : item.limited ? (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
        <Calendar className="h-3 w-3" aria-hidden /> {daysLeft(item.days_left ?? 0)}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 font-mono text-[11px] font-extrabold tabular-nums">
        <GemIcon size={12} /> {item.price}
      </span>
    );

  if (tab === "character") {
    return grid(
      shop.items
        .filter((item) => item.kind === "character")
        .map((item) =>
          card(
            item.key,
            item.name,
            <LiveAvatar character={item.character} size={52} still />,
            draft.character === item.character,
            () => onChange({ ...draft, character: item.character, skin: null }),
            status(item, saved.character === item.character),
          ),
        ),
    );
  }

  if (tab === "skin") {
    const base = shop.items.find((item) => item.key === `char:${draft.character}`);
    const skins = shop.items.filter((item) => item.kind === "skin" && item.character === draft.character);
    return grid(
      (base ? [base, ...skins] : skins).map((item) => {
        const skin = item.kind === "skin" ? (item.tier as AvatarSkin) : null;
        return card(
          item.key,
          item.kind === "skin" ? item.name.split(" ")[0] : item.name,
          <LiveAvatar character={item.character} skin={skin} size={52} still />,
          draft.skin === skin,
          () => onChange({ ...draft, skin }),
          status(item, saved.character === item.character && saved.skin === skin),
        );
      }),
    );
  }

  const slot = tab;
  const worn = draft[slot];
  const tileFor = (key: string | null) => {
    if (slot === "hat") {
      return <LiveAvatar character={draft.character} skin={draft.skin} hat={key} size={52} still />;
    }
    if (slot === "frame") {
      return <AvatarDisc avatar={{ character: draft.character, skin: draft.skin, frame: key ?? undefined }} name="" size={56} still />;
    }
    return key ? <EmoteBubble emote={key} className="scale-[0.72]" /> : <MessageCircle className="h-6 w-6 text-white/50" aria-hidden />;
  };
  return grid([
    card(`no-${slot}`, NONE_LABEL[slot], tileFor(null), worn === null, () => onChange({ ...draft, [slot]: null }), null),
    ...shop.items
      .filter((item) => item.kind === slot)
      .map((item) => {
        const key = item.slot_key ?? "";
        return card(
          item.key,
          item.name,
          tileFor(key),
          worn === key,
          () => onChange({ ...draft, [slot]: key }),
          status(item, saved[slot] === key),
        );
      }),
  ]);
}
