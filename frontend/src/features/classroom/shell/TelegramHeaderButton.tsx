"use client";

import { Send } from "lucide-react";

import { useTelegramGroup } from "../telegramHooks";

const BUTTON =
  "ds-ring mt-2.5 inline-flex items-center gap-1.5 rounded-xl bg-[#2AABEE] px-3 py-1.5 text-[13px] font-bold text-white transition-opacity hover:opacity-90";

/**
 * The class header's Telegram button, in order of preference:
 * 1. the bot's sign-in link, when the bot's own sign-in is on (plan 2026-10-16) — the bot asks
 *    for the login and hands out the invite there;
 * 2. the 2026-09 join dialog, for a class the bot runs while that is off;
 * 3. the old static link, for a class nobody has set up — so nothing regresses.
 */
export function TelegramHeaderButton({
  classId,
  legacyUrl,
  onOpenDialog,
}: {
  classId: number;
  legacyUrl: string;
  onOpenDialog: () => void;
}) {
  const { data } = useTelegramGroup(classId);
  const label = data?.status === "JOINED" ? "Telegram group" : "Join Telegram group";

  if (data?.managed && data.bot_url) {
    return (
      // `noopener` keeps the new tab from reaching back into this app; `noreferrer` is its pair.
      <a href={data.bot_url} target="_blank" rel="noopener noreferrer" className={BUTTON}>
        <Send className="h-[15px] w-[15px]" aria-hidden /> {label}
      </a>
    );
  }
  if (data?.managed) {
    return (
      <button type="button" onClick={onOpenDialog} className={BUTTON}>
        <Send className="h-[15px] w-[15px]" aria-hidden /> {label}
      </button>
    );
  }
  const url = legacyUrl.trim();
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={BUTTON}>
      <Send className="h-[15px] w-[15px]" aria-hidden /> Join Telegram group
    </a>
  );
}
