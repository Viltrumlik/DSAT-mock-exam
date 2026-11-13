"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { ICON_NAMES, type IconName } from "@/components/ui/Icon";

/**
 * What the shell remembers per person, in this browser (owner 2026-11-13: pins live in the browser, no
 * backend): the pinned pages and which groups of the panel are folded. One key per console and person, so
 * Admin and Builder, and two people on one desk computer, keep their own.
 *
 * Storage that throws (a private window, blocked site data) reads as empty and writes nowhere: the shell
 * works, it just doesn't remember.
 */
const EVENT = "ms:shell-store";

function readRaw(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeRaw(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage blocked — not remembered */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** A JSON list kept under `key`, with the items `keep` accepts; writing it tells every reader on the page. */
function useStoredList<T>(key: string, keep: (x: unknown) => x is T): [T[], (next: T[]) => void] {
  const raw = useSyncExternalStore(subscribe, () => readRaw(key), () => "");
  const list = useMemo(() => {
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(keep) : [];
    } catch {
      return [];
    }
  }, [raw, keep]);
  const set = useCallback((next: T[]) => writeRaw(key, JSON.stringify(next)), [key]);
  return [list, set];
}

export type ShellScope = "ops" | "builder";
const personOf = (userId: unknown) => (userId === null || userId === undefined || userId === "" ? "anon" : String(userId));

// ── Pins (Shell board: "Any page can be pinned from the bookmark in its top bar … per person, drag to reorder, up to 6")

export type Pin = { href: string; label: string; icon: IconName };

export const MAX_PINS = 6;

export const pinsKey = (scope: ShellScope, userId: unknown) => `ms-pins:${scope}:${personOf(userId)}`;

const isPin = (x: unknown): x is Pin => {
  const p = x as Pin;
  return Boolean(p) && typeof p.href === "string" && p.href.startsWith("/") && typeof p.label === "string" && ICON_NAMES.includes(p.icon);
};

/** Pinned when it is there, unpinned when it was; a seventh is refused (the bookmark says so before). */
export function togglePin(pins: readonly Pin[], pin: Pin): Pin[] {
  if (pins.some((p) => p.href === pin.href)) return pins.filter((p) => p.href !== pin.href);
  if (pins.length >= MAX_PINS) return [...pins];
  return [...pins, pin];
}

/** Moves the pin at `from` to `to` (drag and drop, ⌥← / ⌥→); out-of-range indexes change nothing. */
export function movePin(pins: readonly Pin[], from: number, to: number): Pin[] {
  if (from === to || from < 0 || to < 0 || from >= pins.length || to >= pins.length) return [...pins];
  const next = [...pins];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function usePins(scope: ShellScope, userId: unknown): [Pin[], (next: Pin[]) => void] {
  const [pins, set] = useStoredList(pinsKey(scope, userId), isPin);
  return [pins.slice(0, MAX_PINS), set];
}

// ── Folded groups (Shell board: "Folded groups remember their state per person")

export const foldsKey = (scope: ShellScope, userId: unknown) => `ms-nav-folded:${scope}:${personOf(userId)}`;

const isText = (x: unknown): x is string => typeof x === "string";

/** `"centre/help"` — a category's group, as the panel names it. */
export const foldId = (categoryId: string, groupId: string) => `${categoryId}/${groupId}`;

export function useFolds(scope: ShellScope, userId: unknown): [string[], (id: string) => void] {
  const [folded, set] = useStoredList(foldsKey(scope, userId), isText);
  const toggle = useCallback((id: string) => set(folded.includes(id) ? folded.filter((f) => f !== id) : [...folded, id]), [folded, set]);
  return [folded, toggle];
}
